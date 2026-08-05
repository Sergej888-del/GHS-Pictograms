/**
 * scripts/check-dist.ts — проверка собранного dist/ против ЖИВОЙ базы.
 *
 * Запуск из корня ghspictograms, ПОСЛЕ `npm run build`:
 *   npm run check:dist
 *   npm run check:dist -- --dist ..\some\other\dist     (необязательно)
 *   npm run check:dist -- --only sds                    (подмножество проверок)
 *
 * Ключи берутся из .env.local — тот же файл и те же имена, что у
 * scripts/generate-pictogram-redirects.mjs: PUBLIC_SUPABASE_URL и
 * PUBLIC_SUPABASE_ANON_KEY. Запросы только читающие, service-role не нужен.
 *
 * ГЛАВНЫЙ ПРИНЦИП: ожидаемые числа НЕ хранятся в этом файле. Каждая проверка
 * спрашивает их у базы в момент запуска. Поэтому скрипт не устаревает после
 * очередного импорта — в отличие от одноразовых проверок session 16, которые
 * были снимком базы на день сборки и после первого же импорта начали бы врать.
 *
 * ПРАВИЛА МАРКЕРОВ (выстраданы двумя ложными тревогами в session 16):
 *  1. Маркер — строка, которую производит ТОЛЬКО разметка блока.
 *     `id="s4"` годится. Голый `emg-toggle` — нет: Astro кладёт <style is:global>
 *     и <script is:inline> роута на КАЖДУЮ страницу роута, независимо от того,
 *     отрендерился блок или нет, и такой маркер даёт 109 вместо 90.
 *  2. Считаем СТРАНИЦЫ, а не вхождения.
 *  3. Маркеры только ASCII: PowerShell 5.1 читает файлы без BOM в системной
 *     кодировке, и `·` из бейджа может не совпасть на ровном месте.
 *     Нарушение роняет скрипт на старте, а не тихо портит результат.
 *  4. Поведение (JS) искать И в HTML страницы, И в dist/_astro/*.js — Astro
 *     решает на КАЖДОЙ сборке, вынести обработанный <script> в модуль или
 *     встроить в страницу. Скрипт печатает, где именно нашёл.
 *  5. Расхождение печатается ПОИМЁННО: чего не хватает и что лишнее.
 *
 * Код возврата: 0 — всё сошлось; 1 — есть провал или сломалась сама проверка.
 */

import { config } from 'dotenv'
import { resolve, join } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { STORAGE_CLASSES } from '../src/lib/storageClasses'
import { SDS_SECTIONS } from '../src/lib/sdsSections'
import { hSlug } from '../src/lib/hStatementSlug'
// ⚠ Правило имени и правило адреса берём из тех же файлов, по которым
// строится страница. Списать их сюда — значит завести вторую копию,
// которая разойдётся молча (так уже вышло у pictogramCasPaths.ts).
import { substanceNameFull, NAME_COLUMNS } from '../src/lib/substanceName'
import { substanceSlug, casFromSlug } from '../src/lib/substanceSlug'
// ⚠ Те же обёртки, что стоят на сборке: проверка обязана падать на отказе запроса,
// а не считать пустой ответ фактом о данных. И тот же ограничитель параллелизма —
// иначе сотня одновременных RPC утопит пулер, и проверка начнёт врать (session 32).
import { must, mapLimit } from '../src/lib/mustQuery'

config({ path: resolve(process.cwd(), '.env.local') })
config()

// ─────────────────────────── аргументы ───────────────────────────

const ARGV = process.argv.slice(2)

function argValue(name: string): string | null {
  const i = ARGV.indexOf(name)
  if (i >= 0 && ARGV[i + 1] && !ARGV[i + 1].startsWith('--')) return ARGV[i + 1]
  const eq = ARGV.find((a) => a.startsWith(`${name}=`))
  return eq ? eq.slice(name.length + 1) : null
}

const DIST = resolve(process.cwd(), argValue('--dist') ?? 'dist')
const ONLY = argValue('--only')

if (!existsSync(DIST)) {
  console.error(`Нет папки ${DIST}. Сначала npm run build.`)
  process.exit(1)
}

// ─────────────────────────── supabase ───────────────────────────

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const supabaseKey = process.env.PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Нужны PUBLIC_SUPABASE_URL и PUBLIC_SUPABASE_ANON_KEY в .env.local')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey)

/** Читает все строки таблицы постранично: PostgREST режет ответ на 1000. */
async function selectAll<T = Record<string, unknown>>(
  table: string,
  columns: string,
  tweak: (q: any) => any = (q) => q,
): Promise<T[]> {
  const out: T[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await tweak(supabase.from(table).select(columns)).range(from, from + page - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < page) break
  }
  return out
}

// ─────────────────────────── файлы dist ───────────────────────────

const pageCache = new Map<string, string | null>()

/** HTML страницы по пути относительно dist; null если файла нет. */
function readPage(rel: string): string | null {
  if (pageCache.has(rel)) return pageCache.get(rel)!
  const abs = join(DIST, rel)
  const text = existsSync(abs) ? readFileSync(abs, 'utf8') : null
  pageCache.set(rel, text)
  return text
}

/** Имена подпапок каталога, в которых есть index.html. Это и есть слаги страниц. */
function pageSlugs(relDir: string): string[] {
  const abs = join(DIST, relDir)
  if (!existsSync(abs)) return []
  return readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(abs, d.name, 'index.html')))
    .map((d) => d.name)
    .sort()
}

let assetCache: { name: string; text: string }[] | null = null

/** Содержимое dist/_astro/*.js — туда Astro может вынести обработанный <script>. */
function assetFiles(): { name: string; text: string }[] {
  if (assetCache) return assetCache
  const abs = join(DIST, '_astro')
  assetCache = !existsSync(abs)
    ? []
    : readdirSync(abs)
        .filter((f) => f.endsWith('.js'))
        .map((f) => ({ name: `_astro/${f}`, text: readFileSync(join(abs, f), 'utf8') }))
  return assetCache
}

/**
 * Все HTML-страницы dist рекурсивно: путь относительно dist + текст.
 * Нужна проверкам, которые обходят ВЕСЬ сайт, а не заранее известный набор
 * страниц (session 28: партнёрская ссылка может появиться где угодно).
 */
let pagesCache: { rel: string; html: string }[] | null = null
function allPages(): { rel: string; html: string }[] {
  if (pagesCache) return pagesCache
  const out: { rel: string; html: string }[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === '_astro') continue
        walk(join(dir, e.name), `${prefix}${e.name}/`)
      } else if (e.name.endsWith('.html')) {
        out.push({ rel: `${prefix}${e.name}`, html: readFileSync(join(dir, e.name), 'utf8') })
      }
    }
  }
  walk(DIST, '')
  pagesCache = out
  return out
}

// ─────────────────────────── маркеры ───────────────────────────

const ASCII_PRINTABLE = /^[\x20-\x7E]+$/

function assertAscii(checkId: string, markers: string[]): void {
  for (const m of markers) {
    if (!ASCII_PRINTABLE.test(m)) {
      throw new Error(
        `[${checkId}] маркер не ASCII: ${JSON.stringify(m)} — правило 3, см. шапку файла`,
      )
    }
  }
}

/** Сколько раз подстрока встречается в тексте (без регулярок — маркеры сырые). */
function countOccurrences(haystack: string, needle: string): number {
  let n = 0
  let i = haystack.indexOf(needle)
  while (i !== -1) {
    n++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return n
}

// ─────────────────────────── отчёт ───────────────────────────

interface Result {
  id: string
  group: string
  ok: boolean
  headline: string
  detail: string[]
}

function preview(list: string[], max = 12): string {
  return list.length <= max ? list.join(', ') : `${list.slice(0, max).join(', ')} ... (+${list.length - max})`
}

function diffSets(actual: Set<string>, expected: Set<string>) {
  const missing = [...expected].filter((s) => !actual.has(s)).sort()
  const extra = [...actual].filter((s) => !expected.has(s)).sort()
  return { missing, extra }
}

/**
 * Ядро: маркер должен стоять ровно на том множестве страниц, которое
 * получилось из базы. Расхождение печатается поимённо в обе стороны —
 * это и есть требование «список страниц, где блока быть не должно».
 */
function comparePageSets(
  id: string,
  group: string,
  relDir: string,
  markers: string[],
  expected: Set<string>,
  noun = 'страниц',
): Result {
  assertAscii(id, markers)
  const slugs = pageSlugs(relDir)
  const actual = new Set<string>()
  for (const slug of slugs) {
    const html = readPage(`${relDir}/${slug}/index.html`)
    if (html && markers.every((m) => html.includes(m))) actual.add(slug)
  }
  const { missing, extra } = diffSets(actual, expected)
  const ok = missing.length === 0 && extra.length === 0
  const detail: string[] = []
  if (missing.length) detail.push(`нет в dist (${missing.length}): ${preview(missing)}`)
  if (extra.length) detail.push(`лишние в dist (${extra.length}): ${preview(extra)}`)
  if (ok) detail.push(`маркеры: ${markers.map((m) => JSON.stringify(m)).join(' + ')}`)
  return {
    id,
    group,
    ok,
    headline: `${actual.size} ${noun} в dist, база ожидает ${expected.size}`,
    detail,
  }
}

/** Негативный маркер: ни одной страницы. Ноль — единственный годный ответ. */
function expectAbsent(id: string, group: string, relDir: string, markers: string[]): Result {
  assertAscii(id, markers)
  const hits: string[] = []
  for (const slug of pageSlugs(relDir)) {
    const html = readPage(`${relDir}/${slug}/index.html`)
    if (!html) continue
    for (const m of markers) if (html.includes(m)) hits.push(`${slug} <- ${JSON.stringify(m)}`)
  }
  return {
    id,
    group,
    ok: hits.length === 0,
    headline: hits.length === 0 ? `вхождений: 0, как и должно` : `вхождений: ${hits.length}, ожидался 0`,
    detail: hits.length ? hits.slice(0, 20) : [`проверено: ${markers.map((m) => JSON.stringify(m)).join(', ')}`],
  }
}

/**
 * Поведение: маркер должен найтись либо в самой странице, либо в _astro/*.js.
 * Печатает где именно — Astro меняет решение от сборки к сборке.
 */
function expectBehaviour(id: string, group: string, relPage: string, markers: string[]): Result {
  assertAscii(id, markers)
  const html = readPage(relPage)
  if (html === null) {
    return { id, group, ok: false, headline: `нет файла ${relPage}`, detail: [] }
  }
  const detail: string[] = []
  let ok = true
  for (const m of markers) {
    const inPage = html.includes(m)
    const inAssets = assetFiles().filter((a) => a.text.includes(m)).map((a) => a.name)
    if (inPage) detail.push(`OK  ${JSON.stringify(m)} — в самой странице`)
    else if (inAssets.length) detail.push(`OK  ${JSON.stringify(m)} — в ${inAssets.join(', ')}`)
    else {
      ok = false
      detail.push(`НЕТ ${JSON.stringify(m)} — ни в странице, ни в _astro/*.js`)
    }
  }
  return { id, group, ok, headline: ok ? `${markers.length} маркеров на месте` : `не хватает маркеров`, detail }
}

// ─────────────────────────── проверки ───────────────────────────

interface Check {
  id: string
  group: string
  title: string
  run: () => Promise<Result>
}

type SdsPage = { slug: string; cas_number: string | null }
type Response = {
  cas_number: string
  cameo_chem_id: number | null
  cameo_name: string | null
  first_aid: string | null
  fire_haz: string | null
  fire_fight: string | null
  non_fire_resp: string | null
  idlh_value: number | null
  niosh_pgd_file: string | null
}

let sdsCache: { pages: SdsPage[]; byCas: Map<string, Response> } | null = null

/** Ровно тот же срез, что берёт getStaticPaths страницы: status = 'live'. */
async function sdsData() {
  if (sdsCache) return sdsCache
  const pages = await selectAll<SdsPage>('sds_pages', 'slug, cas_number', (q) => q.eq('status', 'live'))
  const resp = await selectAll<Response>(
    'substance_response',
    'cas_number, cameo_chem_id, cameo_name, first_aid, fire_haz, fire_fight, non_fire_resp, idlh_value, niosh_pgd_file',
  )
  const byCas = new Map(resp.map((r) => [r.cas_number, r]))
  sdsCache = { pages, byCas }
  return sdsCache
}

// ───────────── Курируемый выбор записи CAMEO (session 33) ─────────────
//
// За 249 CAS в CAMEO стоит больше одной записи, и тексты §4/§5/§6 у них разные:
// у азотной кислоты — красная дымящая против обычной, у никеля — пирофорный
// катализатор Ренея против металла. Импорт брал наименьший chem_id, то есть по
// сути случайную запись. Теперь запись выбирается вручную и лежит в
// substance_cameo_choice; проверки ниже требуют, чтобы у КАЖДОЙ живой страницы
// с аварийными данными выбор существовал и совпадал с тем, что реально
// импортировано. Строка excluded = true — это тоже выбор: «подходящей записи в
// CAMEO нет, данные не берём» (оксид железа: единственная запись — IRON OXIDE,
// SPENT, самовозгорающаяся масса очистки газа).
type CameoChoice = { cas_number: string; chem_id: number | null; chosen_name: string | null; excluded: boolean }

let choiceCache: Map<string, CameoChoice> | null = null

async function cameoChoices(): Promise<Map<string, CameoChoice>> {
  if (choiceCache) return choiceCache
  const rows = await selectAll<CameoChoice>(
    'substance_cameo_choice',
    'cas_number, chem_id, chosen_name, excluded',
    (q) => q.order('cas_number'),
  )
  // ⚠ RLS без политики отдаёт anon пустую выборку, а не ошибку — урок session 21
  // и повтор 2026-08-03 на substance_cas_alias. Пустая таблица роняет прогон.
  assertNonEmpty('sds-cameo-choice', 'substance_cameo_choice', rows)
  choiceCache = new Map(rows.map((r) => [r.cas_number, r]))
  return choiceCache
}

/** Обратно из HTML-эскейпа: имена записей CAMEO содержат ' и & (4,4'-…). */
function unescapeHtml(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Слаги live-страниц, у которых выполняется предикат по substance_response. */
async function sdsSlugsWhere(pred: (r: Response | undefined) => boolean): Promise<Set<string>> {
  const { pages, byCas } = await sdsData()
  return new Set(pages.filter((p) => pred(p.cas_number ? byCas.get(p.cas_number) : undefined)).map((p) => p.slug))
}

const has = (v: string | null | undefined) => typeof v === 'string' && v.trim().length > 0

// ─────────────────── §3 structure: данные из базы (session 26) ───────────────────

type StructRow = {
  slug: string
  structure_kind: string | null
  svg_file: string | null
  pubchem_cid: number | null
  hybridization: Record<string, string> | null
}

let structCache: StructRow[] | null = null

/** Ровно тот же срез, что берёт getStaticPaths: только строки с PubChem CID. */
async function structureData(): Promise<StructRow[]> {
  if (structCache) return structCache
  // ⚠ S19.5/S23.9: selectAll пагинирует без порядка — сортировку задаём явно.
  const rows = await selectAll<StructRow>(
    'substance_structure',
    'slug, structure_kind, svg_file, pubchem_cid, hybridization',
    (q) => q.order('slug'),
  )
  structCache = rows.filter((r) => r.pubchem_cid != null)
  return structCache
}

// ───────── Страница вещества: §2 · §7 · §9…§15 (session 32) ─────────
//
// ⚠⚠ Зачем ещё один срез, когда рядом уже есть sdsData().
// sdsData отвечает на вопрос «что дала таблица substance_response» — ею живут
// §4, §5, §6 и §8, и они проверены с session 16. Разделы §2, §7, §9, §10, §11,
// §12, §13, §14, §15 растут из ДРУГОГО источника: строки `substances` и вердикта
// `get_storage_verdict`. Проверок на этот второй источник не было ни одной —
// и ровно он обвалился 2026-08-03, молча сняв §10 с 15 страниц, среди которых
// серная, соляная и азотная кислоты. Разбор: claude/silent-supabase-failures.md.
//
// ⚠ Вердикт спрашивается той же RPC и тем же CAS, что и страница
// (`substances.cas_number`, не `sds_pages.cas_number`): проверка обязана видеть
// ровно то, что видел рендер, иначе она сверяет две разные вселенные.
// mapLimit — по той же причине, по какой он стоит на странице: залп из сотни
// одновременных RPC валит пулер таймаутами, и проверка начинает врать.

const SUBSTANCE_COLS =
  'id, cas_number, ghs_pictogram_codes, h_statement_codes, euh_codes, ' +
  'ate_oral, ate_dermal, ate_inhalation_gas, ate_inhalation_vapour, ate_inhalation_dust, ' +
  'lc50_fish, ec50_daphnia, ec50_algae, ' +
  'flash_point, lel_vol_pct, uel_vol_pct, autoignition_c, ' +
  'melting_point, boiling_point, density, water_solubility, log_kow'

type SubRow = {
  id: number
  cas_number: string | null
  ghs_pictogram_codes: string[] | null
  h_statement_codes: string[] | null
  euh_codes: string[] | null
  ate_oral: number | null
  ate_dermal: number | null
  ate_inhalation_gas: number | null
  ate_inhalation_vapour: number | null
  ate_inhalation_dust: number | null
  lc50_fish: number | null
  ec50_daphnia: number | null
  ec50_algae: number | null
  flash_point: number | null
  lel_vol_pct: number | null
  uel_vol_pct: number | null
  autoignition_c: number | null
  melting_point: number | null
  boiling_point: number | null
  density: number | null
  water_solubility: string | null
  log_kow: number | null
}

type SubPage = {
  slug: string
  pageCas: string | null
  sub: SubRow | null
  /** §10: у вещества есть реактивная группа ИЛИ пара incompatible/caution. */
  stability: boolean
  /** UN-номера, которые §14 возьмёт из dg_substances — тем же путём, что страница. */
  dgUns: string[]
  /** UN-номера по расширенному набору CAS (алиасы) — запасной путь §14, как у вердикта. */
  aliasUns: string[]
}

/**
 * ⚠⚠ Кэшируем ПРОМИС, а не результат.
 *
 * Этот срез нужен четырнадцати проверкам сразу. Кэш по результату заполняется
 * только при успехе — значит после отказа КАЖДАЯ следующая проверка начинала
 * загрузку заново: 14 заходов по 78 вызовов RPC, то есть больше тысячи запросов
 * в базу, которая только что этот же вызов не вытянула. Первый таймаут
 * превращался в шторм (поймано 2026-08-03 на ацетилене).
 *
 * С кэшем по промису обращение к базе ровно одно: остальные проверки ждут тот
 * же промис и получают тот же ответ — успех или ту же самую ошибку.
 */
let subPageLoad: Promise<SubPage[]> | null = null

/**
 * `get_storage_verdict` с повтором на ВРЕМЕННОМ отказе.
 *
 * ⚠⚠ Почему повтор уместен здесь и категорически неуместен на сборке.
 * На сборке отказ запроса обязан ронять всё: страница без раздела опаснее, чем
 * сборка, которой не случилось (claude/silent-supabase-failures.md). Проверка
 * же ничего не публикует — она читает готовый dist, и падение из-за одного
 * таймаута правду не показывает, а прячет.
 *
 * ⚠ Повторяем ТОЛЬКО временное — таймаут, обрыв соединения. Ошибка прав или
 * отсутствующая функция повтора не переживёт и упадёт сразу, как и должна.
 */
async function verdictWithRetry(cas: string): Promise<any> {
  const TRANSIENT = /timeout|canceling statement|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i
  let last = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await supabase.rpc('get_storage_verdict', { p_cas: cas })
    if (!res.error) return res.data ?? null
    last = res.error.message
    if (!TRANSIENT.test(last)) break
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 900))
  }
  throw new Error(`get_storage_verdict(${cas}) — ${last}`)
}

/**
 * ⚠⚠⚠ ПОЧЕМУ ПРОВЕРКА БОЛЬШЕ НЕ ЗОВЁТ `get_storage_verdict` 78 РАЗ.
 *
 * Замер 2026-08-03: один вызов — **1,8 секунды** при полностью прогретом кэше
 * (`Buffers: shared hit=2175`, чтения с диска нет вовсе). Время уходит не на
 * данные, а на планирование десятка CTE внутри функции: каждый кусок по
 * отдельности отрабатывает за 3–40 мс.
 *
 * ⚠ А у роли `anon` в этом проекте `statement_timeout = 3 s`. То есть запас над
 * одним вызовом — чуть больше секунды, и любая конкуренция его съедает. Отсюда
 * `canceling statement due to statement timeout` на 13 проверках подряд, и,
 * почти наверняка, отсюда же пропажа §10 с 15 страниц на сборке 2026-08-03:
 * дело было не в «залпе» как таковом, а в том, что вызов изначально идёт на
 * грани лимита.
 *
 * Поэтому §10 и запасной путь §14 проверка считает САМА, тремя обычными
 * выборками (1 923 + 2 346 + 9 строк) вместо 78 тяжёлых вызовов. Логика ровно
 * та же, что в теле функции:
 *   cas_set  = CAS вещества + алиасы в обе стороны
 *   groups   = substance_reactive_group_link по cas_set
 *   пары     = reactive_group_compat, где группа с любой стороны, статус
 *              incompatible или caution
 *   §10 = groups не пусто ИЛИ пар больше нуля
 *
 * ⚠ Риск такого повтора — разъехаться с функцией и этого не заметить. Против
 * него стоит отдельная проверка `sds-verdict-canary`: она зовёт настоящую RPC
 * на трёх веществах и сверяет её ответ с локальным расчётом. Три вызова база
 * переживает, а расхождение логики становится видно сразу.
 */
type VerdictInputs = {
  aliasOf: Map<string, Set<string>>
  groupsByCas: Map<string, Set<number>>
  pairsFor: (groups: Set<number>) => number
  unsByCas: Map<string, Set<string>>
}

function casSetOf(cas: string, aliasOf: Map<string, Set<string>>): Set<string> {
  return aliasOf.get(cas) ?? new Set([cas])
}

function substancePages(): Promise<SubPage[]> {
  if (!subPageLoad) subPageLoad = loadSubstancePages()
  return subPageLoad
}

async function loadSubstancePages(): Promise<SubPage[]> {
  const pages = await selectAll<{ slug: string; cas_number: string | null; substance_id: number | null }>(
    'sds_pages',
    'slug, cas_number, substance_id',
    (q) => q.eq('status', 'live').order('slug'),
  )
  assertNonEmpty('sds-substance-pages', 'sds_pages', pages)

  const ids = [...new Set(pages.map((p) => p.substance_id).filter((v): v is number => v != null))]
  const subs = ids.length
    ? await selectAll<SubRow>('substances', SUBSTANCE_COLS, (q) => q.in('id', ids).order('id'))
    : []
  assertNonEmpty('sds-substance-rows', 'substances', subs)
  const byId = new Map(subs.map((s) => [s.id, s]))

  // ⚠ .order() обязателен: selectAll пагинирует по 1000, а без порядка PostgREST
  // не обязан отдавать строки последовательно (урок §S19.5).
  const links = await selectAll<{ cas_number: string; un_number: string }>(
    'substance_un_link',
    'cas_number, un_number',
    (q) => q.order('un_number'),
  )
  const dg = await selectAll<{ un_number: string }>('dg_substances', 'un_number', (q) => q.order('un_number'))
  assertNonEmpty('sds-dg', 'dg_substances', dg)
  const dgSet = new Set(dg.map((d) => d.un_number))

  verdictInputs = await loadVerdictInputs(links, dgSet)
  const { aliasOf, groupsByCas, pairsFor, unsByCas } = verdictInputs

  return pages.map((p) => {
    const sub = p.substance_id != null ? (byId.get(p.substance_id) ?? null) : null

    // §10 — вердикт, посчитанный локально. Почему не RPC: см. блок выше.
    let stability = false
    if (sub?.cas_number) {
      const set = casSetOf(sub.cas_number, aliasOf)
      const groups = new Set<number>()
      for (const c of set) for (const g of groupsByCas.get(c) ?? []) groups.add(g)
      stability = groups.size > 0 || pairsFor(groups) > 0
    }

    // §14 — ровно логика страницы: сначала dg_substances по ОБЕИМ формам CAS
    // (усечённой в substances у multi-CAS записей Annex VI и настоящей в
    // sds_pages), и только если там пусто — путь вердикта, то есть тот же
    // список UN, но по расширенному алиасами набору CAS.
    const forms = [...new Set([sub?.cas_number, p.cas_number].filter(Boolean))] as string[]
    const dgUns = [...new Set(forms.flatMap((f) => [...(unsByCas.get(f) ?? [])]))].sort()
    const aliasForms = sub?.cas_number ? [...casSetOf(sub.cas_number, aliasOf)] : []
    const aliasUns = [...new Set(aliasForms.flatMap((f) => [...(unsByCas.get(f) ?? [])]))].sort()

    return { slug: p.slug, pageCas: p.cas_number, sub, stability, dgUns, aliasUns }
  })
}

let verdictInputs: VerdictInputs | null = null

/** Три обычные выборки вместо 78 вызовов RPC — см. блок над VerdictInputs. */
async function loadVerdictInputs(
  links: { cas_number: string; un_number: string }[],
  dgSet: Set<string>,
): Promise<VerdictInputs> {
  const aliases = await selectAll<{ alias_cas: string; canonical_cas: string }>(
    'substance_cas_alias',
    'alias_cas, canonical_cas',
    (q) => q.order('alias_cas'),
  )
  // ⚠⚠ Урок session 21, на который наступили ещё раз 2026-08-03.
  // У `substance_cas_alias` RLS включён, а политики чтения НЕТ — для anon это не
  // ошибка, а пустая выборка. Расчёт §10 молча терял пять веществ с усечённым
  // multi-CAS Annex VI (борная кислота, гептан, MDI, TDI, ксилол): их настоящий
  // CAS лежит именно в этой таблице. Проверка показывала 72 вместо 77 и выглядела
  // как «сборка потеряла блок», хотя блок был на месте.
  // ⚠ RPC этого не замечает: она SECURITY DEFINER и читает таблицу мимо RLS.
  // Поэтому расхождение и появляется ТОЛЬКО в прямом чтении.
  assertNonEmpty('sds-cas-alias', 'substance_cas_alias', aliases)
  const rgLinks = await selectAll<{ cas_number: string; rg_id: number }>(
    'substance_reactive_group_link',
    'cas_number, rg_id',
    (q) => q.order('cas_number'),
  )
  assertNonEmpty('sds-rg-links', 'substance_reactive_group_link', rgLinks)
  const compat = await selectAll<{ rg_a: number; rg_b: number; status: string }>(
    'reactive_group_compat',
    'rg_a, rg_b, status',
    (q) => q.order('rg_a'),
  )
  assertNonEmpty('sds-rg-compat', 'reactive_group_compat', compat)

  // Классы эквивалентности CAS: alias -> canonical и обратно, плюс «братья»
  // по общему canonical — ровно те четыре ветки UNION, что делает cas_set в SQL.
  const byCanonical = new Map<string, Set<string>>()
  for (const a of aliases) {
    if (!byCanonical.has(a.canonical_cas)) byCanonical.set(a.canonical_cas, new Set([a.canonical_cas]))
    byCanonical.get(a.canonical_cas)!.add(a.alias_cas)
  }
  const aliasOf = new Map<string, Set<string>>()
  for (const [canon, members] of byCanonical) {
    for (const m of members) {
      if (!aliasOf.has(m)) aliasOf.set(m, new Set())
      for (const x of members) aliasOf.get(m)!.add(x)
    }
    void canon
  }

  const groupsByCas = new Map<string, Set<number>>()
  for (const l of rgLinks) {
    if (!groupsByCas.has(l.cas_number)) groupsByCas.set(l.cas_number, new Set())
    groupsByCas.get(l.cas_number)!.add(l.rg_id)
  }

  const relevant = compat.filter((c) => c.status === 'incompatible' || c.status === 'caution')
  const pairsFor = (groups: Set<number>): number =>
    groups.size === 0 ? 0 : relevant.filter((c) => groups.has(c.rg_a) || groups.has(c.rg_b)).length

  const unsByCas = new Map<string, Set<string>>()
  for (const l of links) {
    if (!dgSet.has(l.un_number)) continue
    if (!unsByCas.has(l.cas_number)) unsByCas.set(l.cas_number, new Set())
    unsByCas.get(l.cas_number)!.add(l.un_number)
  }

  return { aliasOf, groupsByCas, pairsFor, unsByCas }
}

/** Слаги страниц, для которых выполняется предикат по строке substances + вердикту. */
async function subSlugsWhere(pred: (p: SubPage) => boolean): Promise<Set<string>> {
  return new Set((await substancePages()).filter(pred).map((p) => p.slug))
}

const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v)
/** «Заполненное» число: ate_* и eco_* держат 0 как незаполненный placeholder. */
const positive = (v: unknown): boolean => typeof v === 'number' && v > 0

/** Есть ли у вещества хоть одно физ-хим значение — ровно те поля, что печатает §9. */
function hasPhysData(s: SubRow | null): boolean {
  if (!s) return false
  return (
    isNum(s.flash_point) ||
    isNum(s.lel_vol_pct) ||
    isNum(s.uel_vol_pct) ||
    isNum(s.autoignition_c) ||
    isNum(s.melting_point) ||
    isNum(s.boiling_point) ||
    positive(s.density) ||
    (typeof s.water_solubility === 'string' && s.water_solubility.trim().length > 0) ||
    isNum(s.log_kow)
  )
}

/** §11 показывается только при СТРОГО положительном ATE — ноль означает «не импортировано». */
const hasAte = (s: SubRow | null): boolean =>
  !!s &&
  (positive(s.ate_oral) ||
    positive(s.ate_dermal) ||
    positive(s.ate_inhalation_gas) ||
    positive(s.ate_inhalation_vapour) ||
    positive(s.ate_inhalation_dust))

/** §12 — та же логика > 0. Сегодня даёт пустое множество: эко-импорта ещё не было. */
const hasEco = (s: SubRow | null): boolean =>
  !!s && (positive(s.lc50_fish) || positive(s.ec50_daphnia) || positive(s.ec50_algae))

/** §14 — UN-номера, которые страница обязана напечатать: dg_substances, иначе путь вердикта. */
function expectedUns(p: SubPage): string[] {
  return p.dgUns.length ? p.dgUns : p.aliasUns
}

/**
 * Сверка НАБОРА НАПЕЧАТАННЫХ ЗНАЧЕНИЙ, а не наличия блока.
 *
 * ⚠ Почему это отдельный вид проверки. comparePageSets отвечает «блок есть или
 * блока нет» — и остался бы зелёным, напечатай страница чужие пиктограммы или
 * потеряй половину H-кодов. Такой отказ выглядит как правдоподобная страница, и
 * глазами его не ловят.
 *
 * ⚠ Формы маркеров выверены на сборке 2026-08-03 (109 страниц): именно
 * `>GHS02<`, `>H314</a>` и `>UN 1830<` дают РОВНО набор из базы. Голый `GHS02`
 * не годится — те же коды идут прозой в FAQ и в JSON-LD, и проверка считала бы
 * их по второму разу.
 */
function compareValueSets(
  id: string,
  group: string,
  relDir: string,
  extract: (html: string) => string[],
  expected: Map<string, string[]>,
  noun: string,
): Result {
  const detail: string[] = []
  let checked = 0
  let values = 0
  for (const slug of pageSlugs(relDir)) {
    const html = readPage(`${relDir}/${slug}/index.html`)
    if (html === null) continue
    checked++
    const actual = [...new Set(extract(html))].sort()
    const want = [...new Set(expected.get(slug) ?? [])].sort()
    values += actual.length
    if (actual.join(',') !== want.join(',')) {
      detail.push(`${slug}: база [${want.join(', ') || '-'}] / страница [${actual.join(', ') || '-'}]`)
    }
  }
  const ok = detail.length === 0
  return {
    id,
    group,
    ok,
    headline: ok
      ? `${values} ${noun} на ${checked} страницах — все совпали с базой`
      : `расходится на ${detail.length} из ${checked} страниц`,
    detail: ok ? [`сверено поимённо, страниц: ${checked}`] : detail.slice(0, 20),
  }
}

const rxAll = (html: string, re: RegExp): string[] => [...html.matchAll(re)].map((m) => m[1])

// ─────────────────────── P-фразы: данные из базы ───────────────────────

type PStatement = { code: string; category: string; status: string }

let pCache: PStatement[] | null = null

/** Реестр P-кодов целиком: объединение кодов всех юрисдикций, не только CLP. */
async function pCodes(): Promise<PStatement[]> {
  if (pCache) return pCache
  pCache = await selectAll<PStatement>('p_statements', 'code, category, status')
  return pCache
}

let pCountCache: Map<string, number> | null = null

/** code -> число веществ, ровно тем же вызовом, каким его берёт страница. */
async function pCounts(): Promise<Map<string, number>> {
  if (pCountCache) return pCountCache
  const { data, error } = await supabase.rpc('get_statement_counts')
  if (error) throw new Error(`get_statement_counts: ${error.message}`)
  const rows = (data ?? []) as { code: string; kind: string; substances: number }[]
  pCountCache = new Map(rows.filter((r) => r.kind === 'P').map((r) => [r.code, r.substances]))
  return pCountCache
}

// ─────────────────────── H-фразы: данные из базы ───────────────────────

/**
 * ⚠ Урок session 21: у трёх таблиц H-фраз RLS был включён, а политик не было.
 * Для anon это не ошибка, а пустая выборка — и проверка, читающая ту же таблицу
 * тем же ключом, радостно сообщала «0 страниц в dist, база ожидает 0».
 * Три блока страницы отсутствовали, а check:dist был зелёным.
 * Теперь пустой ответ там, где строки обязаны быть, — это провал.
 */
function assertNonEmpty(id: string, table: string, rows: unknown[]): void {
  if (rows.length === 0) {
    throw new Error(
      `${id}: таблица ${table} вернула НОЛЬ строк. ` +
        'Так выглядит RLS без политики на чтение для anon — проверьте политики, ' +
        'прежде чем считать, что данных действительно нет.',
    )
  }
}

type HStatement = { code: string; category: string; status: string }

let hCache: HStatement[] | null = null

/** Реестр H-кодов целиком: и H, и EUH, и коды, которых в EU CLP нет. */
async function hCodes(): Promise<HStatement[]> {
  if (hCache) return hCache
  hCache = await selectAll<HStatement>('h_statements', 'code, category, status')
  assertNonEmpty('h-codes', 'h_statements', hCache)
  return hCache
}

let hCountCache: Map<string, number> | null = null

/** code -> число веществ. ⚠ Счётчик отдаёт H и EUH разными видами, хаб их объединяет. */
async function hCounts(): Promise<Map<string, number>> {
  if (hCountCache) return hCountCache
  const { data, error } = await supabase.rpc('get_statement_counts')
  if (error) throw new Error(`get_statement_counts: ${error.message}`)
  const rows = (data ?? []) as { code: string; kind: string; substances: number }[]
  hCountCache = new Map(
    rows.filter((r) => r.kind === 'H' || r.kind === 'EUH').map((r) => [r.code, r.substances]),
  )
  return hCountCache
}

const PICT_CODES = ['GHS01', 'GHS02', 'GHS03', 'GHS04', 'GHS05', 'GHS06', 'GHS07', 'GHS08', 'GHS09']

/**
 * Наборы пиктограмм по веществам — ровно тем же фильтром и той же сортировкой, что
 * страница /pictograms/ (session 23): только записи с CAS, порядок по index_number.
 * ⚠ Без .order() постраничная выборка не гарантирует ни полноты, ни отсутствия дублей —
 * это ровно тот способ промахнуться, что разбирался в §S19.5.
 */
async function pictogramSets(): Promise<string[][]> {
  const rows = await selectAll<{ index_number: string; ghs_pictogram_codes: string[] | null }>(
    'substances',
    'index_number, ghs_pictogram_codes',
    (q: any) => q.not('cas_number', 'is', null).not('ghs_pictogram_codes', 'is', null).order('index_number'),
  )
  assertNonEmpty('pictogram-sets', 'substances', rows)
  const out: string[][] = []
  for (const r of rows) {
    const set = Array.from(new Set((r.ghs_pictogram_codes ?? []).filter((c) => PICT_CODES.includes(c))))
    if (set.length) out.push(set)
  }
  return out
}

/** Разбирает маркеры вида data-<name>="ключ|значение" со страницы хаба. */
function hubMarkers(html: string, name: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of html.matchAll(new RegExp(`data-${name}="([^"]+)"`, 'g'))) {
    const raw = m[1].replace(/&#43;/g, '+').replace(/&amp;/g, '&')
    const cut = raw.indexOf('|')
    if (cut > 0) out.set(raw.slice(0, cut), raw.slice(cut + 1))
  }
  return out
}


// ───────────────────── имена веществ (session 34) ─────────────────────

/**
 * Как страница печатает имя: substanceNameFull() из src/lib/substanceName.ts,
 * а затем clean() внутри самой страницы — он схлопывает пробелы и превращает
 * перевод строки в «; ». Повторяем ровно это, иначе сверка соврёт.
 */
function pageCleanName(raw: string): string {
  return raw.replace(/\r?\n+/g, '; ').replace(/\s+/g, ' ').trim()
}

let displayNameCache: Set<string> | null = null

/** Имена, которые вещество имеет право показать: common_name → display_name_short → iupac_name. */
async function expectedDisplayNames(): Promise<Set<string>> {
  if (displayNameCache) return displayNameCache
  const rows = await selectAll<{
    common_name: string | null
    display_name_short: string | null
    iupac_name: string | null
  }>(
    'substances',
    'index_number, common_name, display_name_short, iupac_name',
    (q: any) => q.order('index_number'),
  )
  // ⚠ RLS без политики отдаёт anon пустоту, а не ошибку — без этой строки проверка молча позеленеет
  assertNonEmpty('substance-display-name', 'substances', rows)
  const out = new Set<string>()
  for (const r of rows) {
    const name = r.common_name?.trim() || r.display_name_short?.trim() || (r.iupac_name ?? '').trim()
    if (name) out.add(pageCleanName(name))
  }
  displayNameCache = out
  return out
}

/**
 * Распаковка атрибута полностью, включая ЧИСЛОВЫЕ сущности.
 * ⚠ Без этого проверка врёт: имя 2,2',2"-(hexahydro-…) печатается как
 * 2,2',2&#34;-(hexahydro-…, а запись &#34; сама кончается точкой с запятой —
 * и правило «в имени не должно быть ;» срабатывает на пустом месте.
 * Числовые сущности раскрываем ПЕРВЫМИ, &amp; — последним (это делает
 * unescapeHtml), иначе получится двойная распаковка.
 */
function unescapeAttr(s: string): string {
  const numeric = s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  return unescapeHtml(numeric)
}

/** Подписи веществ из списков: <span class="name" title="ПОЛНОЕ">обрезанное</span>. */
function printedSubstanceNames(): { name: string; page: string }[] {
  const out: { name: string; page: string }[] = []
  const re = /<span class="name" title="([^"]*)"/g
  for (const { rel, html } of allPages()) {
    if (!rel.startsWith('h-statements/') && !rel.startsWith('p-statements/')) continue
    for (const m of html.matchAll(re)) out.push({ name: unescapeAttr(m[1]), page: rel })
  }
  return out
}


// ───────────────────── справочник веществ (session 35) ─────────────────────
//
// ⚠⚠ ЗАЧЕМ ЭТА ГРУППА. Старые страницы веществ на ghssymbols рендерились
// островом `client:load`: в статике лежало 25 КБ разметки и ни слова о
// веществе. Google: 1 929 показов, 3 клика, CTR 0,16 %. Дефект был не виден
// ни в браузере, ни в dev — только в исходном коде отданного файла.
// Поэтому subs-static-content проверяет не «страница собралась», а
// «в файле физически лежит имя, CAS и хотя бы одно число».

type SubstanceRow = {
  cas_number: string
  common_name: string | null
  display_name_short: string | null
  iupac_name: string | null
}

type SubstanceExpectation = {
  /** slug -> строка базы */
  bySlug: Map<string, { row: SubstanceRow; name: string; cas: string }>
  /** все CAS, для которых страница обязана существовать */
  casSet: Set<string>
  /** сколько строк базы прошло отбор (может быть больше числа слагов при коллизии) */
  rowCount: number
}

let substanceExpectationCache: SubstanceExpectation | null = null

/**
 * Ровно тот же срез, что берёт getStaticPaths в src/pages/substances/[slug].astro:
 *   cas_number не null  +  в cas_number нет '['
 * ⚠ Разойтись здесь со страницей — значит получить вечно красную проверку либо,
 * что хуже, вечно зелёную при недостроенном разделе.
 */
async function substanceExpectation(): Promise<SubstanceExpectation> {
  if (substanceExpectationCache) return substanceExpectationCache
  const raw = await selectAll<SubstanceRow>(
    'substances',
    `cas_number, ${NAME_COLUMNS}`,
    (q: any) => q.not('cas_number', 'is', null).order('cas_number'),
  )
  // ⚠ RLS без политики отдаёт anon пустоту, а не ошибку — без этой строки проверка молча позеленеет
  assertNonEmpty('subs-pages', 'substances', raw)

  // ⚠⚠ Отбор по ФОРМЕ CAS, ровно как в getStaticPaths страницы вещества.
  // 156 записей несут многосоставный CAS, обрезанный varchar(20)
  // («110-45-2[1]35073-27-»), и ещё три CAS не являются вовсе: `-`,
  // `127087-87-09016-45-9`, `3811-73-215922-78-8`. Страницы для них не строятся.
  // ⚠ Правило продублировано в пяти местах — при правке менять везде:
  // substances/[slug].astro, substances/browse/[letter].astro,
  // substances/index.astro, sitemap.xml.ts, ghssymbols/scripts/generate-substance-redirect-map.mjs.
  const rows = raw.filter((r) => r.cas_number && /^\d{2,7}-\d{2}-\d$/.test(r.cas_number))

  const bySlug = new Map<string, { row: SubstanceRow; name: string; cas: string }>()
  const casSet = new Set<string>()
  for (const row of rows) {
    const name = substanceNameFull(row)
    bySlug.set(substanceSlug(name, row.cas_number), { row, name, cas: row.cas_number })
    casSet.add(row.cas_number)
  }
  substanceExpectationCache = { bySlug, casSet, rowCount: rows.length }
  return substanceExpectationCache
}

/** Слаги собранных страниц раздела. Пустой ответ отличаем от «папки нет». */
function builtSubstanceSlugs(): string[] | null {
  return existsSync(join(DIST, 'substances')) ? pageSlugs('substances') : null
}

/** Одно и то же объяснение для всех проверок группы: раздела в dist нет. */
function substanceSectionMissing(id: string, slugs: string[] | null): Result | null {
  if (slugs === null) {
    return {
      id,
      group: 'subs',
      ok: false,
      headline: `нет папки ${join(DIST, 'substances')}`,
      detail: [
        'Раздел /substances/ не собран. Проверка НЕ считается пройденной:',
        'зелёный ответ на отсутствующем разделе — это и есть тихий провал.',
        'Собрать: npm run build, затем npm run check:dist -- --only subs',
      ],
    }
  }
  if (slugs.length === 0) {
    return {
      id,
      group: 'subs',
      ok: false,
      headline: 'в dist/substances/ ноль страниц веществ',
      detail: [
        'Папка есть, но в ней только index.html хаба — ни одной подпапки со страницей.',
        'Похоже, getStaticPaths вернул пустой список: чаще всего это отказ запроса',
        'к substances или пустой ответ RLS. Смотреть лог npm run build.',
      ],
    }
  }
  return null
}


const CHECKS: Check[] = [
  {
    id: 'sds-pages',
    group: 'SDS',
    title: 'Набор страниц /sds/ равен набору live в базе',
    run: async () => {
      const { pages } = await sdsData()
      const expected = new Set(pages.map((p) => p.slug))
      const actual = new Set(pageSlugs('sds'))
      const { missing, extra } = diffSets(actual, expected)
      const detail: string[] = []
      if (missing.length) detail.push(`live в базе, но нет в dist (${missing.length}): ${preview(missing)}`)
      if (extra.length) detail.push(`есть в dist, но не live в базе (${extra.length}): ${preview(extra)}`)
      return {
        id: 'sds-pages',
        group: 'SDS',
        ok: !missing.length && !extra.length,
        headline: `${actual.size} страниц в dist, ${expected.size} live в базе`,
        detail,
      }
    },
  },
  {
    id: 'sds-s4',
    group: 'SDS',
    title: 'Section 4 — First aid',
    run: async () =>
      comparePageSets('sds-s4', 'SDS', 'sds', ['id="s4"'], await sdsSlugsWhere((r) => has(r?.first_aid))),
  },
  {
    id: 'sds-s5',
    group: 'SDS',
    title: 'Section 5 — Fire fighting',
    run: async () =>
      comparePageSets(
        'sds-s5',
        'SDS',
        'sds',
        ['id="s5"'],
        await sdsSlugsWhere((r) => has(r?.fire_haz) || has(r?.fire_fight)),
      ),
  },
  {
    id: 'sds-s6',
    group: 'SDS',
    title: 'Section 6 — Spill and leak response',
    run: async () =>
      comparePageSets('sds-s6', 'SDS', 'sds', ['id="s6"'], await sdsSlugsWhere((r) => has(r?.non_fire_resp))),
  },
  {
    // ⚠⚠ Главная защита от дефекта session 32: аварийные тексты одного продукта
    // на странице другого. Импорт без строки выбора запрещён — иначе он снова
    // возьмёт наименьший chem_id, и никель снова получит тексты Ренея.
    id: 'sds-cameo-choice',
    group: 'SDS',
    title: 'Запись CAMEO выбрана курируемо и совпадает с импортом',
    run: async () => {
      const { pages, byCas } = await sdsData()
      const choices = await cameoChoices()
      const noChoice: string[] = []
      const drifted: string[] = []
      const excludedButPresent: string[] = []
      let checked = 0
      for (const p of pages) {
        if (!p.cas_number) continue
        const r = byCas.get(p.cas_number)
        const c = choices.get(p.cas_number)
        if (!r) {
          // Данных нет — выбор нужен только если он объявлен исключением.
          if (c && !c.excluded) noChoice.push(`${p.slug}: выбор есть (${c.chem_id}), а строки в substance_response нет`)
          continue
        }
        checked++
        if (!c) {
          noChoice.push(`${p.slug} (${p.cas_number}): импортирована запись ${r.cameo_chem_id}, курируемого выбора нет`)
          continue
        }
        if (c.excluded) {
          excludedButPresent.push(`${p.slug}: помечен excluded, но §4-§6 импортированы (${r.cameo_chem_id})`)
          continue
        }
        if (c.chem_id !== r.cameo_chem_id) {
          drifted.push(`${p.slug}: выбрано ${c.chem_id} (${c.chosen_name}), импортировано ${r.cameo_chem_id} (${r.cameo_name})`)
        }
      }
      const detail = [...noChoice, ...drifted, ...excludedButPresent]
      const ok = detail.length === 0
      return {
        id: 'sds-cameo-choice',
        group: 'SDS',
        ok,
        headline: ok
          ? `${checked} страниц с §4-§6, у каждой выбор записи CAMEO явный и совпадает с импортом`
          : `${detail.length} расхождений выбора записи CAMEO`,
        detail: ok ? [`substance_cameo_choice: ${choices.size} строк`] : detail.slice(0, 20),
      }
    },
  },
  {
    // Подпись «§4-§6 воспроизводят запись X» — это не украшение. У формальдегида
    // §9 описывает газ (т. кип. -21 C), а §4-§6 — 37-50 % раствор, потому что
    // чистого газа в CAMEO нет вовсе. Без подписи читатель этого не увидит.
    id: 'sds-cameo-entry-shown',
    group: 'SDS',
    title: 'Section 4 — на странице напечатано имя записи CAMEO',
    run: async () => {
      const { pages, byCas } = await sdsData()
      const expected = new Map<string, string[]>(
        pages.map((p) => {
          const r = p.cas_number ? byCas.get(p.cas_number) : undefined
          // Подпись живёт внутри §4, поэтому ждём её ровно там, где есть first_aid.
          return [p.slug, r && has(r.first_aid) && r.cameo_name ? [r.cameo_name] : []]
        }),
      )
      return compareValueSets(
        'sds-cameo-entry-shown',
        'SDS',
        'sds',
        // \s* между текстом и тегом: Astro волен перенести строку на границе
        // выражения, и жёсткий пробел дал бы ложную тревогу вместо находки.
        (html) => rxAll(html, /reproduce the CAMEO Chemicals entry\s*<strong>([^<]+)<\/strong>/g).map(unescapeHtml),
        expected,
        'имён записи',
      )
    },
  },
  {
    // Второй дефект того же импорта: реактивные группы собирались объединением
    // по ВСЕМ записям CAS, поэтому у чистого вещества появлялись свойства его
    // смесей (у едкого натра — гидриды металлов от раствора с боргидридом).
    // Обратная сторона нашлась в session 33: у 22 живых страниц групп не было
    // вообще, включая аммиачную селитру и оксид кальция, и калькулятор
    // совместимости про них молчал. Группы питают §7, §10 и калькулятор, так что
    // пустота здесь — не косметика.
    id: 'sds-cameo-groups',
    group: 'SDS',
    title: 'У выбранной записи CAMEO есть реактивные группы в базе',
    run: async () => {
      const choices = await cameoChoices()
      const links = await selectAll<{ cas_number: string; rg_id: number }>(
        'substance_reactive_group_link',
        'cas_number, rg_id',
        (q) => q.order('cas_number'),
      )
      assertNonEmpty('sds-cameo-groups', 'substance_reactive_group_link', links)
      const byCas = new Map<string, number>()
      for (const l of links) byCas.set(l.cas_number, (byCas.get(l.cas_number) ?? 0) + 1)
      const { pages } = await sdsData()
      const empty: string[] = []
      let checked = 0
      for (const p of pages) {
        if (!p.cas_number) continue
        const c = choices.get(p.cas_number)
        if (!c || c.excluded) continue
        checked++
        if (!byCas.get(p.cas_number)) empty.push(`${p.slug} (${p.cas_number}): выбрана ${c.chosen_name}, групп нет`)
      }
      const ok = empty.length === 0
      return {
        id: 'sds-cameo-groups',
        group: 'SDS',
        ok,
        headline: ok
          ? `${checked} веществ с курируемым выбором, у всех есть реактивные группы`
          : `${empty.length} веществ без реактивных групп`,
        detail: ok ? ['группы питают §7, §10 и калькулятор совместимости'] : empty.slice(0, 20),
      }
    },
  },
  {
    // §8 (session 27). Секция рендерится там, где у вещества есть запись в NIOSH
    // Pocket Guide — 76 страниц. IDLH при этом заполнен только у 63.
    id: 'sds-s8',
    group: 'SDS',
    title: 'Section 8 — Exposure limits (NIOSH entry)',
    run: async () =>
      comparePageSets('sds-s8', 'SDS', 'sds', ['id="s8"'], await sdsSlugsWhere((r) => has(r?.niosh_pgd_file))),
  },
  {
    // ⚠ Карточка со значением — строго подмножество: 63 из 76. Маркер только
    // ASCII (§S26.7: assertAscii роняет проверку на не-ASCII строке).
    id: 'sds-s8-idlh-value',
    group: 'SDS',
    title: 'Section 8 — IDLH value card',
    run: async () =>
      comparePageSets(
        'sds-s8-idlh-value',
        'SDS',
        'sds',
        ['Immediately Dangerous to Life or Health'],
        await sdsSlugsWhere((r) => r?.idlh_value != null),
      ),
  },
  {
    id: 'sds-emergency',
    group: 'SDS',
    title: 'Emergency mode — кнопка и оверлей (нужны все три блока)',
    run: async () =>
      comparePageSets(
        'sds-emergency',
        'SDS',
        'sds',
        ['id="emergency"', 'Incident in progress', 'Call emergency services first'],
        await sdsSlugsWhere(
          (r) => has(r?.first_aid) && (has(r?.fire_haz) || has(r?.fire_fight)) && has(r?.non_fire_resp),
        ),
      ),
  },
  {
    id: 'sds-no-artifacts',
    group: 'SDS',
    title: 'Негативные маркеры: следов сырого импорта и артефактов рендера нет',
    run: async () =>
      expectAbsent('sds-no-artifacts', 'SDS', 'sds', [
        'Excerpt from ERG Guide', // сырой префикс CAMEO — дефект импорта session 16
        '[object Object]',
        'undefined</',
        'NaN</',
        'Invalid Date',
      ]),
  },
  {
    id: 'sds-hub-autocomplete',
    group: 'SDS',
    title: 'Автокомплит на хабе /sds/ — поведение доехало',
    run: async () =>
      expectBehaviour('sds-hub-autocomplete', 'SDS', 'sds/index.html', [
        'sds-ac-data',
        'role="combobox"',
        'matched synonym',
      ]),
  },
  {
    id: 'sds-hub-payload',
    group: 'SDS',
    title: 'Payload автокомплита содержит все live-страницы',
    run: async () => {
      const { pages } = await sdsData()
      const html = readPage('sds/index.html')
      if (!html) {
        return { id: 'sds-hub-payload', group: 'SDS', ok: false, headline: 'нет sds/index.html', detail: [] }
      }
      const m = html.match(/<script[^>]*id="sds-ac-data"[^>]*>([\s\S]*?)<\/script>/)
      if (!m) {
        return {
          id: 'sds-hub-payload',
          group: 'SDS',
          ok: false,
          headline: 'на хабе нет <script id="sds-ac-data">',
          detail: [],
        }
      }
      let rows: unknown[]
      try {
        rows = JSON.parse(m[1]) as unknown[]
      } catch (e) {
        return {
          id: 'sds-hub-payload',
          group: 'SDS',
          ok: false,
          headline: 'payload не разбирается как JSON',
          detail: [String(e)],
        }
      }
      const expected = new Set(pages.map((p) => p.slug))
      const actual = new Set(rows.map((r) => String((r as unknown[])[0])))
      const { missing, extra } = diffSets(actual, expected)
      const detail: string[] = []
      if (missing.length) detail.push(`нет в payload (${missing.length}): ${preview(missing)}`)
      if (extra.length) detail.push(`лишние в payload (${extra.length}): ${preview(extra)}`)
      return {
        id: 'sds-hub-payload',
        group: 'SDS',
        ok: !missing.length && !extra.length,
        headline: `${rows.length} строк в payload, ${expected.size} live в базе`,
        detail,
      }
    },
  },
  {
    id: 'sds-structure',
    group: 'SDS',
    title: 'Section 3 — блок структуры там, где в базе есть PubChem CID',
    run: async () =>
      comparePageSets(
        'sds-structure',
        'SDS',
        'sds',
        // ⚠ Правило 3: маркер только ASCII. Метка секции в HTML идёт как
        // "§ 03 · Composition and identifiers" — берём её ASCII-хвост.
        ['id="structure"', 'Composition and identifiers'],
        new Set((await structureData()).map((r) => r.slug)),
      ),
  },
  {
    id: 'sds-structure-svg',
    group: 'SDS',
    title: 'Картинка структуры на странице там, где в базе есть svg_file',
    run: async () =>
      comparePageSets(
        'sds-structure-svg',
        'SDS',
        'sds',
        ['src="/structures/'],
        new Set((await structureData()).filter((r) => r.svg_file).map((r) => r.slug)),
      ),
  },
  {
    id: 'sds-structure-files',
    group: 'SDS',
    title: 'Каждый svg_file из базы физически лежит в dist/structures/',
    run: async () => {
      // ⚠ Урок S23.3: на файл, на который ссылается код, легко сослаться и не
      // положить его — и картинка молча битая. Считаем файлы, а не разметку.
      const rows = (await structureData()).filter((r) => r.svg_file)
      const missing = rows
        .filter((r) => !existsSync(join(DIST, 'structures', String(r.svg_file))))
        .map((r) => `${r.slug} -> ${r.svg_file}`)
      const dir = join(DIST, 'structures')
      const onDisk = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.svg')) : []
      const expected = new Set(rows.map((r) => String(r.svg_file)))
      const extra = onDisk.filter((f) => !expected.has(f))
      const detail: string[] = []
      if (missing.length) detail.push(`база ссылается, файла нет (${missing.length}): ${preview(missing)}`)
      if (extra.length) detail.push(`файл есть, база не ссылается (${extra.length}): ${preview(extra)}`)
      return {
        id: 'sds-structure-files',
        group: 'SDS',
        ok: !missing.length && !extra.length,
        headline: `${onDisk.length} SVG в dist/structures/, база ожидает ${expected.size}`,
        detail,
      }
    },
  },
  {
    id: 'sds-structure-molecular-only',
    group: 'SDS',
    title: 'Гибридизация и электроны — только на молекулярных страницах',
    run: async () =>
      comparePageSets(
        'sds-structure-molecular-only',
        'SDS',
        'sds',
        ['Hybridisation'],
        // ⚠ Для ионного вещества RDKit считал гибридизацию по ОДНОМУ иону, а не
        // по соединению. Значения в базе есть, но на странице их быть не должно.
        new Set(
          (await structureData())
            .filter((r) => r.structure_kind === 'molecular' && r.hybridization && Object.keys(r.hybridization).length)
            .map((r) => r.slug),
        ),
      ),
  },
  // ───────── §2 · §7 · §9…§15 — вторая половина страницы вещества (session 32) ─────────
  //
  // ⚠ Все ожидания ниже считаются из базы в момент запуска, ни одного числа в коде.
  // Сегодняшний расклад (2026-08-03, 109 live-страниц): substance есть у 78, §10 — 77,
  // §14 — 53, §11 — 5, §12 и §15 — ноль. Числа тут только как ориентир для чтения;
  // проверка спрашивает их заново.
  {
    id: 'sds-s2',
    group: 'SDS',
    title: 'Section 2 — Hazards identification (есть строка в substances)',
    run: async () =>
      comparePageSets('sds-s2', 'SDS', 'sds', ['id="s2"'], await subSlugsWhere((p) => p.sub !== null)),
  },
  {
    // ⚠ Не «блок на месте», а «напечатаны ТЕ САМЫЕ пиктограммы». Ошибка в наборе
    // пиктограмм на странице химической безопасности — это неверная маркировка,
    // и выглядит она совершенно нормально.
    id: 'sds-s2-pictograms',
    group: 'SDS',
    title: 'Section 2 — набор пиктограмм совпадает с ghs_pictogram_codes',
    run: async () =>
      compareValueSets(
        'sds-s2-pictograms',
        'SDS',
        'sds',
        (html) => rxAll(html, />(GHS0\d)</g),
        new Map((await substancePages()).map((p) => [p.slug, p.sub?.ghs_pictogram_codes ?? []])),
        'пиктограмм',
      ),
  },
  {
    // H и EUH идут на странице одной и той же ссылкой (hHref), поэтому и сверяются
    // объединением. ⚠ Суффиксы важны: H361d, H360Fd, H361fd — это РАЗНЫЕ записи
    // Annex VI, и подрезать их до H361 нельзя.
    id: 'sds-s2-h-codes',
    group: 'SDS',
    title: 'Section 2 — набор H- и EUH-кодов совпадает с базой',
    run: async () =>
      compareValueSets(
        'sds-s2-h-codes',
        'SDS',
        'sds',
        (html) => rxAll(html, />((?:EU)?H\d{3}[A-Za-z]*)<\/a>/g),
        new Map(
          (await substancePages()).map((p) => [
            p.slug,
            [...(p.sub?.h_statement_codes ?? []), ...(p.sub?.euh_codes ?? [])],
          ]),
        ),
        'кодов',
      ),
  },
  {
    id: 'sds-s7',
    group: 'SDS',
    title: 'Section 7 — Handling and storage',
    run: async () =>
      comparePageSets('sds-s7', 'SDS', 'sds', ['id="s7"'], await subSlugsWhere((p) => p.sub !== null)),
  },
  {
    id: 'sds-s9',
    group: 'SDS',
    title: 'Section 9 — блок физ-хим свойств (в любой из двух форм)',
    run: async () =>
      comparePageSets('sds-s9', 'SDS', 'sds', ['id="s9"'], await subSlugsWhere((p) => p.sub !== null)),
  },
  {
    // ⚠ У §9 ДВЕ формы, и различать их обязательно: страница с данными и страница
    // с честной строкой «значения ещё импортируются» несут один и тот же id="s9".
    // Проверка только по id пропустила бы день, когда таблица значений исчезла и
    // все 78 страниц молча съехали на заглушку.
    id: 'sds-s9-values',
    group: 'SDS',
    title: 'Section 9 — таблица значений там, где значения есть в базе',
    run: async () =>
      comparePageSets(
        'sds-s9-values',
        'SDS',
        'sds',
        ['Source: CAMEO Chemicals (NOAA, public domain); per-value source references'],
        await subSlugsWhere((p) => hasPhysData(p.sub)),
      ),
  },
  {
    id: 'sds-s9-stub',
    group: 'SDS',
    title: 'Section 9 — заглушка ровно там, где значений в базе нет',
    run: async () =>
      comparePageSets(
        'sds-s9-stub',
        'SDS',
        'sds',
        ['is being populated for this substance from ECHA registration data'],
        await subSlugsWhere((p) => p.sub !== null && !hasPhysData(p.sub)),
      ),
  },
  {
    // ⚠⚠ Та самая проверка, которой не было 2026-08-03. §10 живёт вердиктом
    // get_storage_verdict, и когда RPC отказала по таймауту, блок исчез с 15
    // страниц молча — включая серную, соляную и азотную кислоты.
    id: 'sds-s10',
    group: 'SDS',
    title: 'Section 10 — Stability and reactivity (вердикт CAMEO)',
    run: async () =>
      comparePageSets('sds-s10', 'SDS', 'sds', ['id="s10"'], await subSlugsWhere((p) => p.stability)),
  },
  {
    // ⚠⚠ Канарейка. §10 и запасной путь §14 проверка считает сама, тремя обычными
    // выборками вместо 78 вызовов `get_storage_verdict` (вызов стоит 1,8 с при
    // лимите anon в 3 с — см. блок над VerdictInputs). Риск такого повтора один:
    // разъехаться с настоящей функцией и не заметить. Поэтому на трёх веществах
    // мы всё-таки зовём RPC и сверяем её ответ с локальным расчётом.
    //
    // ⚠ Вещества выбираются ДЕТЕРМИНИРОВАННО (первое, среднее, последнее по слагу
    // среди имеющих строку в substances), а не случайно: проверка, которая от
    // прогона к прогону смотрит в разные места, невоспроизводима.
    id: 'sds-verdict-canary',
    group: 'SDS',
    title: 'Локальный расчёт §10/§14 совпадает с настоящей RPC (контрольные пробы)',
    run: async () => {
      const withSub = (await substancePages()).filter((p) => p.sub?.cas_number)
      if (withSub.length === 0) {
        return {
          id: 'sds-verdict-canary',
          group: 'SDS',
          ok: false,
          headline: 'ни одной страницы со строкой в substances — сверять нечего',
          detail: [],
        }
      }
      // ⚠ Четвёртая проба — обязательно вещество с УСЕЧЁННЫМ multi-CAS Annex VI
      // (длина ровно 20, обрезано полем varchar(20)): «10043-35-3[1]11113-5».
      // Именно на них локальный расчёт и разошёлся с RPC 2026-08-03, а три
      // «обычные» пробы этого не увидели. Проба должна попадать в тот угол,
      // где логика сложнее всего, а не в середину.
      const odd = withSub.find((p) => (p.sub!.cas_number as string).length >= 20)
      const idx = [0, Math.floor(withSub.length / 2), withSub.length - 1]
      const probes = [...new Set(idx)].map((i) => withSub[i])
      if (odd && !probes.includes(odd)) probes.push(odd)
      const detail: string[] = []
      for (const p of probes) {
        const cas = p.sub!.cas_number as string
        let v: any
        try {
          v = await verdictWithRetry(cas)
        } catch (e) {
          detail.push(`${p.slug}: RPC не ответила — ${String(e).slice(0, 120)}`)
          continue
        }
        const rpcGroups: unknown[] = v?.reactive_groups ?? []
        const rpcReact: any[] = v?.reactivity ?? []
        const rpcStability =
          rpcGroups.length > 0 || rpcReact.some((r) => r?.status === 'incompatible' || r?.status === 'caution')
        if (rpcStability !== p.stability) {
          detail.push(`${p.slug} (${cas}): §10 — RPC ${rpcStability}, локально ${p.stability}`)
        }
        const rpcUns = [...new Set(((v?.adr ?? []) as any[]).map((a) => String(a.un)))].sort()
        if (rpcUns.join(',') !== p.aliasUns.join(',')) {
          detail.push(
            `${p.slug} (${cas}): UN по вердикту [${rpcUns.join(', ') || '-'}], локально [${p.aliasUns.join(', ') || '-'}]`,
          )
        }
      }
      const ok = detail.length === 0
      return {
        id: 'sds-verdict-canary',
        group: 'SDS',
        ok,
        headline: ok
          ? `${probes.length} пробы сошлись с get_storage_verdict`
          : `расхождений: ${detail.length} — локальный расчёт разошёлся с функцией`,
        detail: ok ? [`пробы: ${probes.map((p) => p.slug).join(', ')}`] : detail,
      }
    },
  },
  {
    id: 'sds-s11',
    group: 'SDS',
    title: 'Section 11 — ATE (строго > 0: ноль в базе означает «не импортировано»)',
    run: async () =>
      comparePageSets('sds-s11', 'SDS', 'sds', ['id="s11"'], await subSlugsWhere((p) => hasAte(p.sub))),
  },
  {
    // Сегодня ожидание пустое. Проверка нужна ровно для дня, когда эко-импорт
    // приедет: она сама скажет, что §12 появилась не везде, где появились данные.
    // ⚠ Заодно это сторож на anchorCoverage §12 в sdsSections.ts.
    id: 'sds-s12',
    group: 'SDS',
    title: 'Section 12 — Ecological information (lc50/ec50 > 0)',
    run: async () =>
      comparePageSets('sds-s12', 'SDS', 'sds', ['id="s12"'], await subSlugsWhere((p) => hasEco(p.sub))),
  },
  {
    id: 'sds-s13',
    group: 'SDS',
    title: 'Section 13 — Disposal considerations',
    run: async () =>
      comparePageSets('sds-s13', 'SDS', 'sds', ['id="s13"'], await subSlugsWhere((p) => p.sub !== null)),
  },
  {
    id: 'sds-s14',
    group: 'SDS',
    title: 'Section 14 — Transport (dg_substances, иначе adr из вердикта)',
    run: async () =>
      comparePageSets('sds-s14', 'SDS', 'sds', ['id="s14"'], await subSlugsWhere((p) => expectedUns(p).length > 0)),
  },
  {
    // ⚠ Номер UN — это то, что уезжает на оранжевую табличку транспортной единицы.
    // Здесь сверяется КАЖДЫЙ номер, а не факт наличия секции.
    id: 'sds-s14-un',
    group: 'SDS',
    title: 'Section 14 — набор UN-номеров совпадает с базой',
    run: async () =>
      compareValueSets(
        'sds-s14-un',
        'SDS',
        'sds',
        (html) => rxAll(html, />UN (\d{3,4})</g),
        new Map((await substancePages()).map((p) => [p.slug, expectedUns(p)])),
        'UN-номеров',
      ),
  },
  {
    // ⚠⚠ Один UN-номер занимает в Таблице A ADR несколько строк (группы упаковки,
    // диапазоны концентраций), и до session 32 страница печатала карточку на
    // каждую: три одинаковых на вид блока «UN 1202» подряд на дизтопливе, девять
    // карточек на шесть номеров у гипохлорита кальция — всего 12 страниц из 53.
    // Теперь строки сведены под один номер, а различия идут списком вариантов.
    // Проверка держит это: карточка на номер — ровно одна.
    id: 'sds-s14-one-card-per-un',
    group: 'SDS',
    title: 'Section 14 — на каждый UN-номер ровно одна карточка',
    run: async () => {
      const detail: string[] = []
      let pages = 0
      for (const slug of pageSlugs('sds')) {
        const html = readPage(`sds/${slug}/index.html`)
        if (!html || !html.includes('id="s14"')) continue
        pages++
        const cards = rxAll(html, />UN number<[\s\S]{0,240}?>UN (\d{3,4})</g)
        const seen = new Map<string, number>()
        for (const un of cards) seen.set(un, (seen.get(un) ?? 0) + 1)
        const dup = [...seen.entries()].filter(([, n]) => n > 1)
        if (dup.length) {
          detail.push(`${slug}: ${dup.map(([un, n]) => `UN ${un} x${n}`).join(', ')}`)
        }
      }
      const ok = detail.length === 0
      return {
        id: 'sds-s14-one-card-per-un',
        group: 'SDS',
        ok,
        headline: ok ? `${pages} страниц с §14, повторов карточек нет` : `повторы на ${detail.length} из ${pages} страниц`,
        detail: ok ? ['маркер: ">UN number<" ... ">UN NNNN<"'] : detail.slice(0, 20),
      }
    },
  },
  {
    // ⚠ В колонке группы упаковки Таблицы A у 28 позиций стоит не I/II/III, а
    // примечание: «CARRIAGE PROHIBITED» (UN 2186), «NOT SUBJECT TO ADR» (UN 1910).
    // Страница печатала его как группу упаковки — «2 · CARRIAGE PROHIBITED».
    // На транспортной странице это разные по смыслу вещи: «пакуйте так» против
    // «везти запрещено». Теперь примечание идёт отдельной плашкой, а в строке
    // «Class · PG» допустимы только настоящие группы упаковки.
    id: 'sds-s14-pg-values',
    group: 'SDS',
    title: 'Section 14 — в строке «Class · PG» только настоящие группы упаковки',
    run: async () => {
      const okPg = /^(I|II|III)(\s*\/\s*(I|II|III))*$/
      const detail: string[] = []
      let checked = 0
      for (const slug of pageSlugs('sds')) {
        const html = readPage(`sds/${slug}/index.html`)
        if (!html || !html.includes('id="s14"')) continue
        // ⚠ Значение берётся из СЛЕДУЮЩЕГО <p>, а не «после первого >»: между
        // подписью и значением стоит </p> со своим «>», и ленивый шаблон ловил
        // на нём перевод строки. Проверка при этом оставалась зелёной —
        // сравнивала пустую строку (session 32, поймано на живом dist).
        for (const raw of rxAll(html, />Class . PG<\/p>[\s\S]{0,220}?<p[^>]*>([^<]+)<\/p>/g)) {
          checked++
          const parts = raw.split('·').map((s) => s.trim())
          const pg = parts.length > 1 ? parts.slice(1).join(' · ') : null
          if (pg && !okPg.test(pg)) detail.push(`${slug}: "${raw.trim()}"`)
        }
      }
      const ok = detail.length === 0
      return {
        id: 'sds-s14-pg-values',
        group: 'SDS',
        ok,
        headline: ok ? `${checked} строк «Class · PG», все значения годные` : `негодных значений: ${detail.length}`,
        detail: ok ? ['допускаются только I, II, III и их сочетания через /'] : detail.slice(0, 20),
      }
    },
  },
  {
    // regRows на странице сегодня жёстко пустой массив: импорта Step-4 не было.
    // Проверка держит это честным — и загорится в тот день, когда таблица
    // substance_regulatory_status появится, а страница её не подхватит.
    id: 'sds-s15',
    group: 'SDS',
    title: 'Section 15 — Regulatory (ждёт импорта Step-4, сегодня ноль страниц)',
    run: async () => expectAbsent('sds-s15', 'SDS', 'sds', ['id="s15"']),
  },
  {
    id: 'storage-classes',
    group: 'Storage',
    title: 'STORAGE_CLASSES = классы в базе = папки категорий в dist',
    run: async () => {
      const rows = await selectAll<{ code: string }>('storage_hazard_classes', 'code')
      const dbCodes = new Set(rows.map((r) => r.code))
      const tsCodes = new Set(STORAGE_CLASSES.map((c) => c.code))
      const codes = diffSets(tsCodes, dbCodes)
      const dirs = diffSets(new Set(pageSlugs('storage-compatibility')), new Set(STORAGE_CLASSES.map((c) => c.slug)))
      const detail: string[] = []
      if (codes.missing.length) detail.push(`в базе есть, в storageClasses.ts нет: ${preview(codes.missing)}`)
      if (codes.extra.length) detail.push(`в storageClasses.ts есть, в базе нет: ${preview(codes.extra)}`)
      if (dirs.missing.length) detail.push(`нет страницы категории в dist: ${preview(dirs.missing)}`)
      if (dirs.extra.length) detail.push(`лишняя папка в dist: ${preview(dirs.extra)}`)
      return {
        id: 'storage-classes',
        group: 'Storage',
        ok: detail.length === 0,
        headline: `${tsCodes.size} в storageClasses.ts, ${dbCodes.size} в базе, ${pageSlugs('storage-compatibility').length} папок в dist`,
        detail,
      }
    },
  },
  {
    id: 'storage-counts',
    group: 'Storage',
    title: 'Число веществ на каждой странице категории равно числу в базе',
    run: async () => {
      const MARKER = 'class="hub-index-card"'
      assertAscii('storage-counts', [MARKER])
      const detail: string[] = []
      let ok = true
      let checked = 0
      for (const cls of STORAGE_CLASSES) {
        const { data, error } = await supabase.rpc('get_class_substances', { p_sc_code: cls.code, p_limit: 0 })
        if (error) throw new Error(`get_class_substances(${cls.code}): ${error.message}`)
        const expected = Number((data as { total?: number } | null)?.total ?? -1)
        const html = readPage(`storage-compatibility/${cls.slug}/index.html`)
        if (html === null) {
          ok = false
          detail.push(`${cls.slug}: нет страницы в dist`)
          continue
        }
        const actual = countOccurrences(html, MARKER)
        checked++
        if (actual !== expected) {
          ok = false
          detail.push(`${cls.slug}: ${actual} карточек в dist, база даёт ${expected}`)
        }
      }
      if (ok) detail.push(`маркер: ${JSON.stringify(MARKER)}`)
      return {
        id: 'storage-counts',
        group: 'Storage',
        ok,
        headline: ok ? `${checked} категорий сошлись 1:1` : `не сошлось категорий: ${detail.length}`,
        detail,
      }
    },
  },
  {
    id: 'storage-tool',
    group: 'Storage',
    title: 'Виджет StorageTool на странице инструмента, и его бандл существует',
    run: async () => {
      const rel = 'tools/chemical-storage-compatibility/index.html'
      const html = readPage(rel)
      if (!html) {
        return { id: 'storage-tool', group: 'Storage', ok: false, headline: `нет ${rel}`, detail: [] }
      }
      const m = html.match(/component-url="(\/_astro\/StorageTool\.[A-Za-z0-9_-]+\.js)"/)
      if (!m) {
        return {
          id: 'storage-tool',
          group: 'Storage',
          ok: false,
          headline: 'на странице нет <astro-island> со StorageTool',
          detail: [],
        }
      }
      const bundle = m[1].replace(/^\//, '')
      const exists = existsSync(join(DIST, bundle))
      return {
        id: 'storage-tool',
        group: 'Storage',
        ok: exists,
        headline: exists ? `остров на месте, бандл существует` : `остров ссылается на отсутствующий бандл`,
        detail: [`${bundle}${exists ? '' : ' — ФАЙЛА НЕТ'}`],
      }
    },
  },
  {
    id: 'storage-tool-links',
    group: 'Storage',
    title: 'Deep-link ?substance= с категорий ведёт на страницу инструмента',
    run: async () => {
      const HREF = 'href="/tools/chemical-storage-compatibility/?substance='
      assertAscii('storage-tool-links', [HREF])
      const detail: string[] = []
      let ok = true
      for (const cls of STORAGE_CLASSES) {
        const html = readPage(`storage-compatibility/${cls.slug}/index.html`)
        if (!html) continue
        const cards = countOccurrences(html, 'class="hub-index-card"')
        const links = countOccurrences(html, HREF)
        if (cards !== links) {
          ok = false
          detail.push(`${cls.slug}: ${cards} карточек, но ${links} deep-link`)
        }
      }
      if (ok) detail.push('у каждой карточки ровно одна ссылка в инструмент')
      return {
        id: 'storage-tool-links',
        group: 'Storage',
        ok,
        headline: ok ? 'ссылки совпадают с карточками во всех категориях' : 'расхождение карточек и ссылок',
        detail,
      }
    },
  },
  // ─── P-фразы (session 19) ───────────────────────────────────────────────
  {
    id: 'p-pages',
    group: 'P-statements',
    title: 'Набор страниц /p-statements/ равен реестру кодов в базе',
    run: async () => {
      const codes = await pCodes()
      const expected = new Set(codes.map((c) => c.code))
      const actual = new Set(pageSlugs('p-statements'))
      const { missing, extra } = diffSets(actual, expected)
      const ok = missing.length === 0 && extra.length === 0
      const detail: string[] = []
      if (missing.length) detail.push(`нет в dist (${missing.length}): ${preview(missing)}`)
      if (extra.length) detail.push(`лишние в dist (${extra.length}): ${preview(extra)}`)
      if (ok) detail.push('каждому коду соответствует ровно одна страница')
      return {
        id: 'p-pages',
        group: 'P-statements',
        ok,
        headline: `${actual.size} страниц в dist, база ожидает ${expected.size}`,
        detail,
      }
    },
  },
  {
    id: 'p-hub-rows',
    group: 'P-statements',
    title: 'Все коды присутствуют в HTML хаба на сборке, а не рисуются JS-ом',
    run: async () => {
      const codes = await pCodes()
      const html = readPage('p-statements/index.html')
      if (html === null) {
        return { id: 'p-hub-rows', group: 'P-statements', ok: false, headline: 'нет p-statements/index.html', detail: [] }
      }
      const missing = codes.map((c) => c.code).filter((code) => !html.includes(`data-code="${code}"`))
      const ok = missing.length === 0
      return {
        id: 'p-hub-rows',
        group: 'P-statements',
        ok,
        headline: ok
          ? `все ${codes.length} строк в разметке хаба`
          : `в разметке хаба нет ${missing.length} из ${codes.length} кодов`,
        detail: ok ? ['маркер: data-code="P___"'] : [preview(missing, 20)],
      }
    },
  },
  {
    id: 'p-hub-combos',
    group: 'P-statements',
    title: 'Все комбинированные коды есть в HTML хаба',
    run: async () => {
      const combos = await selectAll<{ code: string }>('p_statement_combinations', 'code')
      const html = readPage('p-statements/index.html')
      if (html === null) {
        return { id: 'p-hub-combos', group: 'P-statements', ok: false, headline: 'нет p-statements/index.html', detail: [] }
      }
      const missing = combos
        .map((c) => c.code)
        .filter((code) => !html.includes(`data-s="${code.toLowerCase()} `))
      const ok = missing.length === 0
      return {
        id: 'p-hub-combos',
        group: 'P-statements',
        ok,
        headline: ok ? `все ${combos.length} комбинаций на месте` : `не хватает ${missing.length} комбинаций`,
        detail: ok ? ['маркер: data-s="p___+p___ "'] : [preview(missing, 20)],
      }
    },
  },
  {
    id: 'p-substance-counts',
    group: 'P-statements',
    title: 'Число веществ на странице кода равно get_statement_counts()',
    run: async () => {
      const counts = await pCounts()
      const detail: string[] = []
      let ok = true
      let checked = 0
      for (const [code, n] of counts) {
        const html = readPage(`p-statements/${code}/index.html`)
        if (!html) continue
        checked++
        // ⚠ Без закрывающей кавычки: у групповых записей без CAS карточка
        // не кликабельна и несёт class="hub-index-card no-link".
        const cards = countOccurrences(html, 'class="hub-index-card')
        if (cards !== n) {
          ok = false
          detail.push(`${code}: ${cards} карточек в dist, база ожидает ${n}`)
        }
      }
      if (ok) detail.push(`сошлось на ${checked} страницах, суммарно ${[...counts.values()].reduce((a, b) => a + b, 0)} строк`)
      return {
        id: 'p-substance-counts',
        group: 'P-statements',
        ok,
        headline: ok ? `${checked} страниц кодов согласованы с базой` : `расхождение на ${detail.length} страницах`,
        detail: detail.slice(0, 20),
      }
    },
  },
  {
    id: 'p-jurisdictions',
    group: 'P-statements',
    title: 'Переключатель юрисдикций и его payload на месте',
    run: async () => {
      const juris = await selectAll<{ id: string }>('statement_jurisdictions', 'id')
      const markers = ['id="p-switch-data"', ...juris.map((j) => `data-j="${j.id}"`)]
      return expectBehaviour('p-jurisdictions', 'P-statements', 'p-statements/index.html', markers)
    },
  },
  {
    id: 'p-withdrawn-badges',
    group: 'P-statements',
    title: 'Бейдж withdrawn стоит ровно на тех кодах, где база его ждёт',
    run: async () => {
      const rows = await selectAll<{ code: string; status: string }>(
        'p_statement_jurisdiction',
        'code, status',
      )
      const expected = new Set(rows.filter((r) => r.status === 'withdrawn').map((r) => r.code))
      return comparePageSets(
        'p-withdrawn-badges',
        'P-statements',
        'p-statements',
        ['st-badge withdrawn'],
        expected,
      )
    },
  },
  {
    id: 'p-sitemap',
    group: 'P-statements',
    title: 'Каждая страница P-фраз попала в sitemap.xml',
    run: async () => {
      // Sitemap собирается вручную из списков, и новый раздел в него легко не
      // попасть — так и вышло с P-фразами: IndexNow отправил 162 URL вместо 280.
      const xml = readPage('sitemap.xml')
      if (xml === null) {
        return { id: 'p-sitemap', group: 'P-statements', ok: false, headline: 'нет dist/sitemap.xml', detail: [] }
      }
      const expected = ['/p-statements/', ...pageSlugs('p-statements').map((c) => `/p-statements/${c}/`)]
      const missing = expected.filter((u) => !xml.includes(`<loc>https://ghspictograms.com${u}</loc>`))
      const ok = missing.length === 0
      return {
        id: 'p-sitemap',
        group: 'P-statements',
        ok,
        headline: ok
          ? `все ${expected.length} URL в sitemap`
          : `в sitemap нет ${missing.length} из ${expected.length} URL`,
        detail: ok ? ['маркер: <loc>…/p-statements/…</loc>'] : [preview(missing, 20)],
      }
    },
  },
  {
    id: 'h-pages',
    group: 'H-statements',
    title: 'Набор страниц /h-statements/ равен реестру кодов в базе',
    run: async () => {
      const codes = await hCodes()
      // ⚠ URL девяти суффиксных кодов Annex VI — слаг, а не код: H360Fd и H360FD
      // различаются только регистром и на NTFS пишутся в одну папку.
      const expected = new Set(codes.map((c) => hSlug(c.code)))
      const actual = new Set(pageSlugs('h-statements'))
      const { missing, extra } = diffSets(actual, expected)
      const ok = missing.length === 0 && extra.length === 0
      const detail: string[] = []
      if (missing.length) detail.push(`нет в dist (${missing.length}): ${preview(missing)}`)
      if (extra.length) detail.push(`лишние в dist (${extra.length}): ${preview(extra)}`)
      if (ok) detail.push('каждому коду соответствует ровно одна страница')
      return {
        id: 'h-pages',
        group: 'H-statements',
        ok,
        headline: `${actual.size} страниц в dist, база ожидает ${expected.size}`,
        detail,
      }
    },
  },
  {
    id: 'h-hub-rows',
    group: 'H-statements',
    title: 'Все коды присутствуют в HTML хаба на сборке, а не рисуются JS-ом',
    run: async () => {
      const codes = await hCodes()
      const html = readPage('h-statements/index.html')
      if (html === null) {
        return { id: 'h-hub-rows', group: 'H-statements', ok: false, headline: 'нет h-statements/index.html', detail: [] }
      }
      const missing = codes.map((c) => c.code).filter((code) => !html.includes(`data-code="${code}"`))
      const ok = missing.length === 0
      return {
        id: 'h-hub-rows',
        group: 'H-statements',
        ok,
        headline: ok
          ? `все ${codes.length} строк в разметке хаба`
          : `в разметке хаба нет ${missing.length} из ${codes.length} кодов`,
        detail: ok ? ['маркер: data-code="H___"'] : [preview(missing, 20)],
      }
    },
  },
  {
    id: 'h-hub-combos',
    group: 'H-statements',
    title: 'Все комбинированные коды есть в HTML хаба',
    run: async () => {
      const combos = await selectAll<{ code: string }>('h_statement_combinations', 'code')
      assertNonEmpty('h-hub-combos', 'h_statement_combinations', combos)
      const html = readPage('h-statements/index.html')
      if (html === null) {
        return { id: 'h-hub-combos', group: 'H-statements', ok: false, headline: 'нет h-statements/index.html', detail: [] }
      }
      const missing = combos
        .map((c) => c.code)
        .filter((code) => !html.includes(`data-s="${code.toLowerCase()} `))
      const ok = missing.length === 0
      return {
        id: 'h-hub-combos',
        group: 'H-statements',
        ok,
        headline: ok ? `все ${combos.length} комбинаций на месте` : `не хватает ${missing.length} комбинаций`,
        detail: ok ? ['маркер: data-s="h___+h___ "'] : [preview(missing, 20)],
      }
    },
  },
  {
    id: 'h-substance-counts',
    group: 'H-statements',
    title: 'Число веществ на странице кода равно get_statement_counts()',
    run: async () => {
      const counts = await hCounts()
      const detail: string[] = []
      let ok = true
      let checked = 0
      for (const [code, n] of counts) {
        const html = readPage(`h-statements/${hSlug(code)}/index.html`)
        if (!html) continue
        checked++
        // ⚠ Без закрывающей кавычки: у групповых записей без CAS карточка
        // не кликабельна и несёт class="hub-index-card no-link".
        const cards = countOccurrences(html, 'class="hub-index-card')
        if (cards !== n) {
          ok = false
          detail.push(`${code}: ${cards} карточек в dist, база ожидает ${n}`)
        }
      }
      if (ok) detail.push(`сошлось на ${checked} страницах, суммарно ${[...counts.values()].reduce((a, b) => a + b, 0)} строк`)
      return {
        id: 'h-substance-counts',
        group: 'H-statements',
        ok,
        headline: ok ? `${checked} страниц кодов согласованы с базой` : `расхождение на ${detail.length} страницах`,
        detail: detail.slice(0, 20),
      }
    },
  },
  {
    id: 'h-jurisdictions',
    group: 'H-statements',
    title: 'Переключатель юрисдикций и его payload на месте',
    run: async () => {
      const juris = await selectAll<{ id: string }>('statement_jurisdictions', 'id')
      assertNonEmpty('h-jurisdictions', 'statement_jurisdictions', juris)
      // ⚠ Мало проверить кнопки: при RLS без политики кнопки на месте, а payload
      // пуст. Маркер "cccc" — строка статусов хотя бы одного кода, живого везде.
      const markers = ['id="h-switch-data"', '"cccc"', ...juris.map((j) => `data-j="${j.id}"`)]
      return expectBehaviour('h-jurisdictions', 'H-statements', 'h-statements/index.html', markers)
    },
  },
  {
    id: 'h-withdrawn-badges',
    group: 'H-statements',
    title: 'Бейдж withdrawn стоит ровно на тех кодах, где база его ждёт',
    run: async () => {
      const rows = await selectAll<{ code: string; status: string }>(
        'h_statement_jurisdiction',
        'code, status',
      )
      assertNonEmpty('h-withdrawn-badges', 'h_statement_jurisdiction', rows)
      const expected = new Set(
        rows.filter((r) => r.status === 'withdrawn').map((r) => hSlug(r.code)),
      )
      return comparePageSets(
        'h-withdrawn-badges',
        'H-statements',
        'h-statements',
        ['st-badge withdrawn'],
        expected,
      )
    },
  },
  {
    id: 'h-revision-strip',
    group: 'H-statements',
    title: 'Полоса истории ревизий есть ровно у тех кодов, у которых есть история',
    run: async () => {
      // Блок новый и ни на что не влияет визуально, если исчезнет: страница
      // останется валидной и без него. Ровно так в session 20 потерялась
      // colon-строка на SDS — молча и мимо всех девятнадцати проверок.
      const rows = await selectAll<{ code: string }>('h_statement_revisions', 'code')
      assertNonEmpty('h-revision-strip', 'h_statement_revisions', rows)
      const expected = new Set(rows.map((r) => hSlug(r.code)))
      return comparePageSets(
        'h-revision-strip',
        'H-statements',
        'h-statements',
        ['class="hrev"'],
        expected,
      )
    },
  },
  {
    id: 'h-sitemap',
    group: 'H-statements',
    title: 'Каждая страница H-фраз попала в sitemap.xml',
    run: async () => {
      const xml = readPage('sitemap.xml')
      if (xml === null) {
        return { id: 'h-sitemap', group: 'H-statements', ok: false, headline: 'нет dist/sitemap.xml', detail: [] }
      }
      const expected = ['/h-statements/', ...pageSlugs('h-statements').map((c) => `/h-statements/${c}/`)]
      const missing = expected.filter((u) => !xml.includes(`<loc>https://ghspictograms.com${u}</loc>`))
      const ok = missing.length === 0
      return {
        id: 'h-sitemap',
        group: 'H-statements',
        ok,
        headline: ok
          ? `все ${expected.length} URL в sitemap`
          : `в sitemap нет ${missing.length} из ${expected.length} URL`,
        detail: ok ? ['маркер: <loc>…/h-statements/…</loc>'] : [preview(missing, 20)],
      }
    },
  },

  // ─────────────────────────── Пиктограммы ───────────────────────────

  /**
   * ⚠⚠ Ради этой проверки всё и затевалось (session 22).
   * Списки H-кодов девяти страниц лежали массивами `hCodes` прямо в `[code].astro`
   * и разошлись с первоисточником в ОДИННАДЦАТИ местах: `H315` стоял на GHS05
   * (раздражение кожи — это GHS07), `H304` отсутствовал на GHS08, GHS09 нёс
   * `H401`/`H412`/`H413`, у которых пиктограммы нет вообще.
   * Ни одна проверка этого не видела, потому что сравнивать было НЕ С ЧЕМ:
   * страница была сама себе источником истины.
   * Теперь источник один — `hazard_category_mapping`, и страница обязана ему равняться.
   * Разбор — `claude/pictograms-page-audit.md`.
   */
  {
    id: 'ghs-hcodes',
    group: 'Pictograms',
    title: 'H-коды на каждой странице пиктограммы равны hazard_category_mapping',
    run: async () => {
      const rows = await selectAll<{ pictogram_code: string; h_statement_code: string }>(
        'hazard_category_mapping',
        'pictogram_code, h_statement_code',
        (q: any) => q.not('pictogram_code', 'is', null).not('h_statement_code', 'is', null),
      )
      assertNonEmpty('ghs-hcodes', 'hazard_category_mapping', rows)

      const expectedBy = new Map<string, Set<string>>()
      for (const r of rows) {
        if (!expectedBy.has(r.pictogram_code)) expectedBy.set(r.pictogram_code, new Set())
        expectedBy.get(r.pictogram_code)!.add(r.h_statement_code)
      }

      const detail: string[] = []
      let bad = 0
      for (const pic of [...expectedBy.keys()].sort()) {
        const html = readPage(`ghs/${pic.toLowerCase()}/index.html`)
        if (html === null) {
          detail.push(`${pic}: нет страницы в dist`)
          bad++
          continue
        }
        const actual = new Set([...html.matchAll(/data-hcode="([^"]+)"/g)].map((m) => m[1]))
        const { missing, extra } = diffSets(actual, expectedBy.get(pic)!)
        if (missing.length || extra.length) {
          bad++
          const parts: string[] = []
          if (missing.length) parts.push(`нет в dist: ${preview(missing)}`)
          if (extra.length) parts.push(`лишние в dist: ${preview(extra)}`)
          detail.push(`${pic}: ${parts.join(' · ')}`)
        }
      }

      const ok = bad === 0
      if (ok) detail.push(`маркер: data-hcode="H___" · в базе ${rows.length} связок «категория ↔ код»`)
      return {
        id: 'ghs-hcodes',
        group: 'Pictograms',
        ok,
        headline: ok
          ? `все ${expectedBy.size} страниц пиктограмм сходятся с базой`
          : `расходятся ${bad} из ${expectedBy.size} страниц`,
        detail,
      }
    },
  },

  {
    id: 'ghs-class-rows',
    group: 'Pictograms',
    title: 'Таблица «класс → категория» отрисована на сборке и полна',
    run: async () => {
      const rows = await selectAll<{ pictogram_code: string; h_statement_code: string }>(
        'hazard_category_mapping',
        'pictogram_code, h_statement_code',
        (q: any) => q.not('pictogram_code', 'is', null).not('h_statement_code', 'is', null),
      )
      assertNonEmpty('ghs-class-rows', 'hazard_category_mapping', rows)

      const expectedBy = new Map<string, number>()
      for (const r of rows) {
        expectedBy.set(r.pictogram_code, (expectedBy.get(r.pictogram_code) ?? 0) + 1)
      }

      const detail: string[] = []
      let bad = 0
      for (const pic of [...expectedBy.keys()].sort()) {
        const html = readPage(`ghs/${pic.toLowerCase()}/index.html`)
        if (html === null) {
          detail.push(`${pic}: нет страницы в dist`)
          bad++
          continue
        }
        const actual = [...html.matchAll(/data-hclass-row="/g)].length
        const want = expectedBy.get(pic)!
        if (actual !== want) {
          bad++
          detail.push(`${pic}: строк в dist ${actual}, база ожидает ${want}`)
        }
      }

      const ok = bad === 0
      if (ok) detail.push(`маркер: data-hclass-row · всего ${rows.length} строк на ${expectedBy.size} страницах`)
      return {
        id: 'ghs-class-rows',
        group: 'Pictograms',
        ok,
        headline: ok
          ? `таблица классов полна на всех ${expectedBy.size} страницах`
          : `расходятся ${bad} из ${expectedBy.size} страниц`,
        detail,
      }
    },
  },

  {
    id: 'pict-hub-rows',
    group: 'Pictograms',
    title: 'Хаб /pictograms/: классы, H-коды и вещества по каждой пиктограмме сходятся с базой',
    run: async () => {
      const html = readPage('pictograms/index.html')
      if (html === null) {
        return { id: 'pict-hub-rows', group: 'Pictograms', ok: false, headline: 'нет pictograms/index.html', detail: [] }
      }

      const mapRows = await selectAll<{
        pictogram_code: string
        h_statement_code: string
        hazard_class_catalog: { name_en: string } | null
      }>(
        'hazard_category_mapping',
        'pictogram_code, h_statement_code, hazard_class_catalog(name_en)',
        (q: any) => q.not('pictogram_code', 'is', null).not('h_statement_code', 'is', null),
      )
      assertNonEmpty('pict-hub-rows', 'hazard_category_mapping', mapRows)

      const sets = await pictogramSets()
      const subsOf = new Map<string, number>(PICT_CODES.map((c) => [c, 0]))
      for (const set of sets) for (const c of set) subsOf.set(c, (subsOf.get(c) ?? 0) + 1)

      const want = new Map<string, string>()
      for (const code of PICT_CODES) {
        const mine = mapRows.filter((r) => r.pictogram_code === code)
        const classes = new Set(mine.map((r) => r.hazard_class_catalog?.name_en).filter(Boolean)).size
        const hcodes = new Set(mine.map((r) => r.h_statement_code)).size
        want.set(code, `${classes}|${hcodes}|${subsOf.get(code) ?? 0}`)
      }

      const got = hubMarkers(html, 'pict-row')
      const detail: string[] = []
      for (const code of PICT_CODES) {
        const w = want.get(code)!
        const g = got.get(code)
        if (g === undefined) detail.push(`${code}: маркера нет в dist`)
        else if (g !== w) detail.push(`${code}: в dist «${g}», база ожидает «${w}» (классы|H-коды|вещества)`)
      }
      for (const k of got.keys()) if (!PICT_CODES.includes(k)) detail.push(`${k}: лишний маркер в dist`)

      const ok = detail.length === 0
      if (ok) detail.push(`маркер: data-pict-row · ${PICT_CODES.length} строк, ${mapRows.length} связок «категория ↔ код»`)
      return {
        id: 'pict-hub-rows',
        group: 'Pictograms',
        ok,
        headline: ok ? 'все девять строк хаба сходятся с базой' : `расходится строк: ${detail.length}`,
        detail,
      }
    },
  },

  {
    id: 'pict-hub-pairs',
    group: 'Pictograms',
    title: 'Хаб /pictograms/: числа под правилами Article 26 посчитаны, а не написаны',
    run: async () => {
      const html = readPage('pictograms/index.html')
      if (html === null) {
        return { id: 'pict-hub-pairs', group: 'Pictograms', ok: false, headline: 'нет pictograms/index.html', detail: [] }
      }

      const sets = await pictogramSets()
      const pairN = (a: string, b: string) => sets.filter((s) => s.includes(a) && s.includes(b)).length

      const got = hubMarkers(html, 'pict-pair')
      const detail: string[] = []
      if (got.size === 0) detail.push('маркеров data-pict-pair в dist нет вовсе')
      for (const [key, val] of got) {
        const [a, b] = key.split('+')
        if (!a || !b) {
          detail.push(`${key}: маркер не разбирается`)
          continue
        }
        const w = String(pairN(a, b))
        if (val !== w) detail.push(`${key}: в dist ${val}, база ожидает ${w}`)
      }

      const ok = detail.length === 0
      if (ok) detail.push(`маркер: data-pict-pair · ${got.size} пар на ${sets.length} веществах с пиктограммой`)
      return {
        id: 'pict-hub-pairs',
        group: 'Pictograms',
        ok,
        headline: ok ? `все ${got.size} пар сходятся с базой` : `расходится пар: ${detail.length}`,
        detail,
      }
    },
  },

  {
    id: 'pict-hub-dist',
    group: 'Pictograms',
    title: 'Хаб /pictograms/: распределение «сколько пиктограмм на одной этикетке»',
    run: async () => {
      const html = readPage('pictograms/index.html')
      if (html === null) {
        return { id: 'pict-hub-dist', group: 'Pictograms', ok: false, headline: 'нет pictograms/index.html', detail: [] }
      }

      const sets = await pictogramSets()
      const dist = new Map<number, number>()
      for (const s of sets) dist.set(s.length, (dist.get(s.length) ?? 0) + 1)

      const got = hubMarkers(html, 'pict-dist')
      const detail: string[] = []
      if (got.size === 0) detail.push('маркеров data-pict-dist в dist нет вовсе')
      for (const [key, val] of got) {
        const n = Number(key)
        // Последняя ячейка — «шесть и больше»: суммируем всё от 6 вверх.
        const w =
          n >= 6
            ? [...dist.entries()].filter(([k]) => k >= 6).reduce((acc, [, v]) => acc + v, 0)
            : (dist.get(n) ?? 0)
        if (val !== String(w)) detail.push(`${key} пиктограмм: в dist ${val}, база ожидает ${w}`)
      }

      const ok = detail.length === 0
      if (ok) detail.push(`маркер: data-pict-dist · ${got.size} ячеек, всего ${sets.length} веществ с пиктограммой`)
      return {
        id: 'pict-hub-dist',
        group: 'Pictograms',
        ok,
        headline: ok ? 'распределение сходится с базой' : `расходится ячеек: ${detail.length}`,
        detail,
      }
    },
  },

  {
    id: 'pict-page-co',
    group: 'Pictograms',
    title: 'Совместная встречаемость на девяти страницах равна базе',
    run: async () => {
      const sets = await pictogramSets()
      const detail: string[] = []
      let bad = 0

      for (const code of PICT_CODES) {
        const html = readPage(`ghs/${code.toLowerCase()}/index.html`)
        if (html === null) {
          detail.push(`${code}: нет страницы в dist`)
          bad++
          continue
        }
        // Ожидание: среди веществ, несущих code, сколько несут заодно каждую из остальных.
        const mine = sets.filter((s) => s.includes(code))
        const want = new Map<string, number>()
        for (const s of mine) for (const c of s) if (c !== code && PICT_CODES.includes(c)) {
          want.set(c, (want.get(c) ?? 0) + 1)
        }
        const got = hubMarkers(html, 'pict-co')
        const miss: string[] = []
        for (const [c, n] of want) {
          if (n === 0) continue
          const g = got.get(c)
          if (g === undefined) miss.push(`${c}: строки нет`)
          else if (g !== String(n)) miss.push(`${c}: в dist ${g}, база ${n}`)
        }
        for (const c of got.keys()) if (!want.has(c)) miss.push(`${c}: лишняя строка`)
        if (miss.length) {
          bad++
          detail.push(`${code}: ${preview(miss)}`)
        }
      }

      const ok = bad === 0
      if (ok) detail.push(`маркер: data-pict-co · ${PICT_CODES.length} страниц, ${sets.length} веществ с пиктограммой`)
      return {
        id: 'pict-page-co',
        group: 'Pictograms',
        ok,
        headline: ok ? 'все девять страниц сходятся с базой' : `расходятся ${bad} из ${PICT_CODES.length} страниц`,
        detail,
      }
    },
  },

  {
    id: 'pict-page-answers',
    group: 'Pictograms',
    title: 'Блок «прямой ответ» на месте и совпадает с FAQPage',
    run: async () => {
      const detail: string[] = []
      let bad = 0
      let totalQ = 0

      for (const code of PICT_CODES) {
        const html = readPage(`ghs/${code.toLowerCase()}/index.html`)
        if (html === null) {
          detail.push(`${code}: нет страницы в dist`)
          bad++
          continue
        }
        const rendered = [...html.matchAll(/data-pict-faq="/g)].length
        const faqPage = [...html.matchAll(/"@type":"FAQPage"/g)].length
        // Вопросов в разметке должно быть столько же, сколько в JSON-LD: иначе разметка
        // и структурированные данные разъехались, и Google увидит не то, что человек.
        const questions = [...html.matchAll(/"@type":"Question"/g)].length
        totalQ += rendered
        const problems: string[] = []
        if (rendered === 0) problems.push('блока нет')
        if (faqPage !== 1) problems.push(`FAQPage ${faqPage}, ожидался 1`)
        if (rendered !== questions) problems.push(`в разметке ${rendered} вопросов, в JSON-LD ${questions}`)
        if (problems.length) {
          bad++
          detail.push(`${code}: ${problems.join(' · ')}`)
        }
      }

      const ok = bad === 0
      if (ok) detail.push(`маркеры: data-pict-faq + "@type":"FAQPage" · всего ${totalQ} вопросов на ${PICT_CODES.length} страницах`)
      return {
        id: 'pict-page-answers',
        group: 'Pictograms',
        ok,
        headline: ok ? `все девять страниц несут блок ответов (${totalQ} вопросов)` : `проблемы на ${bad} из ${PICT_CODES.length} страниц`,
        detail,
      }
    },
  },
  // ─── Партнёрские ссылки (session 28) ────────────────────────────────────
  // ИНВАРИАНТЫ, а не числа: скрипт не знает, сколько карточек должно быть, он
  // проверяет, что у каждой НАЙДЕННОЙ ссылки всё на месте. Ровно это ловит
  // ссылку, вписанную руками мимо компонента SdsManagerCard.
  //
  // ⚠ Ссылка на партнёра бывает ДВУХ видов, и требования у них разные:
  //   * партнёрская   — в href есть fpr=; обязаны быть fp_sid и rel="sponsored
  //                     nofollow noopener", а на странице — дисклоуз;
  //   * ссылка-источник — fpr= нет (например, цитата прайса в Sources); обязана
  //                     быть nofollow. Проходная ссылка на партнёра со страницы,
  //                     где стоит и партнёрская, — это то, что политика Google
  //                     по ссылочному спаму и разбирает.
  {
    id: 'affiliate-marking',
    group: 'Affiliate',
    title: 'Каждая ссылка на партнёра размечена по своему виду',
    run: async () => {
      const HOST = 'sdsmanager.com'
      const REL = 'rel="sponsored nofollow noopener"'
      const DISCLOSURE = 'href="/affiliate-disclosure/"'
      assertAscii('affiliate-marking', [HOST, REL, DISCLOSURE])

      // Целиком открывающий тег <a ...> со ссылкой на партнёра.
      const ANCHOR = /<a\b[^>]*href="[^"]*sdsmanager\.com[^"]*"[^>]*>/gi
      const detail: string[] = []
      let pages = 0
      let affiliate = 0
      let citations = 0

      for (const { rel, html } of allPages()) {
        const tags = html.match(ANCHOR) ?? []
        if (tags.length === 0) continue
        pages++
        let hasAffiliate = false
        for (const tag of tags) {
          const isAffiliate = tag.includes('fpr=')
          if (isAffiliate) {
            affiliate++
            hasAffiliate = true
            if (!tag.includes(REL)) detail.push(`${rel}: партнёрская ссылка без ${REL} -> ${tag.slice(0, 140)}`)
          } else {
            citations++
            if (!/rel="[^"]*nofollow[^"]*"/i.test(tag)) {
              detail.push(`${rel}: ссылка-источник на партнёра без nofollow -> ${tag.slice(0, 140)}`)
            }
          }
        }
        if (hasAffiliate && !html.includes(DISCLOSURE)) {
          detail.push(`${rel}: есть партнёрская ссылка, но нет ссылки на /affiliate-disclosure/`)
        }
      }

      const ok = detail.length === 0
      if (ok) {
        detail.push(`${affiliate} партнёрских и ${citations} ссылок-источников на ${pages} страницах`)
        detail.push('ссылки внутри React-островов лежат в dist/_astro/*.js и сюда не попадают — их держит affiliate-subid')
      }
      return {
        id: 'affiliate-marking',
        group: 'Affiliate',
        ok,
        headline: ok ? `${pages} страниц размечены правильно` : `нарушений: ${detail.length}`,
        detail,
      }
    },
  },
  {
    id: 'affiliate-subid',
    group: 'Affiliate',
    title: 'У каждой партнёрской ссылки есть fpr и fp_sid',
    run: async () => {
      // Без fp_sid клик доедет до партнёра, но в отчёте будет безымянным,
      // и вопрос «какая страница приносит клики» останется без ответа.
      // Ищем и в HTML, и в бандлах: ссылки React-инструментов живут в _astro/*.js.
      const RE = /https:\/\/[a-z.]*sdsmanager\.com[^"'`\s<>\\)]*/g
      const detail: string[] = []
      const sids = new Map<string, number>()
      let affiliate = 0
      let citations = 0
      const sources: { rel: string; text: string }[] = [
        ...allPages().map((pg) => ({ rel: pg.rel, text: pg.html })),
        ...assetFiles().map((a) => ({ rel: a.name, text: a.text })),
      ]
      for (const { rel, text } of sources) {
        for (const url of text.match(RE) ?? []) {
          // ⚠ Astro пишет разделитель параметров как &#38;, а НЕ как &amp;.
          // Первая версия проверки декодировала только &amp; и объявила 141
          // здоровую ссылку сломанной. Декодируем все три формы амперсанда.
          const clean = url.replace(/&(?:amp|#0*38|#[xX]0*26);/g, '&')
          if (!clean.includes('fpr=')) {
            citations++
            continue
          }
          affiliate++
          if (!clean.includes('fpr=ghs3')) detail.push(`${rel}: чужой токен fpr -> ${clean}`)
          const sid = clean.match(/[?&]fp_sid=([A-Za-z0-9_-]+)/)
          if (!sid) detail.push(`${rel}: нет fp_sid -> ${clean}`)
          else sids.set(sid[1], (sids.get(sid[1]) ?? 0) + 1)
        }
      }
      const ok = detail.length === 0 && affiliate > 0
      if (affiliate === 0) detail.push('в dist нет ни одной партнёрской ссылки — это тоже расхождение')
      if (ok) {
        detail.push(`${affiliate} партнёрских ссылок (${citations} упоминаний без fpr), ${sids.size} различных fp_sid`)
        for (const [sid, n] of [...sids].sort((a, b) => b[1] - a[1])) detail.push(`  ${sid}: ${n}`)
      }
      return {
        id: 'affiliate-subid',
        group: 'Affiliate',
        ok,
        headline: ok ? `${affiliate} партнёрских ссылок, все с fpr=ghs3 и fp_sid` : `проблем: ${detail.length}`,
        detail,
      }
    },
  },

  // ─────────────── SDS sections: /sds-sections/ (session 31) ───────────────
  // Раздел построен из контент-коллекции, а выпадашка веществ — из живой базы.
  // Поэтому проверок две породы: набор страниц сверяется с прозой на диске,
  // а всё, что про вещества, — с `sds_pages` в момент запуска.
  {
    id: 'sdssec-pages',
    group: 'SDS sections',
    title: 'Набор страниц /sds-sections/ равен набору MDX-файлов коллекции',
    run: async () => {
      // ⚠ Ожидание берётся из src/content/sds-sections, а НЕ из SDS_SECTIONS:
      // спина знает все 16, но URL появляется только вместе с прозой. Ровно то
      // же правило зашито в getStaticPaths маршрута.
      const dir = resolve(process.cwd(), 'src/content/sds-sections')
      const expected = new Set(
        !existsSync(dir)
          ? []
          : readdirSync(dir)
              .filter((f) => f.endsWith('.mdx') || f.endsWith('.md'))
              .map((f) => f.replace(/\.mdx?$/, '')),
      )
      const actual = new Set(pageSlugs('sds-sections'))
      const { missing, extra } = diffSets(actual, expected)
      const ok = missing.length === 0 && extra.length === 0
      const detail: string[] = []
      if (missing.length) detail.push(`нет в dist (${missing.length}): ${preview(missing)}`)
      if (extra.length) detail.push(`лишние в dist (${extra.length}): ${preview(extra)}`)
      if (ok) detail.push('каждой секции с прозой соответствует ровно одна страница')
      return {
        id: 'sdssec-pages',
        group: 'SDS sections',
        ok,
        headline: `${actual.size} страниц в dist, коллекция ожидает ${expected.size}`,
        detail,
      }
    },
  },
  {
    id: 'sdssec-picker-count',
    group: 'SDS sections',
    title: 'Выпадашка веществ на каждой странице секции равна живому реестру sds_pages',
    run: async () => {
      // ⚠ Главная проверка раздела. Список тянется из Supabase в getStaticPaths;
      // если база молча ответит пустотой, страницы соберутся БЕЗ блока и в логе
      // сборки не будет ни строчки. Здесь это видно сразу.
      const { pages } = await sdsData()
      const expected = pages.length
      const detail: string[] = []
      for (const slug of pageSlugs('sds-sections')) {
        const html = readPage(`sds-sections/${slug}/index.html`)
        if (html === null) {
          detail.push(`${slug}: нет index.html`)
          continue
        }
        const n = countOccurrences(html, 'data-blob="')
        if (n !== expected) detail.push(`${slug}: ${n} веществ, ожидалось ${expected}`)
      }
      const ok = detail.length === 0
      if (ok) detail.push(`маркер: data-blob=" на каждой строке списка`)
      return {
        id: 'sdssec-picker-count',
        group: 'SDS sections',
        ok,
        headline: ok
          ? `на всех страницах по ${expected} веществ`
          : `расхождений: ${detail.length}`,
        detail,
      }
    },
  },
  {
    id: 'sdssec-picker-targets',
    group: 'SDS sections',
    title: 'Каждая ссылка выпадашки ведёт на существующую страницу вещества',
    run: async () => {
      const live = new Set(pageSlugs('sds'))
      const bad = new Set<string>()
      let links = 0
      for (const slug of pageSlugs('sds-sections')) {
        const html = readPage(`sds-sections/${slug}/index.html`)
        if (!html) continue
        for (const m of html.matchAll(/href="\/sds\/([a-z0-9-]+)\/(#s\d+)?"/g)) {
          links++
          if (!live.has(m[1])) bad.add(`${slug} -> /sds/${m[1]}/`)
        }
      }
      const ok = bad.size === 0
      return {
        id: 'sdssec-picker-targets',
        group: 'SDS sections',
        ok,
        headline: ok ? `${links} ссылок, все ведут в живые страницы` : `битых целей: ${bad.size}`,
        detail: ok ? [`живых страниц /sds/: ${live.size}`] : [preview([...bad], 20)],
      }
    },
  },
  {
    id: 'sdssec-anchors',
    group: 'SDS sections',
    title: 'Покрытие якорей #sN на страницах веществ совпадает с anchorCoverage',
    run: async () => {
      // ⚠ Числа в src/lib/sdsSections.ts — замер, а не догадка (session 31,
      // 2026-08-03). Они устареют, как только §12 (эко-импорт) и §15 (Step 4)
      // появятся на страницах веществ. Пусть это ловится здесь, а не глазами.
      const slugs = pageSlugs('sds')
      const detail: string[] = []
      for (const sec of SDS_SECTIONS) {
        let n = 0
        for (const s of slugs) {
          const html = readPage(`sds/${s}/index.html`)
          if (html && html.includes(`id="s${sec.n}"`)) n++
        }
        if (n !== sec.anchorCoverage) {
          // ⚠ Читается в ДВЕ стороны, и это важно (session 31, первый же прогон):
          //  * n БОЛЬШЕ записанного — секция доехала до новых веществ, обновить константу;
          //  * n МЕНЬШЕ — блок пропал со страниц, и почти наверняка это не данные,
          //    а молча упавший запрос в getStaticPaths страницы вещества.
          // Арбитр — база, а не эта константа. Так поймали 15 веществ, потерявших
          // §10 из-за отказа get_storage_verdict на флаky-сборке.
          const verdict = n > sec.anchorCoverage ? 'больше — похоже, обновить константу' : 'МЕНЬШЕ — похоже, сборка потеряла блок'
          detail.push(
            `section ${sec.n}: якорь #s${sec.n} на ${n} страницах, в sdsSections.ts записано ${sec.anchorCoverage} — ${verdict}`,
          )
        }
        // Ссылку с якорем ставим только там, где якорь реально есть.
        if (sec.anchor === null && n > 20) {
          detail.push(`section ${sec.n}: anchor = null, но якорь уже на ${n} страницах — пора включить`)
        }
      }
      const ok = detail.length === 0
      if (ok) detail.push(`сверено 16 секций против ${slugs.length} страниц веществ`)
      return {
        id: 'sdssec-anchors',
        group: 'SDS sections',
        ok,
        headline: ok ? 'все 16 замеров совпали' : `расхождений: ${detail.length}`,
        detail,
      }
    },
  },
  {
    id: 'sdssec-checklist',
    group: 'SDS sections',
    title: 'Все три списка чек-листа лежат в HTML на сборке, а не рисуются JS-ом',
    run: async () => {
      // Переключатель юрисдикций только снимает hidden. Если списки начнут
      // рисоваться скриптом, для краулера страница станет пустой — а список
      // подпунктов и есть её содержимое.
      const detail: string[] = []
      for (const slug of pageSlugs('sds-sections')) {
        const html = readPage(`sds-sections/${slug}/index.html`)
        if (!html) continue
        const lists = ['eu', 'us', 'un'].filter((j) => html.includes(`data-for="${j}"`))
        const boxes = countOccurrences(html, 'type="checkbox"')
        if (lists.length < 3) detail.push(`${slug}: списков ${lists.length} из 3 (${lists.join(', ') || 'нет ни одного'})`)
        if (boxes === 0) detail.push(`${slug}: ни одного пункта чек-листа в HTML`)
      }
      const ok = detail.length === 0
      if (ok) detail.push('маркеры: data-for="eu" + data-for="us" + data-for="un" + type="checkbox"')
      return {
        id: 'sdssec-checklist',
        group: 'SDS sections',
        ok,
        headline: ok ? 'на всех страницах три списка и непустой чек-лист' : `проблем: ${detail.length}`,
        detail,
      }
    },
  },
  {
    id: 'sdssec-sitemap',
    group: 'SDS sections',
    title: 'Хаб и все страницы секций попали в sitemap.xml',
    run: async () => {
      const xml = readPage('sitemap.xml')
      if (xml === null) {
        return { id: 'sdssec-sitemap', group: 'SDS sections', ok: false, headline: 'нет dist/sitemap.xml', detail: [] }
      }
      const expected = ['/sds-sections/', ...pageSlugs('sds-sections').map((s) => `/sds-sections/${s}/`)]
      const missing = expected.filter((u) => !xml.includes(`<loc>https://ghspictograms.com${u}</loc>`))
      const ok = missing.length === 0
      return {
        id: 'sdssec-sitemap',
        group: 'SDS sections',
        ok,
        headline: ok ? `все ${expected.length} URL в sitemap` : `в sitemap нет ${missing.length} из ${expected.length}`,
        detail: ok ? ['маркер: <loc>…/sds-sections/…</loc>'] : [preview(missing, 20)],
      }
    },
  },
  {
    id: 'sdssec-global-nav',
    group: 'SDS sections',
    title: 'Ссылка на хаб стоит на каждой странице сайта (шапка и подвал)',
    run: async () => {
      // Шапка и подвал глобальные — ссылка обязана быть на каждой странице,
      // которая эту шапку рендерит. ⚠ Не на каждой странице сайта: /subscribed/
      // — самостоятельный noindex-экран после подписки, он идёт мимо Layout со
      // своим <html>, и требовать от него ссылку значит ловить ложную тревогу.
      // Поэтому фильтр по маркеру шапки, а не по всем файлам.
      const pages = allPages().filter((p) => p.rel.endsWith('index.html') && p.html.includes('sh-header'))
      const without = pages.filter((p) => !p.html.includes('href="/sds-sections/"')).map((p) => p.rel)
      const ok = without.length === 0
      return {
        id: 'sdssec-global-nav',
        group: 'SDS sections',
        ok,
        headline: ok ? `ссылка на всех ${pages.length} страницах` : `нет на ${without.length} из ${pages.length}`,
        detail: ok ? ['маркер: href="/sds-sections/"'] : [preview(without, 20)],
      }
    },
  },

  {
    id: 'substance-display-name',
    group: 'Имена',
    title: 'Имя вещества в списках — человеческое, а не строка Annex VI',
    run: async () => {
      const expected = await expectedDisplayNames()
      const detail: string[] = []

      // а) инвариант на стороне базы
      const dbSemicolon = [...expected].filter((n) => n.includes(';'))
      if (dbSemicolon.length) {
        detail.push(
          `в базе ${dbSemicolon.length} имён с точкой с запятой. Это сырая колонка Annex VI ` +
            '«International Chemical Identification» — она список синонимов, а не имя: ' +
            preview(dbSemicolon.map((s) => `«${s.slice(0, 40)}»`), 6),
        )
      }

      // б) что реально напечатано в dist
      const printed = printedSubstanceNames()
      if (printed.length < 500) {
        detail.push(
          `в dist найдено всего ${printed.length} подписей <span class="name" title=…>. ` +
            'Похоже, разметка списка изменилась и проверка смотрит не туда. ' +
            'Чинить надо проверку, а не выключать её.',
        )
      }

      const semicolon = printed.filter((p) => p.name.includes(';'))
      if (semicolon.length) {
        detail.push(
          `напечатано имён с точкой с запятой: ${semicolon.length}. ` +
            preview(semicolon.slice(0, 6).map((p) => `${p.page}: «${p.name.slice(0, 45)}»`), 6),
        )
      }

      const unknown = [...new Set(printed.filter((p) => !expected.has(p.name)).map((p) => p.name))]
      if (unknown.length) {
        detail.push(
          `имён, которых база не даёт ни по одному источнику: ${unknown.length}. ` +
            'Так выглядит забытый display_name_short в .select() — откат на сырое имя происходит молча: ' +
            preview(unknown.map((s) => `«${s.slice(0, 40)}»`), 8),
        )
      }

      const ok = detail.length === 0
      return {
        id: 'substance-display-name',
        group: 'Имена',
        ok,
        headline: ok
          ? `${printed.length} подписей в dist, все совпали с правилом common_name → display_name_short → iupac_name`
          : `${printed.length} подписей в dist, расхождений ${semicolon.length + unknown.length}`,
        detail,
      }
    },
  },
  // ───────────────────── справочник веществ (session 35) ─────────────────────

  {
    id: 'subs-pages',
    group: 'subs',
    title: 'Собраны страницы всех веществ с пригодным CAS',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-pages', slugs)
      if (miss) return miss

      const exp = await substanceExpectation()
      const { missing, extra } = diffSets(new Set(slugs!), new Set(exp.bySlug.keys()))
      const detail: string[] = []
      if (missing.length) detail.push(`нет в dist (${missing.length}): ${preview(missing)}`)
      if (extra.length) detail.push(`лишние в dist (${extra.length}): ${preview(extra)}`)
      // Коллизия слагов схлопывает две строки базы в одну страницу — это не
      // расхождение с dist, но знать о нём надо.
      if (exp.rowCount !== exp.bySlug.size) {
        detail.push(
          `строк базы ${exp.rowCount}, различных слагов ${exp.bySlug.size}: ` +
            `${exp.rowCount - exp.bySlug.size} записей делят адрес с другой записью`,
        )
      }
      const ok = missing.length === 0 && extra.length === 0
      // ⚠ Подпись обязана описывать ДЕЙСТВУЮЩИЙ отбор. «не null и без "["» осталось
      // от прежнего правила и после ужесточения стало враньём в зелёном выводе —
      // а неверная подпись под галочкой хуже, чем её отсутствие.
      if (ok && !detail.length) detail.push('отбор: cas_number строгой формы \\d{2,7}-\\d{2}-\\d')
      return {
        id: 'subs-pages',
        group: 'subs',
        ok,
        headline: `${slugs!.length} страниц в dist/substances/, база ожидает ${exp.bySlug.size}`,
        detail,
      }
    },
  },

  {
    id: 'subs-slug-cas',
    group: 'subs',
    title: 'Хвост каждого слага разбирается в CAS, и такой CAS есть в базе',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-slug-cas', slugs)
      if (miss) return miss

      const exp = await substanceExpectation()
      const unparsed: string[] = []
      const unknown: string[] = []
      for (const slug of slugs!) {
        // ⚠ Тот же casFromSlug, что стоит в редиректе с ghssymbols: если он
        // не разберёт адрес здесь, он не разберёт его и на проде.
        const cas = casFromSlug(slug)
        if (!cas) unparsed.push(slug)
        else if (!exp.casSet.has(cas)) unknown.push(`${slug} -> ${cas}`)
      }
      const detail: string[] = []
      if (unparsed.length) {
        detail.push(
          `хвост не похож на CAS (${unparsed.length}): ${preview(unparsed)}. ` +
            'Редирект /hazards/<cas>/ на такую страницу не наведётся.',
        )
      }
      if (unknown.length) {
        detail.push(`CAS разобран, но его нет в базе (${unknown.length}): ${preview(unknown)}`)
      }
      const ok = detail.length === 0
      if (ok) detail.push(`разобрано ${slugs!.length} слагов, все CAS нашлись в substances`)
      return {
        id: 'subs-slug-cas',
        group: 'subs',
        ok,
        headline: ok
          ? `${slugs!.length} слагов, все дали известный CAS`
          : `проблем: ${unparsed.length + unknown.length} из ${slugs!.length}`,
        detail,
      }
    },
  },

  {
    id: 'subs-static-content',
    group: 'subs',
    title: 'Содержимое вещества лежит в HTML, а не подгружается островом',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-static-content', slugs)
      if (miss) return miss

      const exp = await substanceExpectation()
      const detail: string[] = []

      // ── а) сплошной обход: у КАЖДОЙ страницы есть <h1> и подпись CAS ──
      // ⚠ Маркеры по правилу 1: <h1> и chip «CAS …» производит только разметка
      // hero этой страницы. Считаем страницы, а не вхождения (правило 2).
      const noH1: string[] = []
      const noCas: string[] = []
      for (const slug of slugs!) {
        const html = readFileSync(join(DIST, 'substances', slug, 'index.html'), 'utf8')
        if (!/<h1[^>]*>[^<]/.test(html)) noH1.push(slug)
        const cas = casFromSlug(slug)
        if (cas && !html.includes(`>CAS ${cas}</span>`)) noCas.push(slug)
      }
      if (noH1.length) detail.push(`пустой или отсутствующий <h1> (${noH1.length}): ${preview(noH1)}`)
      if (noCas.length) detail.push(`нет чипа ">CAS <cas></span>" (${noCas.length}): ${preview(noCas)}`)

      // ── б) контрольные вещества: имя, CAS и ЧИСЛО на месте ──
      // Список фиксированный и заведомо крупный: если раздел собрался, эти
      // вещества в нём есть. Ни одного не нашли — значит проверка смотрит не туда.
      const SAMPLE = ['67-64-1', '108-88-3', '67-56-1', '71-43-2', '7664-93-9', '64-17-5']
      assertAscii('subs-static-content', SAMPLE.map((c) => `>CAS ${c}</span>`))

      const bySampleCas = new Map<string, string>()
      for (const [slug, v] of exp.bySlug) if (SAMPLE.includes(v.cas)) bySampleCas.set(v.cas, slug)

      let deepChecked = 0
      for (const cas of SAMPLE) {
        const slug = bySampleCas.get(cas)
        if (!slug) continue
        const rel = `substances/${slug}/index.html`
        const html = readPage(rel)
        if (html === null) {
          detail.push(`${cas}: базa даёт слаг ${slug}, но файла ${rel} нет`)
          continue
        }
        deepChecked++
        const name = exp.bySlug.get(slug)!.name
        // Имя приходит из базы и не обязано быть ASCII — под правило 3 (маркеры
        // только ASCII) оно не подпадает, поэтому assertAscii к нему не применяем.
        const escaped = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        if (!html.includes(escaped)) {
          detail.push(`${cas} (${slug}): в HTML нет имени «${name.slice(0, 40)}»`)
        }
        if (!html.includes(`>CAS ${cas}</span>`)) {
          // ⚠ Различаем два разных провала. Если голая строка «CAS <cas>» в файле
          // есть, а точного маркера нет — поменялась разметка чипа, и чинить надо
          // проверку. Если нет и её — со страницы пропало содержимое.
          detail.push(
            html.includes(`CAS ${cas}`)
              ? `${cas} (${slug}): строка "CAS ${cas}" в файле есть, но не в чипе ">CAS ${cas}</span>". ` +
                'Разметка hero изменилась — поправить маркер, а не выключать проверку.'
              : `${cas} (${slug}): в HTML нет ни чипа, ни строки "CAS ${cas}" — содержимого на странице нет`,
          )
        }
        // Число свойства: ячейка <td class="c-val"> таблицы sub-props. Требуем
        // цифру — пустая таблица и «no data» тут не проходят.
        // ⚠ Маркер сменился с c-n на c-val вместе с разметкой (session 36):
        // класс c-n на телефоне дописывает через ::before «substances · ».
        // Проверка и разметка правятся ОДНИМ движением, иначе проверка ослепнет.
        const cells = [...html.matchAll(/<td class="c-val(?: c-val-text)?">([^<]*)<\/td>/g)].map((m) => m[1])
        const numeric = cells.filter((c) => /\d/.test(c))
        if (!numeric.length) {
          detail.push(
            `${cas} (${slug}): ни одного числового значения свойства ` +
              `(ячеек <td class="c-val">: ${cells.length}). Размер файла ${Math.round(html.length / 1024)} КБ — ` +
              'так выглядит остров client:load вместо статики.',
          )
        }
      }

      if (deepChecked === 0) {
        detail.push(
          `ни одно из контрольных веществ (${SAMPLE.join(', ')}) не нашлось в базе. ` +
            'Чинить надо проверку, а не выключать её: список устарел или отбор разошёлся со страницей.',
        )
      }

      const ok = detail.length === 0
      return {
        id: 'subs-static-content',
        group: 'subs',
        ok,
        headline: ok
          ? `${slugs!.length} страниц с именем и CAS в HTML, из них ${deepChecked} проверены с числами`
          : `расхождений: ${detail.length}`,
        detail: ok
          ? ['маркеры: <h1>, ">CAS <cas></span>", <td class="c-val"> с цифрой']
          : detail,
      }
    },
  },

  {
    id: 'subs-sitemap',
    group: 'subs',
    title: 'Собранные страницы веществ и sitemap.xml совпадают в обе стороны',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-sitemap', slugs)
      if (miss) return miss

      const xml = readPage('sitemap.xml')
      if (xml === null) {
        return { id: 'subs-sitemap', group: 'subs', ok: false, headline: 'нет dist/sitemap.xml', detail: [] }
      }
      // ⚠ Хаб /substances/ в сравнение не входит: у него нет собранной подпапки,
      // он index.html самого раздела. Берём только адреса с непустым слагом.
      const inSitemap = new Set(
        [...xml.matchAll(/<loc>https:\/\/ghspictograms\.com\/substances\/([^<\/]+)\/<\/loc>/g)].map((m) => m[1]),
      )
      const { missing, extra } = diffSets(inSitemap, new Set(slugs!))
      const detail: string[] = []
      if (missing.length) {
        detail.push(
          `собраны, но в sitemap их нет (${missing.length}): ${preview(missing)}`,
        )
      }
      if (extra.length) {
        detail.push(
          `sitemap зовёт краулера на несобранные адреса (${extra.length}): ${preview(extra)}. ` +
            'Это прямое нарушение правила «sitemap не объявляет страницу, которую getStaticPaths не строит».',
        )
      }
      const ok = missing.length === 0 && extra.length === 0
      if (ok) detail.push('маркер: <loc>https://ghspictograms.com/substances/<slug>/</loc>')
      return {
        id: 'subs-sitemap',
        group: 'subs',
        ok,
        headline: `в sitemap ${inSitemap.size} страниц веществ, в dist ${slugs!.length}`,
        detail,
      }
    },
  },

  // ─────────────── перелинковка справочника (session 37) ───────────────
  // ⚠⚠ Три проверки ниже закрывают дыру, честно записанную в хендоффе session 36:
  // буквенный указатель не был покрыт НИ ОДНОЙ проверкой, а связей «вбок» между
  // веществами не существовало вовсе.

  {
    id: 'subs-browse',
    group: 'subs',
    title: 'Буквенный указатель собран, и каждое вещество лежит ровно в одной букве',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-browse', slugs)
      if (miss) return miss

      const exp = await substanceExpectation()

      // ⚠ Правило буквы продублировано в трёх местах (страница вещества, страница
      // указателя, эта проверка) — иначе крошка поведёт в 404. Здесь оно записано
      // третий раз НАМЕРЕННО: проверка обязана быть независимым источником, а не
      // импортом того же кода, который проверяет.
      const bucketOf = (name: string): string => {
        const c = name.trim().charAt(0).toLowerCase()
        return c >= 'a' && c <= 'z' ? c : '0-9'
      }

      const expectedByLetter = new Map<string, Set<string>>()
      for (const [slug, v] of exp.bySlug) {
        const l = bucketOf(v.name)
        if (!expectedByLetter.has(l)) expectedByLetter.set(l, new Set())
        expectedByLetter.get(l)!.add(slug)
      }

      const built = pageSlugs(join('substances', 'browse'))
      const detail: string[] = []
      const { missing, extra } = diffSets(new Set(built), new Set(expectedByLetter.keys()))
      if (missing.length) {
        detail.push(
          `буквы, у которых есть вещества, но нет страницы (${missing.length}): ${preview(missing)}`,
        )
      }
      if (extra.length) {
        detail.push(
          `собраны буквы без единого вещества (${extra.length}): ${preview(extra)}. ` +
            'Пустая страница в индексе хуже её отсутствия.',
        )
      }

      // ⚠ Маркер по правилу 1: строку `<a class="hub-index-card" href="/substances/`
      // производит ТОЛЬКО список указателя. Ни подвал, ни герой её не дают.
      const CARD = 'href="/substances/'
      assertAscii('subs-browse', ['<a class="hub-index-card" ' + CARD])
      const LINK = /<a class="hub-index-card" href="\/substances\/([^"\/]+)\/"/g

      const builtSet = new Set(slugs!)
      let listed = 0
      for (const letter of built) {
        const rel = join('substances', 'browse', letter, 'index.html')
        const html = readPage(rel)
        if (html === null) {
          detail.push(`${letter}: папка есть, а ${rel} нет`)
          continue
        }
        const linked = new Set([...html.matchAll(LINK)].map((m) => m[1]))
        listed += linked.size
        const want = expectedByLetter.get(letter)
        if (!want) continue
        // ⚠ diffSets(actual, expected): missing — чего база ждёт, а в списке нет;
        // extra — что в списке есть, а база не ждёт. Порядок аргументов важен.
        const cmp = diffSets(linked, want)
        if (cmp.missing.length) {
          detail.push(`${letter}: база ждёт, в списке нет (${cmp.missing.length}): ${preview(cmp.missing)}`)
        }
        if (cmp.extra.length) {
          detail.push(`${letter}: в списке есть, база не ждёт (${cmp.extra.length}): ${preview(cmp.extra)}`)
        }
        const dead = [...linked].filter((s) => !builtSet.has(s))
        if (dead.length) {
          detail.push(`${letter}: указатель ведёт на несобранные страницы (${dead.length}): ${preview(dead)}`)
        }
      }

      // Сумма по буквам обязана сойтись с числом страниц раздела: вещество,
      // не попавшее ни в одну букву, из указателя недостижимо.
      if (listed !== slugs!.length) {
        detail.push(
          `в буквах перечислено ${listed} веществ, а страниц собрано ${slugs!.length}: ` +
            `${Math.abs(listed - slugs!.length)} не сходится`,
        )
      }

      const ok = detail.length === 0
      if (ok) {
        detail.push(`маркер: <a class="hub-index-card" href="/substances/<slug>/"`)
        detail.push(`букв со страницей: ${built.length}, перечислено веществ: ${listed}`)
      }
      return {
        id: 'subs-browse',
        group: 'subs',
        ok,
        headline: ok
          ? `${built.length} буквенных страниц, все ${listed} веществ достижимы из указателя`
          : `расхождений: ${detail.length}`,
        detail,
      }
    },
  },

  {
    id: 'subs-prevnext',
    group: 'subs',
    title: 'Соседи по алфавиту образуют одну сплошную цепь через весь справочник',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-prevnext', slugs)
      if (miss) return miss

      // ⚠⚠ Эта проверка НЕ спрашивает базу СПЕЦИАЛЬНО. Она читает готовый HTML и
      // проверяет граф на связность: пройти цепь от первого вещества до последнего
      // и убедиться, что она задела каждую страницу ровно один раз. Урок session 34:
      // когда всё зеленеет, проверь независимость источников. Здесь источник —
      // сам dist, а не то же самое правило, по которому он собран.
      const NAV = /<nav class="hub-prevnext" aria-label="Neighbouring substances">([\s\S]*?)<\/nav>/
      assertAscii('subs-prevnext', ['<nav class="hub-prevnext" aria-label="Neighbouring substances">'])
      const HREF = /<a href="([^"]+)"/g
      const SUB = /^\/substances\/([^\/]+)\/$/
      const UP = /^\/substances\/browse\/([^\/]+)\/$/

      const detail: string[] = []
      const noNav: string[] = []
      const badShape: string[] = []
      const nextOf = new Map<string, string>()
      const prevOf = new Map<string, string>()
      const heads: string[] = [] // первая запись: «назад» ведёт вверх, на букву
      const tails: string[] = [] // последняя запись: «вперёд» ведёт вверх
      const builtSet = new Set(slugs!)
      const dead: string[] = []

      for (const slug of slugs!) {
        const html = readPage(join('substances', slug, 'index.html'))
        if (html === null) {
          noNav.push(slug)
          continue
        }
        const nav = NAV.exec(html)
        if (!nav) {
          noNav.push(slug)
          continue
        }
        const hrefs = [...nav[1].matchAll(HREF)].map((m) => m[1])
        if (hrefs.length !== 2) {
          badShape.push(`${slug}: ссылок в блоке ${hrefs.length}, а должно быть 2`)
          continue
        }
        const [back, fwd] = hrefs
        const bm = SUB.exec(back)
        const fm = SUB.exec(fwd)
        if (bm) {
          prevOf.set(slug, bm[1])
          if (!builtSet.has(bm[1])) dead.push(`${slug} ← ${bm[1]}`)
        } else if (UP.test(back)) heads.push(slug)
        else badShape.push(`${slug}: «назад» ведёт не на вещество и не на букву -> ${back}`)

        if (fm) {
          nextOf.set(slug, fm[1])
          if (!builtSet.has(fm[1])) dead.push(`${slug} → ${fm[1]}`)
        } else if (UP.test(fwd)) tails.push(slug)
        else badShape.push(`${slug}: «вперёд» ведёт не на вещество и не на букву -> ${fwd}`)
      }

      if (noNav.length) {
        detail.push(
          `нет блока соседей (${noNav.length}): ${preview(noNav)}. ` +
            'Так выглядит страница, до которой перелинковка не доехала.',
        )
      }
      if (badShape.length) detail.push(`неверная форма блока (${badShape.length}): ${preview(badShape, 6)}`)
      if (dead.length) detail.push(`сосед ведёт на несобранную страницу (${dead.length}): ${preview(dead)}`)

      // Концов у цепи ровно два, и они разные.
      if (heads.length !== 1) detail.push(`начал цепи должно быть 1, найдено ${heads.length}: ${preview(heads)}`)
      if (tails.length !== 1) detail.push(`концов цепи должно быть 1, найдено ${tails.length}: ${preview(tails)}`)

      // Взаимность: если A говорит «следующий B», то B обязан говорить «предыдущий A».
      const oneWay: string[] = []
      for (const [from, to] of nextOf) {
        if (prevOf.get(to) !== from) oneWay.push(`${from} → ${to}, но обратно ${prevOf.get(to) ?? '—'}`)
      }
      if (oneWay.length) detail.push(`связь односторонняя (${oneWay.length}): ${preview(oneWay, 6)}`)

      // Проход цепи целиком: единственный способ поймать разрыв и кольцо.
      let walked = 0
      if (heads.length === 1) {
        const seen = new Set<string>()
        let cur: string | undefined = heads[0]
        while (cur && !seen.has(cur)) {
          seen.add(cur)
          walked++
          cur = nextOf.get(cur)
        }
        if (cur && seen.has(cur)) detail.push(`цепь замкнулась в кольцо на ${cur}`)
        if (walked !== slugs!.length) {
          const unreachable = slugs!.filter((s) => !seen.has(s))
          detail.push(
            `цепь прошла ${walked} страниц из ${slugs!.length}: ` +
              `${unreachable.length} недостижимы обходом «вперёд», например ${preview(unreachable, 6)}`,
          )
        }
      }

      const ok = detail.length === 0
      if (ok) {
        detail.push(`маркер: <nav class="hub-prevnext" aria-label="Neighbouring substances">`)
        detail.push(`связей «вбок»: ${nextOf.size + prevOf.size}, концы цепи: ${heads[0]} … ${tails[0]}`)
      }
      return {
        id: 'subs-prevnext',
        group: 'subs',
        ok,
        headline: ok
          ? `цепь прошла все ${walked} страниц без разрывов и колец`
          : `расхождений: ${detail.length}`,
        detail,
      }
    },
  },

  // ─────────────────── фирменный знак и значки (session 37) ───────────────────
  // ⚠⚠ Зачем это вообще проверять. Дефолтный favicon.ico фреймворка Astro
  // (чёрный квадрат с ракетой) пролежал в public/ полтора года и показывался
  // во вкладке браузера как логотип сайта. Рядом лежал og-default.png —
  // ПРОЗРАЧНЫЙ ПИКСЕЛЬ 1 × 1 на 70 байт, из-за которого каждое превью ссылки в
  // Slack, LinkedIn и Telegram выходило пустым. Оба дефекта прожили так долго
  // ровно потому, что их никто не стерёг: они не ломают сборку и не видны
  // на самой странице.
  {
    id: 'brand-icons',
    group: 'Brand',
    title: 'Значки на месте, не дефолтные и пригодны к своим размерам',
    run: async () => {
      const detail: string[] = []

      /** Кадры внутри .ico: 6 байт заголовка, дальше по 16 байт на кадр. */
      const icoFrames = (buf: Buffer): Array<[number, number]> => {
        if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return []
        const n = buf.readUInt16LE(4)
        const out: Array<[number, number]> = []
        for (let i = 0; i < n && 6 + 16 * i + 1 < buf.length; i++) {
          out.push([buf[6 + 16 * i] || 256, buf[7 + 16 * i] || 256])
        }
        return out
      }

      /** Ширина, высота и тип цвета PNG из блока IHDR — без сторонних библиотек. */
      const png = (buf: Buffer): { w: number; h: number; colour: number } | null => {
        if (buf.length < 26 || buf.readUInt32BE(0) !== 0x89504e47) return null
        if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), colour: buf[25] }
      }

      const read = (rel: string): Buffer | null => {
        const abs = join(DIST, rel)
        return existsSync(abs) ? readFileSync(abs) : null
      }

      // ── .ico: кадр 16 × 16 обязателен ──
      const ico = read('favicon.ico')
      if (!ico) detail.push('нет dist/favicon.ico')
      else {
        const frames = icoFrames(ico)
        if (!frames.length) detail.push('favicon.ico не разбирается как ICO')
        else if (!frames.some(([w, h]) => w === 16 && h === 16)) {
          detail.push(
            `в favicon.ico нет кадра 16 × 16, есть только ${frames.map((f) => f.join('×')).join(', ')}. ` +
              'Браузер сожмёт кадр 32, полосы знака попадут на половину пикселя и замылятся — ' +
              'ровно то, ради чего кадр 16 рисовали по сетке вручную.',
          )
        }
        // ⚠ Дефолт Astro — 32 × 32 в одном кадре и весит около 650 байт.
        // Точный размер не проверяем: значок могут пересобрать. Проверяем суть:
        // одинокий кадр 32 — это и есть признак «значок не наш».
        if (icoFrames(ico).length === 1 && icoFrames(ico)[0][0] === 32) {
          detail.push('favicon.ico несёт единственный кадр 32 × 32 — так выглядит дефолтный значок Astro')
        }
      }

      // ── apple-touch-icon: без альфа-канала вовсе ──
      // ⚠⚠ iOS кладёт поверх своё скругление и подставляет под прозрачность
      // ЧЁРНЫЙ. Прозрачные углы дают чёрные уголки на домашнем экране.
      // Тип цвета 6 и 4 — с альфой, 2 и 0 — без.
      const touch = read('apple-touch-icon.png')
      if (!touch) detail.push('нет dist/apple-touch-icon.png')
      else {
        const m = png(touch)
        if (!m) detail.push('apple-touch-icon.png не разбирается как PNG')
        else {
          if (m.w !== 180 || m.h !== 180) detail.push(`apple-touch-icon.png ${m.w}×${m.h}, а должен быть 180×180`)
          if (m.colour === 6 || m.colour === 4) {
            detail.push(
              'apple-touch-icon.png с альфа-каналом. iOS подставит под прозрачность чёрный, ' +
                'и на домашнем экране будут чёрные углы. Заливать фоном во весь квадрат.',
            )
          }
        }
      }

      // ── иконки манифеста ──
      for (const [rel, size] of [['icon-192.png', 192], ['icon-512.png', 512]] as const) {
        const buf = read(rel)
        if (!buf) { detail.push(`нет dist/${rel}`); continue }
        const m = png(buf)
        if (!m) detail.push(`${rel} не разбирается как PNG`)
        else if (m.w !== size || m.h !== size) detail.push(`${rel} ${m.w}×${m.h}, а должен быть ${size}×${size}`)
      }

      // ── манифест разбирается, и всё, что он объявляет, существует ──
      const mf = readPage('site.webmanifest')
      if (mf === null) detail.push('нет dist/site.webmanifest')
      else {
        try {
          const parsed = JSON.parse(mf) as { icons?: Array<{ src?: string }> }
          for (const icon of parsed.icons ?? []) {
            const src = (icon.src ?? '').replace(/^\//, '')
            if (src && !existsSync(join(DIST, src))) detail.push(`манифест зовёт ${icon.src}, а файла нет`)
          }
        } catch (e) {
          detail.push(`site.webmanifest не разбирается как JSON: ${(e as Error).message}`)
        }
      }

      // ── ссылки в <head> стоят на КАЖДОЙ странице ──
      // ⚠ Маркеры по правилу 1: эти строки производит только Layout.astro.
      const LINKS = [
        'href="/favicon.svg"',
        'href="/favicon.ico"',
        'href="/apple-touch-icon.png"',
        'href="/site.webmanifest"',
      ]
      assertAscii('brand-icons', LINKS)
      const pages = allPages()
      for (const marker of LINKS) {
        const without = pages.filter((p) => !p.html.includes(marker)).map((p) => p.rel)
        if (without.length) {
          detail.push(`${marker} нет на ${without.length} страницах из ${pages.length}: ${preview(without, 6)}`)
        }
      }

      const ok = detail.length === 0
      if (ok) {
        detail.push(`ссылки на значки на всех ${pages.length} страницах`)
        detail.push(`favicon.ico: кадры ${icoFrames(ico!).map((f) => f.join('×')).join(', ')}`)
      }
      return {
        id: 'brand-icons',
        group: 'Brand',
        ok,
        headline: ok ? 'значки свои, размеры и прозрачность в порядке' : `расхождений: ${detail.length}`,
        detail,
      }
    },
  },

  {
    id: 'brand-og',
    group: 'Brand',
    title: 'Превью для соцсетей существует, нужного размера и не пустое',
    run: async () => {
      const detail: string[] = []
      const abs = join(DIST, 'og-default.png')
      if (!existsSync(abs)) {
        detail.push('нет dist/og-default.png — каждое превью ссылки в соцсетях выйдет пустым')
      } else {
        const buf = readFileSync(abs)
        // ⚠⚠ Порог веса — не придирка. Прежний файл был прозрачным пикселем
        // 1 × 1 на 70 байт: формально «картинка есть», а по факту пусто.
        // Размер он бы прошёл только вместе с проверкой ширины, поэтому нужны обе.
        if (buf.length < 10_000) {
          detail.push(
            `og-default.png весит ${buf.length} байт. Так выглядит заглушка, а не превью: ` +
              'до session 37 здесь лежал прозрачный пиксель 1 × 1 на 70 байт.',
          )
        }
        if (buf.length >= 26 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
          const w = buf.readUInt32BE(16)
          const h = buf.readUInt32BE(20)
          if (w !== 1200 || h !== 630) {
            detail.push(`og-default.png ${w}×${h}, а площадки ждут 1200×630`)
          }
        } else {
          detail.push('og-default.png не разбирается как PNG')
        }
      }

      // ⚠ og:image обязан быть АБСОЛЮТНЫМ адресом: Facebook и LinkedIn
      // относительный путь не разрешают и показывают пустое место.
      const OG = 'property="og:image" content="https://'
      assertAscii('brand-og', [OG])
      // ⚠ Страницы под noindex из требования исключены осознанно: их не увидит
      // ни поиск, ни лента. Сейчас такая ровно одна — /subscribed/. Значок ей
      // при этом положен, и его требует brand-icons: вкладку человек видит.
      const pages = allPages().filter((p) => !/name="robots"[^>]*noindex/.test(p.html))
      const relative = pages.filter((p) => !p.html.includes(OG)).map((p) => p.rel)
      if (relative.length) {
        detail.push(`og:image не абсолютный на ${relative.length} страницах: ${preview(relative, 6)}`)
      }

      const ok = detail.length === 0
      if (ok) detail.push(`og:image абсолютный на всех ${pages.length} индексируемых страницах, файл 1200×630`)
      return {
        id: 'brand-og',
        group: 'Brand',
        ok,
        headline: ok ? 'превью 1200×630 на месте' : `расхождений: ${detail.length}`,
        detail,
      }
    },
  },

  {
    id: 'subs-affiliate-placement',
    group: 'subs',
    title: 'Партнёрская карточка на каждой странице вещества, кнопка на свою SDS — где она есть',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-affiliate-placement', slugs)
      if (miss) return miss

      // ⚠⚠⚠ ИНВАРИАНТ ПЕРЕПИСАН В session 38 ВСЛЕД ЗА ПРАВИЛОМ, а не выключен.
      // Было (s37): «ровно одно из двух — кнопка на нашу SDS ЛИБО карточка
      // партнёра», потому что карточка стояла только там, где своей SDS нет.
      // Стало (решение Сергея, s38): карточка стоит на ВСЕХ 3 650 страницах и
      // высоко, сразу после классификации. Кнопка в герое ведёт на наш разбор
      // опубликованных данных, карточка отвечает на другой вопрос — где взять
      // лист на конкретный продукт конкретного поставщика.
      //
      // ⚠⚠ Отсюда две ОТДЕЛЬНЫЕ проверки вместо одной «либо-либо»:
      //   1) карточка обязана быть ВЕЗДЕ — ноль страниц без неё;
      //   2) кнопка на свою SDS — ровно на том множестве, что даёт база.
      // Второе важнее, чем кажется: пересечение по CAS раньше держалось самим
      // условием `{!sdsSlug && …}`, а теперь его не держит ничто, кроме этой
      // строки. Слетит sdsByCas — читатель на странице ацетона не узнает, что
      // у нас есть своя SDS.
      //
      // ⚠ Маркеры по правилу 1. `href="/sds/` в чистом виде не годится: подвал
      // кладёт ссылку на хаб /sds/ на КАЖДУЮ страницу сайта.
      const OWN = '<a class="hub-hero-cta" href="/sds/'
      const CARD = 'fp_sid=subspage'
      assertAscii('subs-affiliate-placement', [OWN, CARD])

      // ⚠ Ожидание кнопки строится СВОИМ запросом, а не чтением разметки:
      // live-страница SDS с CAS, попавшим в справочник, обязана дать кнопку.
      const sdsRows = await selectAll<{ slug: string; cas_number: string | null; status: string }>(
        'sds_pages',
        'slug, cas_number, status',
      )
      assertNonEmpty('subs-affiliate-placement', 'sds_pages', sdsRows)
      const liveSdsCas = new Set(
        sdsRows.filter((r) => r.status === 'live' && r.cas_number).map((r) => r.cas_number as string),
      )

      const noCard: string[] = []
      const ownWrong: string[] = []
      let own = 0
      let card = 0
      for (const slug of slugs!) {
        const html = readPage(join('substances', slug, 'index.html'))
        if (html === null) {
          noCard.push(`${slug} (файла нет)`)
          continue
        }
        const hasOwn = html.includes(OWN)
        const hasCard = html.includes(CARD)
        if (hasOwn) own++
        if (hasCard) card++
        if (!hasCard) noCard.push(slug)

        const cas = casFromSlug(slug)
        const expectOwn = Boolean(cas && liveSdsCas.has(cas))
        if (hasOwn !== expectOwn) {
          ownWrong.push(`${slug}: кнопка ${hasOwn ? 'есть' : 'нет'}, база ждёт ${expectOwn ? 'есть' : 'нет'}`)
        }
      }

      const detail: string[] = []
      if (noCard.length) {
        detail.push(
          `нет карточки партнёра (${noCard.length}): ${preview(noCard)}. ` +
            'Карточка обязана стоять на каждой странице вещества — решение session 38.',
        )
      }
      if (ownWrong.length) {
        detail.push(
          `кнопка на свою SDS не там, где её ждёт база (${ownWrong.length}): ${preview(ownWrong)}. ` +
            'Разошлись sdsByCas в getStaticPaths и live-страницы в sds_pages.',
        )
      }
      const ok = detail.length === 0
      if (ok) {
        detail.push(`маркеры: "${OWN}…" и "${CARD}"`)
        detail.push('разметку ссылки (rel, дисклоуз, fpr) держат проверки группы Affiliate')
      }
      return {
        id: 'subs-affiliate-placement',
        group: 'subs',
        ok,
        headline: ok
          ? `карточка на всех ${card} страницах, кнопка на свою SDS — на ${own}, как в базе`
          : `расхождений: ${detail.length}`,
        detail,
      }
    },
  },

  {
    id: 'subs-p-cards',
    group: 'subs',
    title: 'P-фразы показаны карточками с текстом, по одной на каждый код из базы',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-p-cards', slugs)
      if (miss) return miss

      // ⚠⚠ Источник ожидания — база, а не разметка. Проверка отвечает на вопрос
      // «все ли коды вещества доехали до карточек», и ответить на него, считая
      // карточки, нельзя: страница, потерявшая половину кодов, тоже даст
      // непустой список. До session 38 коды печатались строкой без текста, и
      // ровно поэтому пропажу одного из них было нечем заметить.
      const rows = await selectAll<{ cas_number: string; p_statement_codes: string[] | null }>(
        'substances',
        'cas_number, p_statement_codes',
        (q: any) => q.not('cas_number', 'is', null),
      )
      assertNonEmpty('subs-p-cards', 'substances', rows)
      const pRows = await selectAll<{ code: string }>('p_statements', 'code')
      assertNonEmpty('subs-p-cards', 'p_statements', pRows)
      const known = new Set(pRows.map((p) => p.code))

      const expectedByCas = new Map<string, number>()
      for (const r of rows) {
        if (!r.cas_number || !/^\d{2,7}-\d{2}-\d$/.test(r.cas_number)) continue
        const codes = [...new Set(r.p_statement_codes ?? [])].filter((c) => known.has(c))
        expectedByCas.set(r.cas_number, codes.length)
      }

      // ⚠ Маркер по правилу 1: такую строку производит только разметка карточки
      // в секции precautions. Ссылка на код в другом виде (`href="/p-statements/`
      // без класса) стоит и в подвале, и в тексте — она бы всё сломала.
      const CARD = '<a class="sub-pcard" href="/p-statements/'
      // ⚠ Старая разметка. Если она где-то осталась — значит правку не докатили,
      // и на этой странице коды по-прежнему без текста.
      const OLD = 'Precautionary statements:'
      assertAscii('subs-p-cards', [CARD, OLD])

      const wrongCount: string[] = []
      const leftovers: string[] = []
      const emptyText: string[] = []
      let cards = 0
      let pages = 0
      for (const slug of slugs!) {
        const html = readPage(join('substances', slug, 'index.html'))
        if (html === null) continue
        const cas = casFromSlug(slug)
        const expect = cas ? expectedByCas.get(cas) : undefined
        if (expect === undefined) continue
        const got = countOccurrences(html, CARD)
        cards += got
        if (got) pages++
        if (got !== expect) wrongCount.push(`${slug}: карточек ${got}, кодов в базе ${expect}`)
        if (html.includes(OLD)) leftovers.push(slug)
        // Карточка без формулировки — это тот же голый код, только в рамке.
        if (got && !html.includes('<span class="sub-pcard-text">')) emptyText.push(slug)
      }

      const detail: string[] = []
      if (wrongCount.length) detail.push(`число карточек не равно числу кодов (${wrongCount.length}): ${preview(wrongCount)}`)
      if (leftovers.length) {
        detail.push(
          `осталась старая строка "${OLD}" (${leftovers.length}): ${preview(leftovers)}. ` +
            'Это разметка до session 38 — коды без текста.',
        )
      }
      if (emptyText.length) detail.push(`карточки без текста фразы (${emptyText.length}): ${preview(emptyText)}`)

      const ok = detail.length === 0
      return {
        id: 'subs-p-cards',
        group: 'subs',
        ok,
        headline: ok ? `${cards} карточек P-фраз на ${pages} страницах, счёт сошёлся с базой` : `расхождений: ${detail.length}`,
        detail: ok ? [`маркер: "${CARD}…", ожидание из substances.p_statement_codes ∩ p_statements`] : detail,
      }
    },
  },

  {
    id: 'subs-hazard-class',
    group: 'subs',
    title: 'Таблица класса опасности стоит там и только там, где H-код разложился по mapping',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-hazard-class', slugs)
      if (miss) return miss

      // ⚠⚠ Независимый источник (урок session 34): ожидание строится ПРЯМЫМ
      // запросом к hazard_category_mapping, а не вызовом buildHazardClasses.
      // Импортировать проверяемую функцию в проверку значит проверять, что она
      // равна себе. Правило: у 9 суффиксных кодов (H350i, H360Fd…) строки в
      // mapping нет вовсе, и страница с ОДНИМ только таким кодом обязана
      // остаться без таблицы.
      const rows = await selectAll<{ cas_number: string; h_statement_codes: string[] | null }>(
        'substances',
        'cas_number, h_statement_codes',
        (q: any) => q.not('cas_number', 'is', null),
      )
      assertNonEmpty('subs-hazard-class', 'substances', rows)
      const mapRows = await selectAll<{ h_statement_code: string | null }>(
        'hazard_category_mapping',
        'h_statement_code',
      )
      assertNonEmpty('subs-hazard-class', 'hazard_category_mapping', mapRows)
      const mapped = new Set(mapRows.map((m) => m.h_statement_code).filter((c): c is string => Boolean(c)))

      const expectByCas = new Map<string, boolean>()
      for (const r of rows) {
        if (!r.cas_number || !/^\d{2,7}-\d{2}-\d$/.test(r.cas_number)) continue
        expectByCas.set(r.cas_number, (r.h_statement_codes ?? []).some((c) => mapped.has(c)))
      }

      const TABLE = '<table class="hub-table sub-class">'
      assertAscii('subs-hazard-class', [TABLE])

      const shouldNot: string[] = []
      const shouldHave: string[] = []
      let withTable = 0
      for (const slug of slugs!) {
        const html = readPage(join('substances', slug, 'index.html'))
        if (html === null) continue
        const cas = casFromSlug(slug)
        const expect = cas ? expectByCas.get(cas) : undefined
        if (expect === undefined) continue
        const has = html.includes(TABLE)
        if (has) withTable++
        if (has && !expect) shouldNot.push(slug)
        if (!has && expect) shouldHave.push(slug)
      }

      const detail: string[] = []
      if (shouldHave.length) detail.push(`таблицы нет, а H-код разложился (${shouldHave.length}): ${preview(shouldHave)}`)
      if (shouldNot.length) {
        detail.push(
          `таблица есть, а раскладывать нечего (${shouldNot.length}): ${preview(shouldNot)}. ` +
            'Либо в mapping появились строки, либо страница печатает пустую таблицу.',
        )
      }
      const ok = detail.length === 0
      return {
        id: 'subs-hazard-class',
        group: 'subs',
        ok,
        headline: ok ? `${withTable} страниц с таблицей класса и категории` : `расхождений: ${detail.length}`,
        detail: ok
          ? [`маркер: "${TABLE}"`, `кодов с раскладкой в mapping: ${mapped.size}`]
          : detail,
      }
    },
  },

  {
    id: 'subs-reactive-group',
    group: 'subs',
    title: 'Реактивная группа CAMEO показана ТОЛЬКО для курируемых записей',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-reactive-group', slugs)
      if (miss) return miss

      // ⚠⚠⚠ САМАЯ ВАЖНАЯ ИЗ ТРЁХ. Замер session 38: в
      // substance_reactive_group_link 1 085 веществ, но курируемых из них 98.
      // Остальные 987 — старый импорт объединением по CAS, тот самый дефект B
      // из claude/cameo-cas-collisions.md: у метанола лишняя группа от записи
      // METHANOL, TALLOW ALKYL IMINOBISETHANOL, у едкого натра — «Water and
      // Aqueous Solutions» от его раствора.
      //
      // Если фильтр по source_ref когда-нибудь отвалится, страница молча начнёт
      // печатать «NaOH несовместим с водой». Ошибка не уронит ни сборку, ни
      // вёрстку, и заметить её будет нечем — кроме этой проверки.
      const CURATED = 'CAMEO Chemicals 3.1.0 - curated record via substance_cameo_choice (session 33)'
      const links = await selectAll<{ cas_number: string; source_ref: string }>(
        'substance_reactive_group_link',
        'cas_number, source_ref',
      )
      assertNonEmpty('subs-reactive-group', 'substance_reactive_group_link', links)
      const curatedCas = new Set(links.filter((l) => l.source_ref === CURATED).map((l) => l.cas_number))
      const anyCas = new Set(links.map((l) => l.cas_number))

      const BLOCK = 'id="reactive-group"'
      assertAscii('subs-reactive-group', [BLOCK])

      const uncurated: string[] = []
      const missingBlock: string[] = []
      let shown = 0
      for (const slug of slugs!) {
        const html = readPage(join('substances', slug, 'index.html'))
        if (html === null) continue
        const cas = casFromSlug(slug)
        if (!cas) continue
        const has = html.includes(BLOCK)
        if (has) shown++
        if (has && !curatedCas.has(cas)) {
          uncurated.push(anyCas.has(cas) ? `${slug} (есть группы, но НЕ курируемые)` : `${slug} (групп в базе нет вовсе)`)
        }
        if (!has && curatedCas.has(cas)) missingBlock.push(slug)
      }

      const detail: string[] = []
      if (uncurated.length) {
        detail.push(
          `блок стоит на НЕкурируемой записи (${uncurated.length}): ${preview(uncurated)}. ` +
            'Отвалился фильтр по source_ref в getStaticPaths — вернуть, а не гасить проверку.',
        )
      }
      if (missingBlock.length) detail.push(`курируемая запись есть, а блока нет (${missingBlock.length}): ${preview(missingBlock)}`)

      const ok = detail.length === 0
      return {
        id: 'subs-reactive-group',
        group: 'subs',
        ok,
        headline: ok
          ? `${shown} страниц с реактивной группой (курируемых записей ${curatedCas.size} из ${anyCas.size})`
          : `расхождений: ${detail.length}`,
        detail: ok
          ? [
              `маркер: ${BLOCK}`,
              `⚠ некурируемых записей в таблице: ${anyCas.size - curatedCas.size} — матрица совместимости считает и по ним`,
            ]
          : detail,
      }
    },
  },

  {
    id: 'subs-faq',
    group: 'subs',
    title: 'Разметка FAQPage обещает поиску ровно те вопросы, что видны на странице',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-faq', slugs)
      if (miss) return miss

      // ⚠⚠ Разметка, обещающая ответ, которого на странице нет, — это то, за что
      // Google снимает расширенный сниппет. Проверяем не «есть ли JSON-LD», а
      // равенство двух счётчиков: вопросов в разметке и блоков в теле.
      // ⚠ Оба маркера ASCII и производятся только своей разметкой: "@type":"FAQPage"
      // ставит ld() на странице вещества, sub-faq-item — только тело блока.
      const FAQ_TYPE = '"@type":"FAQPage"'
      const QUESTION = '"@type":"Question"'
      const ITEM = '<div class="sub-faq-item">'
      assertAscii('subs-faq', [FAQ_TYPE, QUESTION, ITEM])

      const noFaq: string[] = []
      const mismatch: string[] = []
      let questions = 0
      let pages = 0
      for (const slug of slugs!) {
        const html = readPage(join('substances', slug, 'index.html'))
        if (html === null) continue
        const hasLd = html.includes(FAQ_TYPE)
        const items = countOccurrences(html, ITEM)
        if (!hasLd && items === 0) {
          // ⚠ CAS есть у каждой страницы, поэтому первый вопрос строится всегда.
          // Ноль блоков — значит блок не собрался, а не «данных не хватило».
          noFaq.push(slug)
          continue
        }
        pages++
        const qs = countOccurrences(html, QUESTION)
        questions += qs
        if (qs !== items) mismatch.push(`${slug}: в разметке ${qs}, на странице ${items}`)
      }

      const detail: string[] = []
      if (noFaq.length) detail.push(`ни разметки, ни блока FAQ (${noFaq.length}): ${preview(noFaq)}`)
      if (mismatch.length) detail.push(`разметка и тело разошлись (${mismatch.length}): ${preview(mismatch)}`)

      const ok = detail.length === 0
      return {
        id: 'subs-faq',
        group: 'subs',
        ok,
        headline: ok ? `${questions} вопросов на ${pages} страницах, разметка совпала с телом` : `расхождений: ${detail.length}`,
        detail: ok ? [`маркеры: ${FAQ_TYPE}, ${QUESTION}, ${ITEM}`] : detail,
      }
    },
  },

  {
    id: 'subs-deeplink-params',
    group: 'subs',
    title: 'Имя параметра в ссылке на инструмент совпадает с тем, что инструмент читает',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-deeplink-params', slugs)
      if (miss) return miss

      // ⚠⚠⚠ ЗАЧЕМ ЭТА ПРОВЕРКА. Со страницы вещества калькулятор ATE открывался
      // ПУСТЫМ на всех 3 650 страницах: ссылка вела `?cas=`, а остров читает
      // `?substance=`. Ссылка была на живую страницу, синтаксис безупречен,
      // сборка и 83 проверки зелёные — поймал это Сергей глазами (session 38).
      //
      // ⚠⚠ Имя параметра — контракт между .astro и .tsx, и его не проверяет
      // никто: ни TypeScript (строка в строке), ни links-broken (страница
      // существует), ни один инвариант разметки. Три инструмента читают три
      // разных имени, и совпадения между ними нет.
      //
      // ⚠⚠ Бандл ищется по `component-url` на САМОЙ странице инструмента, а не
      // по угаданному имени файла. Первая версия проверки искала
      // `AteMixtureCalculator.*.js` в списке assetFiles() и падала на всех трёх:
      // там имена лежат с префиксом `_astro/`. Разметка знает адрес своего
      // острова точно — у неё и надо спрашивать. Так же устроена storage-tool.
      const LINKS = [
        { path: '/tools/ate-mixture-calculator/', param: 'substance', page: 'tools/ate-mixture-calculator/index.html', island: 'AteMixtureCalculator' },
        { path: '/tools/chemical-storage-compatibility/', param: 'substance', page: 'tools/chemical-storage-compatibility/index.html', island: 'StorageTool' },
        { path: '/label-constructor/', param: 'cas', page: 'label-constructor/index.html', island: 'LabelConstructorLoader' },
      ]

      const detail: string[] = []
      const seen: string[] = []

      for (const link of LINKS) {
        // ── а) какое имя мы РЕАЛЬНО печатаем на страницах вещества ──
        const re = new RegExp(`href="${link.path.replace(/\//g, '\\/')}\\?([a-zA-Z_]+)=`, 'g')
        const used = new Set<string>()
        let pagesWith = 0
        for (const slug of slugs!) {
          const html = readPage(join('substances', slug, 'index.html'))
          if (html === null) continue
          const found = [...html.matchAll(re)].map((m) => m[1])
          if (found.length) pagesWith++
          for (const p of found) used.add(p)
        }

        if (!pagesWith) {
          detail.push(`ни одной ссылки на ${link.path} со страниц веществ — блок пропал из разметки`)
          continue
        }
        if (used.size !== 1 || !used.has(link.param)) {
          detail.push(
            `${link.path}: на страницах стоит ?${[...used].join('/')}=, а остров читает ?${link.param}= ` +
              `(${pagesWith} страниц). Инструмент откроется пустым.`,
          )
          continue
        }

        // ── б) а читает ли остров это имя НА САМОМ ДЕЛЕ ──
        // ⚠ Строковый литерал `get("substance")` переживает минификацию, поэтому
        // читать бандл можно текстом. Источник независим от нашего ожидания.
        const toolHtml = readPage(link.page)
        if (toolHtml === null) {
          detail.push(`нет ${link.page} — страница инструмента не собралась`)
          continue
        }
        const m = toolHtml.match(new RegExp(`component-url="(/_astro/${link.island}\\.[A-Za-z0-9_-]+\\.js)"`))
        if (!m) {
          detail.push(
            `на ${link.page} нет component-url острова ${link.island}. ` +
              'Поправить карту LINKS в проверке, а не выключать проверку: без второй половины ' +
              'она сверяет наше ожидание с нашим же ожиданием.',
          )
          continue
        }
        const entry = m[1].replace(/^\//, '')
        const entryText = existsSync(join(DIST, entry)) ? readFileSync(join(DIST, entry), 'utf8') : null
        if (entryText === null) {
          detail.push(`${entry} объявлен в разметке, но файла в dist нет`)
          continue
        }
        const needle = (t: string) => t.includes(`get("${link.param}")`) || t.includes(`get('${link.param}')`)

        let where: string | null = null
        if (needle(entryText)) {
          where = entry
        } else {
          // ⚠ Rollup может вынести чтение в общий чанк. Это законно, поэтому
          // ищем шире — но ГДЕ нашли, печатаем: расширение поиска ослабляет
          // точность, и молчать об этом нельзя.
          const other = assetFiles().find((f) => needle(f.text))
          if (other) where = `${other.name} (общий чанк, не входной)`
        }
        if (!where) {
          detail.push(
            `${link.island} не читает ?${link.param}= — литерала get("${link.param}") нет ни в ${entry}, ни в одном _astro/*.js`,
          )
          continue
        }
        seen.push(`${link.path}?${link.param}= → ${where} (${pagesWith} страниц)`)
      }

      const ok = detail.length === 0
      return {
        id: 'subs-deeplink-params',
        group: 'subs',
        ok,
        headline: ok ? `${seen.length} глубокие ссылки сошлись с тем, что читают острова` : `расхождений: ${detail.length}`,
        detail: ok ? seen : detail,
      }
    },
  },
]

// ─────────────────────────── прогон ───────────────────────────

async function main(): Promise<void> {
  const selected = ONLY
    ? CHECKS.filter((c) => c.group.toLowerCase() === ONLY.toLowerCase() || c.id.includes(ONLY))
    : CHECKS

  if (!selected.length) {
    console.error(`Под --only ${ONLY} ничего не подошло. Группы: ${[...new Set(CHECKS.map((c) => c.group))].join(', ')}`)
    process.exit(1)
  }

  console.log('')
  console.log('GHS dist check')
  console.log(`  dist:  ${DIST}`)
  console.log(`  база:  ${supabaseUrl}`)
  console.log(`  когда: ${new Date().toISOString()}`)
  console.log('')

  const results: Result[] = []
  let group = ''

  for (const check of selected) {
    if (check.group !== group) {
      group = check.group
      console.log(`${group}`)
    }
    let r: Result
    try {
      r = await check.run()
    } catch (e) {
      r = { id: check.id, group: check.group, ok: false, headline: `проверка упала: ${String(e)}`, detail: [] }
    }
    results.push(r)
    console.log(`  [${r.ok ? ' OK ' : 'FAIL'}] ${check.title}`)
    console.log(`         ${r.headline}`)
    for (const line of r.detail) console.log(`         ${line}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log('')
  if (failed.length === 0) {
    console.log(`Итог: ${results.length} проверок, все сошлись с базой. Можно деплоить.`)
    process.exit(0)
  }
  console.log(`Итог: ${results.length - failed.length} из ${results.length} сошлись, провалено ${failed.length}:`)
  for (const f of failed) console.log(`  - ${f.id}: ${f.headline}`)
  console.log('')
  console.log('Деплоить НЕ надо, пока не сойдётся. Если расхождение ожидаемое —')
  console.log('значит база менялась после сборки: пересобрать (npm run build) и прогнать снова.')
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
