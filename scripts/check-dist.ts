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
import { EU_LANGUAGES } from '../src/lib/euLanguages'
import { SDS_SECTIONS } from '../src/lib/sdsSections'
import { hSlug } from '../src/lib/hStatementSlug'
// ⚠ Правило имени и правило адреса берём из тех же файлов, по которым
// строится страница. Списать их сюда — значит завести вторую копию,
// которая разойдётся молча (так уже вышло у pictogramCasPaths.ts).
import { substanceNameFull, NAME_COLUMNS } from '../src/lib/substanceName'
// ⚠⚠ Разбор записи Annex VI берётся ИЗ ТОГО ЖЕ модуля, что стоит на этикетке.
// Списать правило формы сюда — значит завести вторую копию, которая разойдётся
// с первой молча, и проверка начнёт подтверждать не то, что печатается.
import { productNameVariants, defaultLabelIdentifiers } from '../src/lib/labelProductName'
// ⚠⚠ Блок имён по языковым редакциям собирается ТЕМ ЖЕ кодом, что и на странице.
// ⚠ Импорт идёт из `nameForms`, а НЕ из `labelNameForms`: второй тянет
// `src/lib/supabase.ts`, а тот на верхнем уровне читает `import.meta.env` и под
// tsx падает. Ради этого модуль и разделён (session 56).
import {
  buildOfficialNames, NAME_TRANSLATION_COLUMNS, type NameTranslationRow,
} from '../src/lib/nameForms'
// ⚠⚠ Что движок УМЕЕТ считать, берётся из самого движка, а не из головы автора
// проверки. Витрина на главной обещает классы; список обещаний обязан сверяться
// с реестром модулей, иначе он стареет молча — ровно так строка «Aspiration
// hazard · not computed» пережила заход A4-2 и осталась бы неправдой (s83).
import { acuteToxModule } from '../src/lib/classifier/modules/acuteTox'
import { CUTOFF_PLANS } from '../src/lib/classifier/modules/cutoff'
import {
  erratumFor, erratumLanguages, erratumCitation,
  ERRATA_INDEX_NUMBERS, ERRATA_COUNT, ERRATA_TABLE_NOTE,
} from '../src/lib/annex6Errata'
import { casShapeOk, ecShapeOk, indexShapeOk } from '../src/lib/substanceIdentifiers'
import { substanceSlug, casFromSlug } from '../src/lib/substanceSlug'
// ⚠⚠ Раскладка «код знака → файл» берётся ИЗ ТОГО ЖЕ модуля, что и страница.
// Списать сюда список кодов — значит завести вторую копию словаря, которая
// разойдётся молча. Ровно на этом уже спотыкались: список «19 знаков» из
// передачи сессии 39 был выписан руками и потерял код 8 — 1 218 строк, третий
// по частоте во всей базе (claude/adr-placard-set-session40.md).
import { adrLabels, dotLabels } from '../src/lib/transportLabels'
// ⚠ Те же обёртки, что стоят на сборке: проверка обязана падать на отказе запроса,
// а не считать пустой ответ фактом о данных. И тот же ограничитель параллелизма —
// иначе сотня одновременных RPC утопит пулер, и проверка начнёт врать (session 32).
import { must, mapLimit } from '../src/lib/mustQuery'
// ⚠⚠ Разбор адресов конструктора берётся ТЕМ ЖЕ файлом, который их и строит.
// Проверка, знающая имена параметров по своему списку, сверяла бы наше ожидание
// с нашим же ожиданием — ровно так и прожил дефект session 38.
import {
  labelMakerHrefProblems, LABEL_MAKER_BASE, LM_PARAM, pickHrefFor, readReturnBase,
} from '../src/lib/labelMakerLink'
import { BRANCHES, TEMPLATES, LABEL_MAKER_PATHS } from '../src/lib/labelMakerHub'
// ⚠⚠ Таблица составных записей берётся ИЗ ТОГО ЖЕ файла, которым разбирается
// ячейка Annex VI. Выписать список номеров сюда — значит завести вторую копию,
// которая разойдётся с разбором молча, и проверка начнёт подтверждать не то,
// что лежит в базе.
import { COMPOSITE_HEAD } from './clp-name-annotations.mjs'
// ⚠ Подписи состояния — оттуда же, откуда свидетельства (импорт выше):
// страница печатает ровно эту строку, и проверка ищет ровно её.
import { erratumStatus, erratumStatusLabel } from '../src/lib/annex6Errata'
import { matrixToMappingCategories } from '../src/lib/matrixCategoryBridge'
// ⚠ Ошибки регламента ВНУТРИ строки (код H-фразы ≠ классу) — тот же модуль,
// что печатает пометку под таблицей H-фраз. Второго списка нет и не будет.
import {
  rowErratumFor, rowErratumCitation, ROW_ERRATUM_LEAD,
  ROW_ERRATA_INDEX_NUMBERS, ROW_ERRATA_COUNT, ROW_ERRATA_TABLE_NOTE,
} from '../src/lib/annex6RowErrata'

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

/**
 * ⭐⭐ СТРАНИЦЫ РАЗДЕЛА, КОТОРЫЕ НЕ ЯВЛЯЮТСЯ КОДАМИ ФРАЗ.
 *
 * До session 65 всё, что лежало под `/p-statements/` и `/h-statements/`, было
 * страницей кода, и проверка `p-pages` сравнивала набор папок с реестром базы
 * напрямую. Появился инструмент `/p-statements/selector/` — и проверка честно
 * покраснела: «лишние в dist (1): selector».
 *
 * ⚠⚠ СПИСОК ПОИМЁННЫЙ, А НЕ ПРАВИЛО ВРОДЕ «слаг не похож на код».
 * Соблазн написать `!/^P\d+/.test(slug)` велик и опасен: такое правило заодно
 * пропустит страницу кода, чьё имя собралось неверно, — то есть ровно тот
 * дефект, ради которого проверка и заведена. Исключение обязано быть решением
 * человека, записанным по имени, а не побочным следствием регулярки.
 *
 * ⚠ Добавляя сюда строку, проверь ДВЕ вещи: страница попала в sitemap
 * (`p-sitemap` / `h-sitemap`) и на ней есть партнёрская карточка со СВОИМ
 * `fp_sid` (см. `SINGLES` в `affiliate-placement`).
 */
const NON_CODE_PAGES: Record<string, string[]> = {
  'p-statements': ['selector'],
  'h-statements': [],
}

/** Слаги раздела фраз без страниц-инструментов. */
function codeSlugs(relDir: string): string[] {
  const skip = new Set(NON_CODE_PAGES[relDir] ?? [])
  return pageSlugs(relDir).filter((s) => !skip.has(s))
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

let styleCache: string[] | null = null

/**
 * Содержимое каждого dist/_astro/*.css отдельной строкой.
 *
 * ⚠ Читаем СОБРАННЫЙ css, а не src/styles/hub.css. Правило, которое есть в
 * исходнике и не доехало до бандла, — ровно тот отказ, который надо ловить.
 * По той же причине в маркерах нет пробелов: `@media (max-width: 720px)`
 * в бандле выглядит как `@media (max-width:720px)`.
 *
 * ⚠⚠ Файлы держим ПОРОЗНЬ, а не склеиваем. Склейка ломает поиск медиазапроса:
 * правило вне всякого `@media` в начале второго файла отмоталось бы назад до
 * последнего `@media` первого — и проверка уверенно назвала бы чужую ширину.
 */
function styleFiles(): string[] {
  if (styleCache !== null) return styleCache
  const abs = join(DIST, '_astro')
  //
  // ⚠ Пробелы приводятся к одному виду. Искать в css сырой подстрокой нельзя:
  // минификатор пишет `.hub-table thead{display:none}`, а несжатая сборка —
  // `.hub-table thead { display: none; }`. Проверка, завязанная на один из
  // двух видов, покраснеет от смены флага сборки, а не от дефекта.
  // ⚠ Последняя точка с запятой перед `}` убирается: несжатая сборка пишет
  // `{display:none;}`, минифицированная — `{display:none}`.
  //
  // ⚠⚠ И ГЛАВНОЕ: `:before` приводится к `::before`. Lightning CSS (он стоит
  // в сборке через Tailwind v4) переписывает двойное двоеточие в одинарное —
  // проверено на targets ie11, chrome 60 и вовсе без targets, во всех трёх
  // случаях на выходе `.unt-class:before`. Первая версия этой проверки искала
  // `::before` буквально и объявила «нет подписи» у всех девятнадцати классов,
  // хотя правила были на месте. Урок общий: **в собранном css искать надо по
  // приведённому виду, а не по тому, как написано в исходнике.**
  const tidy = (css: string) =>
    css
      .replace(/\s+/g, ' ')
      .replace(/\s*([{}:;,])\s*/g, '$1')
      .replace(/;}/g, '}')
      .replace(/(?<!:):(before|after)\b/g, '::$1')
  styleCache = !existsSync(abs)
    ? []
    : readdirSync(abs)
        .filter((f) => f.endsWith('.css'))
        .map((f) => tidy(readFileSync(join(abs, f), 'utf8')))
  return styleCache
}

/** Есть ли подстрока хоть в одном собранном css. */
function styleHas(needle: string): boolean {
  return styleFiles().some((css) => css.includes(needle))
}

/**
 * Ширина медиазапроса, внутри которого лежит правило: ищем правило, отматываем
 * назад до ближайшего `@media` в ТОМ ЖЕ файле и читаем из него max-width.
 * null — правила нет нигде; 0 — правило есть, но вне медиазапроса.
 */
function mediaWidthOf(needle: string): number | null {
  for (const css of styleFiles()) {
    const at = css.indexOf(needle)
    if (at < 0) continue
    const m = css.lastIndexOf('@media', at)
    if (m < 0) return 0
    // ⚠ Два написания одного и того же. Lightning CSS без targets выдаёт
    // современный диапазонный синтаксис `(width<=720px)` вместо
    // `(max-width:720px)`. Понимать надо оба: иначе проверка при смене
    // browserslist решит, что правило лежит вне медиазапроса.
    const cond = css.slice(m, m + 120)
    const w = /max-width:\s*(\d+)px/.exec(cond) ?? /width\s*<=\s*(\d+)px/.exec(cond)
    return w ? Number(w[1]) : 0
  }
  return null
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
    // ⚠ Astro печатает амперсанд в атрибуте числовой ссылкой, а не `&amp;`.
    // Без этих двух строк адрес `?h=H226&pic=GHS02` разбирался как ОДИН
    // параметр с именем `h` и значением `H226&#38;pic=GHS02`.
    .replace(/&#38;/g, '&')
    .replace(/&#x26;/gi, '&')
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
  /** ⚠ Ключ к `substance_name_translations`: связь идёт по индексному номеру, не по CAS. */
  index_number: string | null
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
    `cas_number, index_number, ${NAME_COLUMNS}`,
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

/**
 * Вся таблица `substance_name_translations` — одним чтением на все проверки.
 *
 * ⚠⚠ ЧИТАЕТСЯ ПО КЛЮЧУ, А НЕ ЧЕРЕЗ OFFSET, И ЭТО ЗАМЕР, А НЕ ВКУСОВЩИНА.
 * `selectAll` листает через `range()`, то есть `LIMIT … OFFSET …`. Postgres на
 * каждой странице проходит все предыдущие записи индекса заново, и на 101 654
 * строках последние страницы упираются в `statement_timeout` роли `anon` (3 с,
 * замер session 47). Замер 2026-08-09, EXPLAIN ANALYZE на живой базе:
 *
 *   ORDER BY … LIMIT 1000 OFFSET 100000   → 4 152 мс, 99 655 буферов
 *   WHERE index_number >= … LIMIT 1000    →     2,6 мс,  1 008 буферов
 *
 * ⚠⚠ Провал был МОЛЧАЛИВЫМ по смыслу: `check:dist` сказал «проверка упала:
 * canceling statement due to statement timeout», то есть отказ чтения, а не
 * факт о данных. Ровно поэтому `selectAll` бросает исключение вместо того,
 * чтобы вернуть половину таблицы, — половина прочиталась бы как «остальных
 * записей в базе нет».
 *
 * ⭐ Ключ курсора — `index_number`, и он же первый столбец первичного ключа
 * `(index_number, lang)`, поэтому чтение идёт по индексу и стоит одинаково на
 * любой странице.
 * ⚠ Курсор двигается через `gte`, а не `gt`: страница в тысячу строк почти
 * всегда обрывается ПОСРЕДИ записи (у записи до 23 языков), и `gt` потерял бы
 * её хвост. Повторы отсеиваются по ключу `(index_number, lang)`.
 *
 * ⚠⚠ ПОРЯДОК ТОЖЕ ОБЯЗАТЕЛЕН, И ПО ДРУГОЙ ПРИЧИНЕ. Без ORDER BY Postgres не
 * обязан отдавать страницы в одном и том же порядке: физический порядок строк
 * меняется после записи, и соседние страницы начинают перекрываться. Часть
 * строк ПРОПАДАЕТ из выборки, часть приходит ДВАЖДЫ. Поймано на первом же
 * прогоне проверки substance-name-composite, сразу после пересчёта 4 527 строк:
 * она сказала «записей таблицы нет в базе вовсе: 9» у таблицы, ВЫВЕДЕННОЙ ИЗ
 * ЭТОЙ ЖЕ БАЗЫ. Здесь порядок нужен ещё и затем, чтобы курсор был осмыслен.
 *
 * ⚠ Кэш здесь не ради скорости, а ради одинаковости: две проверки, читающие
 * 101 654 строки порознь, могут увидеть разное состояние базы и разойтись в
 * выводах на ровном месте.
 */
let nameTranslationLoad: Promise<NameTranslationRow[]> | null = null

async function loadNameTranslations(): Promise<NameTranslationRow[]> {
  const PAGE = 1000
  const out: NameTranslationRow[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  for (;;) {
    let q = supabase
      .from('substance_name_translations')
      .select(NAME_TRANSLATION_COLUMNS)
      .order('index_number', { ascending: true })
      .order('lang', { ascending: true })
      .limit(PAGE)
    if (cursor !== null) q = q.gte('index_number', cursor)
    const { data, error } = await q
    if (error) throw new Error(`substance_name_translations: ${error.message}`)
    const rows = (data ?? []) as NameTranslationRow[]
    if (!rows.length) break
    let fresh = 0
    for (const r of rows) {
      const key = `${r.index_number}|${r.lang}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(r)
      fresh++
    }
    if (rows.length < PAGE) break
    // ⚠ Страховка от вечного цикла: страница целиком из повторов означала бы,
    // что у одного индексного номера строк больше, чем размер страницы, — то
    // есть больше 1000 языков. Молчаливое зацикливание хуже громкого отказа.
    if (!fresh) {
      throw new Error(
        `substance_name_translations: страница из ${rows.length} строк не дала ни одной новой ` +
        `на курсоре ${cursor} — у одного индексного номера не может быть столько языков`,
      )
    }
    cursor = rows[rows.length - 1].index_number
  }
  return out
}

function nameTranslations(): Promise<NameTranslationRow[]> {
  if (!nameTranslationLoad) nameTranslationLoad = loadNameTranslations()
  return nameTranslationLoad
}

/** Строки таблицы, разложенные по индексному номеру. Порядок языков сохранён. */
async function nameTranslationsByIndex(): Promise<Map<string, NameTranslationRow[]>> {
  const rows = await nameTranslations()
  const byIndex = new Map<string, NameTranslationRow[]>()
  for (const r of rows) {
    const list = byIndex.get(r.index_number)
    if (list) list.push(r)
    else byIndex.set(r.index_number, [r])
  }
  return byIndex
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
        // ⚠ Окно 320, а не 240: с session 39 номер обёрнут в ссылку на
        // /un/<номер>/, и между подписью и значением прибавилось ~45 знаков
        // (замер на /sds/acetone/: было 120, стало ~165). Узкое окно не
        // покраснело бы — оно просто перестало бы находить карточки, и
        // проверка молча позеленела бы на пустом множестве.
        const cards = rxAll(html, />UN number<[\s\S]{0,320}?>UN (\d{3,4})</g)
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
      const actual = new Set(codeSlugs('p-statements'))
      const { missing, extra } = diffSets(actual, expected)
      const ok = missing.length === 0 && extra.length === 0
      const detail: string[] = []
      if (missing.length) detail.push(`нет в dist (${missing.length}): ${preview(missing)}`)
      if (extra.length) detail.push(`лишние в dist (${extra.length}): ${preview(extra)}`)
      if (ok) detail.push('каждому коду соответствует ровно одна страница')
      // ⚠⚠ ИСКЛЮЧЁННЫЕ ПЕРЕЧИСЛЕНЫ ВСЛУХ, А НЕ ВЫЧТЕНЫ МОЛЧА. Строка «исключено
      // по решению» — это то, что человек обязан перечитать, когда список
      // вырастет: молчаливое исключение через год перестанет быть решением и
      // станет дырой, о которой никто не помнит.
      const skipped = NON_CODE_PAGES['p-statements'] ?? []
      if (skipped.length) {
        detail.push(`исключено по решению (${skipped.length}, страницы-инструменты, не коды): ${skipped.join(', ')}`)
      }
      return {
        id: 'p-pages',
        group: 'P-statements',
        ok,
        headline: `${actual.size} страниц кодов в dist, база ожидает ${expected.size}`,
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

  // ⚠⚠ ТРЕТЬЯ ПРОВЕРКА ГРУППЫ — И ОНА ЗАВЕДЕНА ПОТОМУ, ЧТО ДВУХ ПЕРВЫХ НЕ
  // ХВАТИЛО. Обе они были ЗЕЛЁНЫМИ всё то время, пока 236 страниц не несли ни
  // одной партнёрской ссылки, и это не сбой: `affiliate-marking` спрашивает
  // «размечена ли НАЙДЕННАЯ ссылка», `affiliate-subid` — «есть ли у НАЙДЕННОЙ
  // ссылки fp_sid». Ни та ни другая не может сказать, что искать было негде.
  //
  // ⭐⭐ ПРАВИЛО, КОТОРОЕ ИЗ ЭТОГО СЛЕДУЕТ: рядом с инвариантом «всё найденное
  // правильно» обязан стоять СЧЁТ ПРИСУТСТВИЯ. У страниц веществ он был заведён
  // отдельно (`subs-affiliate-placement`) и потому дыры там не было; у трёх
  // соседних разделов его не было, и дыру нашёл Сергей глазами (session 53).
  //
  // ⚠⚠ ПОРОГА ЗДЕСЬ НЕТ И БЫТЬ НЕ ДОЛЖНО. Ожидание — «на КАЖДОЙ построенной
  // странице раздела», а число берётся из самого dist. Порог, назначенный из
  // головы, был бы вреден: session 52 уже показала, чего стоит «22 вместо 4».
  {
    id: 'affiliate-placement',
    group: 'Affiliate',
    title: 'Партнёрская карточка стоит там, где должна — счёт присутствия по разделам',
    run: async () => {
      // Разделы: у страницы свой subid, у хаба свой. ⚠⚠ `hubSid: null` означает
      // «у хаба раздела карточки нет», и это состояние ВЫВОДИТСЯ ОТДЕЛЬНОЙ
      // строкой, а не молчится: если это пропуск, а не решение, он виден.
      const SECTIONS: { dir: string; pageSid: string; hubSid: string | null }[] = [
        { dir: 'h-statements', pageSid: 'hstat', hubSid: 'hstathub' },
        { dir: 'p-statements', pageSid: 'pstat', hubSid: 'pstathub' },
        { dir: 'ghs', pageSid: 'ghscode', hubSid: null },
        { dir: 'sds-sections', pageSid: 'sdssec', hubSid: 'sdssechub' },
        { dir: 'storage-compatibility', pageSid: 'stclass', hubSid: 'sthub' },
        { dir: 'un', pageSid: 'unpage', hubSid: null },
        { dir: 'sds', pageSid: 'sdspage', hubSid: 'sdshub' },
      ]
      // Одиночные страницы — у них нет «раздела», но карточка на них тоже
      // обязана быть, и потерять её так же легко.
      //
      // ⚠⚠ У СТРАНИЦЫ-ИНСТРУМЕНТА СВОЙ `fp_sid`, А НЕ `fp_sid` ЕЁ РАЗДЕЛА.
      // `/p-statements/selector/` лежит внутри раздела P-фраз, но приходят на
      // неё с другим намерением: читатель кода уже знает, что ищет, а читатель
      // селектора ещё выбирает набор для своей этикетки. Слепить их под одним
      // `pstat` значит потерять именно то различие, ради которого subid и
      // заводится. Поэтому она перечислена ЗДЕСЬ, а из обхода раздела
      // исключена через `NON_CODE_PAGES`.
      const SINGLES: { rel: string; sid: string }[] = [
        { rel: 'tools/ate-mixture-calculator/index.html', sid: 'gpmgmt' },
        { rel: 'tools/chemical-storage-compatibility/index.html', sid: 'sttool' },
        { rel: 'p-statements/selector/index.html', sid: 'pselect' },
        // ⚠ Классификатор смесей (№124, s82). Свой sid, а не `gpmgmt` соседнего
        // ATE: сюда приходят классифицировать состав целиком, а не считать один
        // класс, и путь дальше другой — не «управлять библиотекой SDS», а
        // «вписать полученную классификацию в раздел 2».
        { rel: 'tools/clp-mixture-classifier/index.html', sid: 'gpclass' },
      ]

      const problems: string[] = []
      const notes: string[] = []
      const detail: string[] = []
      let pages = 0

      for (const s of SECTIONS) {
        const marker = `fp_sid=${s.pageSid}`
        assertAscii('affiliate-placement', [marker])
        // ⚠ Страницы-инструменты раздела считаются отдельно, в SINGLES: у них
        // свой subid, и требовать от них subid раздела было бы неверно.
        const slugs = codeSlugs(s.dir)
        if (slugs.length === 0) {
          problems.push(`${s.dir}: в dist нет ни одной страницы раздела`)
          continue
        }
        const missing: string[] = []
        for (const slug of slugs) {
          const html = readPage(join(s.dir, slug, 'index.html'))
          pages++
          if (html === null || !html.includes(marker)) missing.push(`${s.dir}/${slug}`)
        }
        if (missing.length) {
          problems.push(`${s.dir}: ${missing.length} из ${slugs.length} страниц без ${marker} -> ${preview(missing)}`)
        } else {
          detail.push(`${s.dir}: ${slugs.length} страниц, у каждой ${marker}`)
        }

        const hub = readPage(join(s.dir, 'index.html'))
        if (s.hubSid) {
          const hubMarker = `fp_sid=${s.hubSid}`
          assertAscii('affiliate-placement', [hubMarker])
          pages++
          if (hub === null) problems.push(`${s.dir}/: хаба нет в dist, а карточка с ${hubMarker} ожидается`)
          else if (!hub.includes(hubMarker)) problems.push(`${s.dir}/: хаб без ${hubMarker}`)
          else detail.push(`${s.dir}/: хаб несёт ${hubMarker}`)
        } else if (hub !== null) {
          notes.push(`${s.dir}/: хаб построен, партнёрской карточки на нём нет`)
        }
      }

      for (const one of SINGLES) {
        const marker = `fp_sid=${one.sid}`
        assertAscii('affiliate-placement', [marker])
        const html = readPage(one.rel)
        pages++
        if (html === null) problems.push(`${one.rel}: страницы нет в dist`)
        else if (!html.includes(marker)) problems.push(`${one.rel}: нет ${marker}`)
        else detail.push(`${one.rel}: ${marker}`)
      }

      // ⚠ Карточка селектора живёт ВНУТРИ React-острова и в HTML не попадает
      // вовсе — искать её здесь значило бы объявить пропажу там, где всё цело.
      notes.push('карточки внутри React-островов (селектор, ATE) лежат в _astro/*.js — их держит affiliate-subid')

      const ok = problems.length === 0
      return {
        id: 'affiliate-placement',
        group: 'Affiliate',
        ok,
        headline: ok
          ? `${pages} страниц ${SECTIONS.length} разделов — карточка на каждой`
          : `разделов с пропусками: ${problems.length}`,
        detail: ok ? [...detail, ...notes] : [...problems, ...notes],
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

  // ─────────────────────────── Шрифты (session 69, №43) ───────────────────────
  //
  // ⛔⛔ ЗАЧЕМ ЭТА ГРУППА. Пункт №43 в очереди называл ОДИН адрес —
  // `Layout.astro:66`. На деле подключений к шрифтам Google было ПЯТЬ, в трёх
  // семействах: Layout, стандалонная главная, `@import url(…)` внутри
  // `<style is:inline>` у селектора пиктограмм и по одному JetBrains Mono на
  // страницах SDS и калькуляторе ATE. Три из пяти не находились поиском по
  // «link rel=stylesheet», потому что были написаны иначе.
  //
  // ⭐⭐ Поэтому проверка спрашивает не «убрали ли строку из исходника», а
  // «есть ли чужой домен в собранном ВЫВОДЕ» — в html, в css и в js. Копия,
  // которую никто не стережёт, возвращается: это ровно то, что случилось с
  // блоком значков (три копии, группа Brand) и с Table 1.3 (пункт №29).
  {
    id: 'fonts-no-google',
    group: 'Fonts',
    title: 'Ни одного обращения к шрифтам Google в собранном выводе',
    run: async () => {
      const MARKERS = ['fonts.googleapis.com', 'fonts.gstatic.com']
      assertAscii('fonts-no-google', MARKERS)
      const hits: string[] = []
      for (const page of allPages()) {
        for (const m of MARKERS) if (page.html.includes(m)) hits.push(`${page.rel} <- ${m}`)
      }
      // ⚠ CSS обязателен: самая дорогая из пяти форм была `@import url(…)`
      // внутри стиля, а не тегом в <head>.
      styleFiles().forEach((css, i) => {
        for (const m of MARKERS) if (css.includes(m)) hits.push(`_astro css #${i + 1} <- ${m}`)
      })
      for (const a of assetFiles()) {
        for (const m of MARKERS) if (a.text.includes(m)) hits.push(`${a.name} <- ${m}`)
      }
      const ok = hits.length === 0
      return {
        id: 'fonts-no-google',
        group: 'Fonts',
        ok,
        headline: ok
          ? `${allPages().length} страниц, ${styleFiles().length} css, ${assetFiles().length} js — чужого домена нет`
          : `вхождений: ${hits.length}, ожидался 0`,
        detail: ok ? [`проверено: ${MARKERS.join(', ')}`] : hits.slice(0, 20),
      }
    },
  },

  {
    id: 'fonts-files',
    group: 'Fonts',
    title: 'Файлы шрифтов на месте, читаемы, и ссылки css сходятся с ними в обе стороны',
    run: async () => {
      const detail: string[] = []
      const dir = join(DIST, 'fonts')
      const onDisk = existsSync(dir)
        ? readdirSync(dir).filter((f) => f.endsWith('.woff2')).sort()
        : []
      if (onDisk.length === 0) {
        detail.push('в dist/fonts нет ни одного woff2 — весь сайт уедет в системный шрифт')
      }

      // ⚠⚠ «Файл существует» и «файл годен» — не одно и то же. Пустой файл,
      // обрезанная выгрузка и текстовая заглушка существуют точно так же,
      // поэтому смотрим подпись формата и порог веса.
      for (const f of onDisk) {
        const buf = readFileSync(join(dir, f))
        if (buf.length < 4 || buf.toString('ascii', 0, 4) !== 'wOF2') {
          detail.push(`${f} не начинается с подписи wOF2 — это не woff2`)
        } else if (buf.length < 5_000) {
          detail.push(`${f} весит ${buf.length} байт: так выглядит заглушка, а не шрифт`)
        }
      }

      // ⚠⚠ СВЕРКА В ОБЕ СТОРОНЫ. Переименовать файл и забыть про css — часть
      // букв уедет в системный шрифт МОЛЧА, сборка при этом зелёная. Забыть
      // файл при живой ссылке — то же самое с другой стороны. Ловится только
      // сравнением множеств, как в comparePageSets.
      const referenced = new Set<string>()
      for (const css of styleFiles()) {
        for (const m of css.matchAll(/\/fonts\/([A-Za-z0-9._-]+\.woff2)/g)) referenced.add(m[1])
      }
      const { missing, extra } = diffSets(new Set(onDisk), referenced)
      if (missing.length) detail.push(`css зовёт, а файла нет (${missing.length}): ${preview(missing)}`)
      if (extra.length) detail.push(`файл лежит, а css его не зовёт (${extra.length}): ${preview(extra)}`)

      // ⚠ Версия в ИМЕНИ файла — условие права на `immutable` в public/_headers.
      // Без неё год кэша означает год, в течение которого правка шрифта не
      // доедет до вернувшегося посетителя (пункт №37 про `?v=`).
      const unversioned = onDisk.filter((f) => !/-v\d+-/.test(f))
      if (unversioned.length) {
        detail.push(
          `без версии в имени (${unversioned.length}): ${preview(unversioned)} — ` +
            'с таким именем правило immutable в _headers ставить нельзя',
        )
      }

      const ok = detail.length === 0
      if (ok) {
        const kb = onDisk.reduce((s, f) => s + readFileSync(join(dir, f)).length, 0) / 1024
        detail.push(`${onDisk.length} файлов, ${kb.toFixed(1)} КиБ, все с версией в имени`)
        detail.push(`css зовёт ровно их: ${preview(onDisk)}`)
      }
      return {
        id: 'fonts-files',
        group: 'Fonts',
        ok,
        headline: ok ? `${onDisk.length} woff2 в dist/fonts, ссылки сходятся` : `расхождений: ${detail.length}`,
        detail,
      }
    },
  },

  {
    id: 'fonts-preload',
    group: 'Fonts',
    title: 'preload шрифта — на существующий файл, с as="font" и обязательно с crossorigin',
    run: async () => {
      const detail: string[] = []
      const dir = join(DIST, 'fonts')
      const onDisk = new Set(existsSync(dir) ? readdirSync(dir) : [])
      let tags = 0
      const seen = new Set<string>()
      for (const page of allPages()) {
        for (const m of page.html.matchAll(/<link[^>]*rel="preload"[^>]*>/g)) {
          const tag = m[0]
          if (!tag.includes('/fonts/')) continue
          tags++
          const file = /\/fonts\/([A-Za-z0-9._-]+\.woff2)/.exec(tag)?.[1]
          if (file) seen.add(file)
          if (!file || !onDisk.has(file)) {
            detail.push(`${page.rel}: preload на несуществующий ${file ?? '(имя не разобрано)'}`)
          }
          // ⚠⚠ БЕЗ crossorigin PRELOAD ПРЕВРАЩАЕТСЯ ВО ВРЕД. Шрифты
          // запрашиваются в режиме CORS всегда, даже со своего домена; без
          // атрибута браузер считает предзагруженный ответ несовпадающим и
          // качает файл ВТОРОЙ раз. Молча, и вдвое дороже, чем без preload.
          if (!/\bcrossorigin\b/.test(tag)) {
            detail.push(`${page.rel}: preload без crossorigin — файл приедет дважды`)
          }
          if (!/as="font"/.test(tag)) detail.push(`${page.rel}: preload без as="font"`)
        }
      }
      // ⚠ Ноль тегов — тоже отказ: значит правка №43 не доехала до сборки.
      if (tags === 0) detail.push('ни одного preload шрифта во всём dist — правка №43 не доехала')

      const ok = detail.length === 0
      if (ok) {
        detail.push(`${tags} тегов preload, все с as="font" и crossorigin`)
        detail.push(`предзагружаются: ${preview([...seen].sort())}`)
      }
      return {
        id: 'fonts-preload',
        group: 'Fonts',
        ok,
        headline: ok ? `${tags} preload, ${seen.size} файла` : `расхождений: ${detail.length}`,
        detail: detail.slice(0, 20),
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
        { path: '/ghs-label-maker/', param: 'cas', page: 'ghs-label-maker/index.html', island: 'LabelConstructorLoader' },
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

  // ═══════════════════════════ UN — раздел номеров ООН ═══════════════════════════
  //
  // ⚠⚠ Инварианты раздела — не косметика, а условие, при котором он вообще имеет
  // право существовать (claude/un-pages-design.md §3):
  //   1. страниц ровно столько, сколько строк в un_page_index — ни одной лишней,
  //      ни одной пропущенной, иначе sitemap зовёт краулера в 404;
  //   2. под каждой юрисдикционной панелью стоит КЛИКАБЕЛЬНОЕ клеймо источника;
  //   3. спецположения ADR и 49 CFR не слиты — 73 числовых кода существуют в
  //      обеих системах и означают разное, и слитый список опаснее пустого.

  {
    id: 'un-pages',
    group: 'UN',
    title: 'Набор страниц /un/ равен un_page_index',
    run: async () => {
      const rows = await selectAll<{ un_number: string }>('un_page_index', 'un_number')
      // ⚠ RLS без политики отдаёт anon пустоту, а не ошибку — без этой строки проверка молча позеленеет.
      assertNonEmpty('un-pages', 'un_page_index', rows)
      const expected = new Set(rows.map((r) => r.un_number))
      const actual = new Set(pageSlugs('un'))
      const { missing, extra } = diffSets(actual, expected)
      const detail: string[] = []
      if (missing.length) detail.push(`есть в un_page_index, но нет в dist (${missing.length}): ${preview(missing)}`)
      if (extra.length) detail.push(`есть в dist, но нет в un_page_index (${extra.length}): ${preview(extra)}`)
      if (!readPage('un/index.html')) detail.push('нет хаба dist/un/index.html')
      return {
        id: 'un-pages',
        group: 'UN',
        ok: detail.length === 0,
        headline: `${actual.size} страниц в dist, ${expected.size} строк в un_page_index`,
        detail,
      }
    },
  },

  {
    id: 'un-source-stamp',
    group: 'UN',
    title: 'У каждой юрисдикционной панели есть кликабельное клеймо источника',
    run: async () => {
      const ADR_HREF = 'unece.org/adr-2025-files'
      const DOT_HREF = 'ecfr.gov/current/title-49/section-172.101'
      const slugs = pageSlugs('un')
      const detail: string[] = []
      let withAdr = 0
      let withDot = 0
      for (const slug of slugs) {
        const html = readPage(`un/${slug}/index.html`)
        if (!html) { detail.push(`${slug}: нет index.html`); continue }
        const hasAdrPanel = html.includes('data-panel="adr"')
        const hasDotPanel = html.includes('data-panel="dot"')
        if (!hasAdrPanel && !hasDotPanel) { detail.push(`${slug}: нет ни одной панели юрисдикции`); continue }
        if (hasAdrPanel) {
          withAdr++
          if (!html.includes(ADR_HREF)) detail.push(`${slug}: панель ADR без ссылки на первоисточник`)
        }
        if (hasDotPanel) {
          withDot++
          if (!html.includes(DOT_HREF)) detail.push(`${slug}: панель 49 CFR без ссылки на первоисточник`)
        }
      }
      return {
        id: 'un-source-stamp',
        group: 'UN',
        ok: detail.length === 0,
        headline: `${withAdr} страниц с панелью ADR, ${withDot} с панелью 49 CFR`,
        detail,
      }
    },
  },

  {
    id: 'un-special-provisions',
    group: 'UN',
    title: 'Спецположения ADR и 49 CFR разведены и совпадают с базой',
    run: async () => {
      type SpRow = { un_number: string; sp_codes: string[] | null }
      const adrRows = await selectAll<SpRow>('dg_substances', 'un_number, sp_codes')
      const dotRows = await selectAll<SpRow>('dot_substances', 'un_number, sp_codes')
      assertNonEmpty('un-special-provisions', 'dg_substances', adrRows)
      assertNonEmpty('un-special-provisions', 'dot_substances', dotRows)

      const gather = (rows: SpRow[]) => {
        const m = new Map<string, Set<string>>()
        for (const r of rows) {
          const s = m.get(r.un_number) ?? new Set<string>()
          for (const c of r.sp_codes ?? []) s.add(c)
          m.set(r.un_number, s)
        }
        return m
      }
      const adrByUn = gather(adrRows)
      const dotByUn = gather(dotRows)

      // ⚠ Якорь — атрибут data-sp на <tbody>, а не позиция в тексте: разметка
      // ещё будет меняться, а смысл «это тело таблицы принадлежит ADR» — нет.
      const bodyRe = /<tbody data-sp="(adr|dot)"[^>]*>([\s\S]*?)<\/tbody>/g
      const codeRe = /data-sp-code="([^"]+)"/g

      const slugs = pageSlugs('un')
      const detail: string[] = []
      let checked = 0
      for (const slug of slugs) {
        const html = readPage(`un/${slug}/index.html`)
        if (!html) continue
        const found: Record<string, Set<string>> = { adr: new Set<string>(), dot: new Set<string>() }
        const seenBodies: Record<string, number> = { adr: 0, dot: 0 }
        for (const m of html.matchAll(bodyRe)) {
          const kind = m[1]
          seenBodies[kind]++
          for (const c of m[2].matchAll(codeRe)) found[kind].add(c[1])
        }
        for (const kind of ['adr', 'dot'] as const) {
          if (seenBodies[kind] > 1) {
            detail.push(`${slug}: ${seenBodies[kind]} таблиц спецположений ${kind} — должна быть одна`)
          }
        }
        const expAdr = adrByUn.get(slug) ?? new Set<string>()
        const expDot = dotByUn.get(slug) ?? new Set<string>()
        if (found.adr.size || expAdr.size) {
          const d = diffSets(found.adr, expAdr)
          if (d.missing.length) detail.push(`${slug}: коды ADR есть в базе, но не на странице: ${preview(d.missing)}`)
          if (d.extra.length) detail.push(`${slug}: коды на странице, которых нет в sp_codes ADR: ${preview(d.extra)}`)
        }
        if (found.dot.size || expDot.size) {
          const d = diffSets(found.dot, expDot)
          if (d.missing.length) detail.push(`${slug}: коды 49 CFR есть в базе, но не на странице: ${preview(d.missing)}`)
          if (d.extra.length) detail.push(`${slug}: коды на странице, которых нет в sp_codes 49 CFR: ${preview(d.extra)}`)
        }
        checked++
      }
      return {
        id: 'un-special-provisions',
        group: 'UN',
        ok: detail.length === 0,
        headline: `${checked} страниц проверено, наборы кодов ADR и 49 CFR сошлись поимённо`,
        detail,
      }
    },
  },

  {
    id: 'un-inspector-retired',
    group: 'UN',
    title: 'Старый /inspector/ снят и нигде не проставлен ссылкой',
    run: async () => {
      const detail: string[] = []
      // ⚠ Правило 301 в _redirects работает ТОЛЬКО если статической страницы нет:
      // у Cloudflare Pages файл сильнее строки редиректа.
      if (readPage('inspector/index.html')) {
        detail.push('dist/inspector/index.html собран — 301 на /un/ никогда не сработает')
      }
      // ⚠⚠ СКАНИРУЕМ ВЕСЬ dist, А НЕ НЕСКОЛЬКО ПРОБ.
      // Первая версия проверки брала четыре страницы «шапка и подвал стоят
      // везде, значит одной пробы хватит». Хватило не всё: ссылка на
      // /inspector/ сидела ещё в карточке инструмента на главной, в списке
      // /tools/, в CTA хаба Compliance и в прозе /pictograms/ — то есть в
      // разметке КОНКРЕТНЫХ страниц, а не в общем каркасе. Проба по выборке
      // ловит только то, что уже общее; здесь нужен полный обход.
      const htmlFiles: string[] = []
      const walk = (rel: string) => {
        const abs = join(DIST, rel)
        if (!existsSync(abs)) return
        for (const d of readdirSync(abs, { withFileTypes: true })) {
          const next = rel ? `${rel}/${d.name}` : d.name
          if (d.isDirectory()) {
            if (d.name === '_astro' || d.name === 'structures' || d.name === 'pictograms') continue
            walk(next)
          } else if (d.name.endsWith('.html')) {
            htmlFiles.push(next)
          }
        }
      }
      walk('')
      if (htmlFiles.length === 0) detail.push('в dist не найдено ни одного .html — проверять нечего, и это не «пройдено»')
      const offenders: string[] = []
      for (const rel of htmlFiles) {
        const html = readPage(rel)
        if (!html) continue
        if (html.includes('href="/inspector/"') || html.includes('href="/inspector"')) offenders.push(rel)
      }
      if (offenders.length) {
        detail.push(`внутренних ссылок на /inspector/ осталось на ${offenders.length} страницах: ${preview(offenders)}`)
      }

      const redirects = readPage('_redirects')
      if (!redirects || !redirects.includes('/inspector/ /un/ 301')) {
        detail.push('в dist/_redirects нет правила `/inspector/ /un/ 301`')
      }
      return {
        id: 'un-inspector-retired',
        group: 'UN',
        ok: detail.length === 0,
        headline: detail.length === 0
          ? `страницы нет, 301 на месте, ${htmlFiles.length} страниц dist без единой ссылки на /inspector/`
          : `нарушений: ${detail.length}`,
        detail,
      }
    },
  },

  {
    // ⚠⚠ Проверка ДАННЫХ, а не разметки, и стоит она здесь не случайно.
    // При импорте Таблицы A колонка (5) у 12 строк (UN 3537-3548) содержала не
    // код знака, а перекрёстную ссылку «See 5.2.2.1.12», разорванную в PDF на
    // три строки. Парсер разрезал её по пробелам и положил в массив три
    // «кода»: {See, 5.2.2.1., 12}. Ни одна проверка этого не видела, потому что
    // ни один из тех номеров не попал в 389 страниц — мусор просто лежал в базе
    // и ждал, когда кто-нибудь возьмёт label_codes для нового экрана.
    //
    // Словарь закрытый НАРОЧНО: новое издание ADR должно уронить эту проверку,
    // чтобы человек посмотрел глазами, а не чтобы неизвестный код тихо доехал
    // до страницы. `None`, `7X`, `7E`, `9A` — настоящие значения Таблицы A,
    // сверены построчно по ECE/TRANS/352 Vol. I.
    id: 'un-label-vocabulary',
    group: 'UN',
    title: 'Коды знаков в Таблице A — из известного словаря, без мусора разбора',
    run: async () => {
      // ⚠⚠ СПИСОК СВЕРЕН ЗАПРОСОМ В ОБЕ СТОРОНЫ, А НЕ ГЛАЗАМИ.
      // Первая версия была выписана руками и потеряла код `8` — коррозионное
      // вещество, ТРЕТИЙ по частоте, 586 строк. Проверка честно покраснела на
      // первом же прогоне. Урок ровно тот же, что с номерами Кемлера: полноту
      // словаря подтверждает запрос, а не внимательность.
      //   select distinct unnest(label_codes) from dg_substances  →  22 значения
      //   разность с этим списком в обе стороны                   →  пусто
      const KNOWN = new Set([
        '1', '1.4', '1.5', '1.6',
        '2.1', '2.2', '2.3',
        '3', '4.1', '4.2', '4.3',
        '5.1', '5.2', '6.1', '6.2',
        '7X', '7E', '8', '9', '9A',
        'None',              // напечатано словом у UN 2211 и UN 3314
        'See 5.2.2.1.12',    // перекрёстная ссылка у UN 3537-3548, хранится целиком
      ])
      const rows = await selectAll<{ un_number: string; label_codes: string[] | null }>(
        'dg_substances',
        'un_number, label_codes',
      )
      assertNonEmpty('un-label-vocabulary', 'dg_substances', rows)
      const bad = new Map<string, string[]>()
      let values = 0
      for (const r of rows) {
        for (const c of r.label_codes ?? []) {
          values++
          if (!KNOWN.has(c)) {
            const list = bad.get(c) ?? []
            if (list.length < 6) list.push(r.un_number)
            bad.set(c, list)
          }
        }
      }
      const detail = [...bad.entries()].map(
        ([code, uns]) => `неизвестный код знака ${JSON.stringify(code)} — UN ${uns.join(', ')}${uns.length >= 6 ? ' …' : ''}`,
      )
      // ⚠ Обратная сторона: код есть в словаре, но пропал из базы. Это не
      // обязательно дефект (новое издание могло убрать знак), но молчать нельзя:
      // чаще это значит, что импорт что-то потерял.
      const seen = new Set(rows.flatMap((r) => r.label_codes ?? []))
      const vanished = [...KNOWN].filter((c) => !seen.has(c)).sort()
      if (vanished.length) {
        detail.push(`в словаре есть, а в базе больше нет: ${preview(vanished)} — проверить импорт Таблицы A`)
      }
      return {
        id: 'un-label-vocabulary',
        group: 'UN',
        ok: detail.length === 0,
        headline: detail.length === 0
          ? `${values} значений label_codes, все из словаря (${KNOWN.size} кодов)`
          : `неизвестных кодов: ${bad.size}`,
        detail,
      }
    },
  },

  {
    id: 'un-sitemap',
    group: 'UN',
    title: 'sitemap объявляет ровно те /un/, что собраны',
    run: async () => {
      const xml = readPage('sitemap.xml')
      if (!xml) {
        return { id: 'un-sitemap', group: 'UN', ok: false, headline: 'нет dist/sitemap.xml', detail: [] }
      }
      const declared = new Set(
        [...xml.matchAll(/<loc>https:\/\/ghspictograms\.com\/un\/([^<\/]*)\/?<\/loc>/g)].map((m) => m[1]),
      )
      const hubDeclared = declared.delete('')
      const actual = new Set(pageSlugs('un'))
      const { missing, extra } = diffSets(actual, declared)
      const detail: string[] = []
      if (!hubDeclared) detail.push('хаб /un/ не объявлен в sitemap')
      if (missing.length) detail.push(`объявлены в sitemap, но не собраны (${missing.length}): ${preview(missing)}`)
      if (extra.length) detail.push(`собраны, но не объявлены в sitemap (${extra.length}): ${preview(extra)}`)
      if (xml.includes('/inspector/')) detail.push('в sitemap остался /inspector/ — он отдаёт 301')
      return {
        id: 'un-sitemap',
        group: 'UN',
        ok: detail.length === 0,
        headline: `${actual.size} страниц в dist, ${declared.size} адресов /un/ в sitemap`,
        detail,
      }
    },
  },

  {
    id: 'un-transport-labels',
    group: 'UN',
    title: 'Каждому коду знака из базы отвечает файл в dist и <img> на странице',
    run: async () => {
      // ⚠⚠ СЛОВАРЬ КОДОВ — ЗАПРОСОМ, А НЕ СПИСКОМ В КОДЕ. Это прямое требование
      // из claude/adr-placard-set-session40.md: список «19 знаков», выписанный
      // руками в передаче сессии 39, потерял код 8 (1 218 строк). Здесь коды
      // берутся из dg_substances / dot_substances, а раскладка «код → файл» —
      // из того же transportLabels.ts, по которому рисует страница.
      //
      // ⚠⚠ ПРОВЕРЯЕТСЯ ДВОЕ, И ВТОРОЕ ВАЖНЕЕ. Мало того, что файл лежит в dist:
      // <img> обязан оказаться НА СТРАНИЦЕ. Знак, который есть на диске и не
      // попал в разметку, — это ровно тот отказ, который сборка не заметит.
      const slugs = pageSlugs('un')
      if (slugs.length === 0) {
        return {
          id: 'un-transport-labels', group: 'UN', ok: false,
          headline: 'в dist/un/ ноль страниц номеров',
          detail: ['Раздел не собран — зелёный ответ здесь был бы тихим провалом. Собрать и повторить.'],
        }
      }

      const adr = await selectAll<{ un_number: string; classification_code: string | null; label_codes: string[] | null }>(
        'dg_substances', 'un_number, classification_code, label_codes',
      )
      const dot = await selectAll<{ un_number: string; label_codes: string[] | null }>(
        'dot_substances', 'un_number, label_codes',
      )
      assertNonEmpty('un-transport-labels', 'dg_substances', adr)
      assertNonEmpty('un-transport-labels', 'dot_substances', dot)

      /** un → множество путей к файлам знаков, которые страница ОБЯЗАНА показать. */
      const expected = new Map<string, Set<string>>()
      const add = (un: string, src: string) => {
        const set = expected.get(un) ?? new Set<string>()
        set.add(src)
        expected.set(un, set)
      }
      for (const r of adr) {
        for (const c of r.label_codes ?? []) {
          for (const l of adrLabels(c, r.classification_code)) add(r.un_number, l.src)
        }
      }
      for (const r of dot) {
        for (const c of r.label_codes ?? []) {
          for (const l of dotLabels(c)) add(r.un_number, l.src)
        }
      }

      // 1. Файл на диске — но СПРАШИВАЕМ ТОЛЬКО ПРО СОБРАННЫЕ СТРАНИЦЫ.
      //
      // ⚠⚠ ЗАМЕР session 41. В базе 11 кодов 49 CFR разрешаются в файлы,
      // которых в комплекте нет: 1.2J, 1.2K, 1.4B, 1.4C, 1.4D, 1.4E, 1.4F,
      // 1.4G, 1.4S, 1.5D, 1.6N — вместе 114 строк §172.101. Ни один из них
      // сегодня не попадает на 389 собираемых номеров (проверено запросом с
      // join на un_page_index — пусто), поэтому ломаных картинок в проде нет.
      // Но дефект отложенный: расширится отбор номеров — и 114 строк начнут
      // рисовать битые <img>. Он печатается ниже отдельной строкой, а красным
      // проверка становится только там, где страница РЕАЛЬНО собрана.
      const built = new Set(slugs)
      const shipped = [...new Set(
        [...expected.entries()].filter(([un]) => built.has(un)).flatMap(([, s]) => [...s]),
      )].sort()
      const noFile = shipped.filter((src) => !existsSync(join(DIST, src.replace(/^\//, ''))))

      const latent = [...new Set(
        [...expected.entries()].filter(([un]) => !built.has(un)).flatMap(([, s]) => [...s]),
      )].filter((src) => !existsSync(join(DIST, src.replace(/^\//, '')))).sort()

      // 2. <img> на странице — и ничего лишнего сверх ожидаемого.
      const PREFIX = 'src="/pictograms/transport/'
      assertAscii('un-transport-labels', [PREFIX])
      const missingOnPage: string[] = []
      const strayOnPage: string[] = []
      let pagesWithLabels = 0
      let imgTotal = 0
      for (const un of slugs) {
        const html = readPage(join('un', un, 'index.html'))
        if (html === null) continue
        const want = expected.get(un) ?? new Set<string>()
        const got = new Set(
          [...html.matchAll(/src="(\/pictograms\/transport\/[^"]+)"/g)].map((m) => m[1]),
        )
        imgTotal += got.size
        if (got.size) pagesWithLabels++
        for (const src of want) if (!got.has(src)) missingOnPage.push(`UN ${un} → ${src}`)
        for (const src of got) if (!want.has(src)) strayOnPage.push(`UN ${un} → ${src}`)
      }

      const detail: string[] = []
      if (noFile.length) {
        detail.push(
          `код из базы разрешается в файл, которого нет в dist (${noFile.length}): ${preview(noFile)}. ` +
            'Файл не доехал до public/pictograms/transport/ или переименован.',
        )
      }
      if (missingOnPage.length) {
        detail.push(
          `знак ожидается, а <img> на странице нет (${missingOnPage.length}): ${preview(missingOnPage)}. ` +
            'Это тихий отказ: сборка такого не замечает.',
        )
      }
      if (strayOnPage.length) {
        detail.push(`на странице знак, которого база не требует (${strayOnPage.length}): ${preview(strayOnPage)}`)
      }
      return {
        id: 'un-transport-labels',
        group: 'UN',
        ok: detail.length === 0,
        headline: detail.length === 0
          ? `${imgTotal} знаков на ${pagesWithLabels} страницах, ${shipped.length} разных файлов — все на месте`
          : `расхождений: ${detail.length}`,
        detail: detail.length === 0
          ? [
              'словарь кодов снят запросом к dg_substances / dot_substances, не списком в коде',
              '⚠ коды без картинки (Empty §172.450, See 5.2.2.1.12, None) знака не дают намеренно — они печатаются текстом',
              ...(latent.length
                ? [
                    `⚠⚠ ОТЛОЖЕННЫЙ ДЕФЕКТ: ${latent.length} файлов нет в комплекте, и они нужны кодам, которых ` +
                      `сегодня нет ни на одной собранной странице: ${preview(latent)}. ` +
                      'Расширится отбор номеров ООН — это станет ломаными картинками. Дорисовать комплект.',
                  ]
                : []),
            ]
          : detail,
      }
    },
  },

  {
    id: 'subs-transport',
    group: 'subs',
    title: 'Транспортный блок стоит ровно на веществах со связью CAS → номер ООН',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-transport', slugs)
      if (miss) return miss

      // ⚠⚠ ОЖИДАНИЕ СТРОИТСЯ ИЗ БАЗЫ, А НЕ ИЗ РАЗМЕТКИ. Связь живёт ТОЛЬКО в
      // substance_un_link: колонка substances.un_number пуста вся, и
      // dg_substances.cas_number тоже пуста вся — проверено запросом. Если
      // мост когда-нибудь заменят другим источником, эта проверка покраснеет
      // раньше, чем расхождение увидит читатель.
      const links = await selectAll<{ cas_number: string; un_number: string }>(
        'substance_un_link', 'cas_number, un_number',
      )
      assertNonEmpty('subs-transport', 'substance_un_link', links)
      const adrUn = new Set((await selectAll<{ un_number: string }>('dg_substances', 'un_number')).map((r) => r.un_number))
      const dotUn = new Set((await selectAll<{ un_number: string }>('dot_substances', 'un_number')).map((r) => r.un_number))

      // ⚠ Номер без строк в обеих таблицах показывать нечем — страница его и не
      // рисует (см. buildUnEntriesByCas). Ожидание обязано повторять то же
      // правило, иначе проверка начнёт требовать пустой заголовок.
      const wantByCas = new Map<string, Set<string>>()
      for (const l of links) {
        if (!adrUn.has(l.un_number) && !dotUn.has(l.un_number)) continue
        const set = wantByCas.get(l.cas_number) ?? new Set<string>()
        set.add(l.un_number)
        wantByCas.set(l.cas_number, set)
      }

      const BLOCK = 'id="transport"'
      const MORE = 'sub-un-more'
      assertAscii('subs-transport', [BLOCK, MORE])

      const shouldHave: string[] = []
      const shouldNot: string[] = []
      const linkMismatch: string[] = []
      const deadLink: string[] = []
      let shown = 0
      let linkTotal = 0
      for (const slug of slugs!) {
        const html = readPage(join('substances', slug, 'index.html'))
        if (html === null) continue
        const cas = casFromSlug(slug)
        if (!cas) continue
        const want = wantByCas.get(cas) ?? new Set<string>()
        const has = html.includes(BLOCK)
        if (has) shown++
        if (want.size && !has) { shouldHave.push(`${slug} (ждали UN ${[...want].sort().join(', ')})`); continue }
        if (!want.size && has) { shouldNot.push(slug); continue }
        if (!has) continue

        // Ссылки на страницы номеров, вытащенные из САМОЙ страницы.
        const got = new Set([...html.matchAll(/href="\/un\/([^"\/]+)\/"/g)].map((m) => m[1]))
        linkTotal += got.size
        const { missing, extra } = diffSets(got, want)
        if (missing.length || extra.length) {
          linkMismatch.push(
            `${slug}: ${missing.length ? `нет ссылки на UN ${missing.join(', ')}` : ''}` +
              `${missing.length && extra.length ? '; ' : ''}` +
              `${extra.length ? `лишняя ссылка на UN ${extra.join(', ')}` : ''}`,
          )
        }
        // ⚠⚠ Ссылка обязана вести в СОБРАННУЮ страницу, а не просто быть
        // синтаксически верной. Это тот же класс дефекта, что `?cas=` вместо
        // `?substance=` в калькуляторе: адрес живой, страница пустая, всё
        // зелёное. Проверяем файлом на диске.
        for (const un of got) {
          if (!existsSync(join(DIST, 'un', un, 'index.html'))) deadLink.push(`${slug} → /un/${un}/`)
        }
      }

      const detail: string[] = []
      if (shouldHave.length) detail.push(`связь в базе есть, блока нет (${shouldHave.length}): ${preview(shouldHave)}`)
      if (shouldNot.length) {
        detail.push(
          `блок стоит без связи в базе (${shouldNot.length}): ${preview(shouldNot)}. ` +
            'Условие секции разошлось с substance_un_link.',
        )
      }
      if (linkMismatch.length) detail.push(`набор ссылок на /un/ не равен базе (${linkMismatch.length}): ${preview(linkMismatch)}`)
      if (deadLink.length) detail.push(`ссылка ведёт в несобранную страницу (${deadLink.length}): ${preview(deadLink)}`)

      const ok = detail.length === 0
      return {
        id: 'subs-transport',
        group: 'subs',
        ok,
        headline: ok
          ? `${shown} страниц с транспортным блоком, ${linkTotal} ссылок на /un/ — все сошлись с базой`
          : `расхождений: ${detail.length}`,
        detail: ok
          ? [
              `маркер: ${BLOCK}`,
              `связей CAS → UN в базе: ${links.length}, из них с данными в Таблице A или §172.101: ${[...wantByCas.values()].reduce((n, s) => n + s.size, 0)}`,
              `веществ со связью: ${wantByCas.size} (страниц в разделе ${slugs!.length})`,
            ]
          : detail,
      }
    },
  },

  {
    id: 'label-identifiers',
    group: 'subs',
    title: 'На этикетку не уходит ни один идентификатор негодной формы',
    run: async () => {
      // ⚠⚠ ЭТУ ПРОВЕРКУ НЕЛЬЗЯ СДЕЛАТЬ ПО dist, И В ЭТОМ ВСЁ ДЕЛО. Этикетка
      // рисуется в браузере, в собранных страницах её нет — ни одна из 95
      // проверок и ни один прогон check:seo не видели склеенного EC-номера,
      // который в session 43 уехал в прод и нашёлся глазами на готовом PDF:
      //
      //   EC 200-752-1[1]209-526-      (1-pentanol)
      //
      // Поэтому здесь проверяется не разметка, а САМА ФУНКЦИЯ, через которую
      // запись базы превращается в этикетку, — прогоном по всем записям.
      //
      // ⚠ Дефект того же рода живёт в базе и сегодня: колонка Annex VI хранит
      // идентификаторы всех форм в одной ячейке и режет её по длине. Чинить
      // импорт мы не беремся — проверка следит за тем, что испорченное
      // значение остановлено ПЕРЕД печатью.
      type Row = {
        cas_number: string | null
        ec_number: string | null
        index_number: string | null
        common_name: string | null
        display_name_short: string | null
        iupac_name: string | null
      }
      const rows = await selectAll<Row>(
        'substances',
        'cas_number, ec_number, index_number, common_name, display_name_short, iupac_name',
      )
      assertNonEmpty('label-identifiers', 'substances', rows)

      const printedBad: string[] = []
      const chipBad: string[] = []
      const indexBad: string[] = []
      let spoiledCas = 0
      let spoiledEc = 0
      let savedCas = 0
      let savedEc = 0
      let droppedCas = 0
      let droppedEc = 0

      for (const r of rows) {
        const who = r.cas_number ?? r.display_name_short ?? '(запись без CAS)'
        const casSpoiled = !!r.cas_number && !casShapeOk(r.cas_number)
        const ecSpoiled = !!r.ec_number && !ecShapeOk(r.ec_number)
        if (casSpoiled) spoiledCas++
        if (ecSpoiled) spoiledEc++

        // 1. Что печатается по умолчанию.
        const ids = defaultLabelIdentifiers(r)
        if (ids.cas && !casShapeOk(ids.cas)) printedBad.push(`${who} → CAS ${ids.cas}`)
        if (ids.ec && !ecShapeOk(ids.ec)) printedBad.push(`${who} → EC ${ids.ec}`)
        if (casSpoiled) {
          if (ids.cas) savedCas++
          else droppedCas++
        }
        if (ecSpoiled) {
          if (ids.ec) savedEc++
          else droppedEc++
        }

        // 2. Что подставляют чипы форм — это тоже путь на этикетку, в один клик.
        for (const v of productNameVariants(r)) {
          if (v.cas && !casShapeOk(v.cas)) chipBad.push(`${who} → «${v.name}»: CAS ${v.cas}`)
          if (v.ec && !ecShapeOk(v.ec)) chipBad.push(`${who} → «${v.name}»: EC ${v.ec}`)
        }

        if (r.index_number && !indexShapeOk(r.index_number)) indexBad.push(`${who} → ${r.index_number}`)
      }

      const detail: string[] = []
      if (printedBad.length) {
        detail.push(
          `на этикетку по умолчанию уходит номер негодной формы (${printedBad.length}): ${preview(printedBad)}. ` +
            'Предохранитель в labelProductName.ts перестал работать.',
        )
      }
      if (chipBad.length) {
        detail.push(
          `чип формы подставляет номер негодной формы (${chipBad.length}): ${preview(chipBad)}. ` +
            'Это тот же дефект, только в один клик от него.',
        )
      }
      const ok = detail.length === 0
      return {
        id: 'label-identifiers',
        group: 'subs',
        ok,
        headline: ok
          ? `${rows.length} записей: колонка Annex VI испортила CAS у ${spoiledCas} и EC у ${spoiledEc} — на этикетку не ушло ни одного`
          : `расхождений: ${detail.length}`,
        detail: ok
          ? [
              `разбор форм спасает CAS у ${savedCas} записей и EC у ${savedEc}: номер берётся у той формы, чьё имя печатается`,
              `остаются без номера ${droppedCas} по CAS и ${droppedEc} по EC — печатать там нечего, ` +
                'и пустое поле честнее номера, которого не существует',
              '⚠ контрольная цифра EC НЕ проверяется намеренно: из 3 716 номеров годной формы её не проходят 52, ' +
                'и все 52 — ELINCS (4xx), где схема другая. Проверка стёрла бы верные номера',
              indexBad.length
                ? `⚠⚠ ОТЛОЖЕННЫЙ ДЕФЕКТ: index_number негодной формы у ${indexBad.length} записей: ${preview(indexBad)}. ` +
                  'На этикетке его сегодня нет, но появление таких значений означает, что импорт поехал и по этой колонке.'
                : 'index_number цел у всех записей — та же колонка его не портит',
            ]
          : detail,
      }
    },
  },

  {
    id: 'identifiers-in-dist',
    group: 'subs',
    title: 'Ни на одной собранной странице нет идентификатора негодной формы',
    run: async () => {
      // ⚠⚠ ПАРНАЯ ПРОВЕРКА К label-identifiers, И ОНИ НЕ ДУБЛИРУЮТ ДРУГ ДРУГА.
      // Та смотрит на функцию — что она отдаёт этикетке; эта смотрит на бумагу —
      // что реально напечатано в 4 500 файлах. Дефект session 43 прошёл мимо
      // всех проверок именно потому, что проверяли одно и не проверяли другое.
      //
      // Ищем ровно два следа колонки Annex VI, оба однозначные:
      //   1. склейка   «71-41-0[1]584-02-1» / «200-752-1[1]209-526-»
      //   2. прочерк   «EC number: -» — не идентификатор, а пустая ячейка
      const GLUED = /\d{2,7}-\d{2}-\d\[\d\]|\d{3}-\d{3}-\d\[\d\]/
      const EC_FIELD = /EC number<\/span>\s*<span[^>]*>([^<]*)<|EC number<\/dt>\s*<dd[^>]*>([^<]*)</g

      /** Все *.html в dist, по одному — без кэша: файлов тысячи. */
      function* walkHtml(dir: string): Generator<string> {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, e.name)
          if (e.isDirectory()) yield* walkHtml(full)
          else if (e.name.endsWith('.html')) yield full
        }
      }

      const glued: string[] = []
      const badEcField: string[] = []
      let scanned = 0
      for (const file of walkHtml(DIST)) {
        scanned++
        const html = readFileSync(file, 'utf8')
        const rel = file.slice(DIST.length + 1).replace(/\\/g, '/')
        const m = GLUED.exec(html)
        if (m) glued.push(`${rel}: ${m[0]}`)
        EC_FIELD.lastIndex = 0
        for (let f = EC_FIELD.exec(html); f; f = EC_FIELD.exec(html)) {
          const value = (f[1] ?? f[2] ?? '').trim()
          if (value && !ecShapeOk(value)) badEcField.push(`${rel}: «${value}»`)
        }
      }

      const detail: string[] = []
      if (glued.length) {
        detail.push(
          `склейка форм Annex VI напечатана на странице (${glued.length}): ${preview(glued)}. ` +
            'Такого номера не существует — значение прошло мимо substanceIdentifiers.ts.',
        )
      }
      if (badEcField.length) {
        detail.push(
          `в поле «EC number» стоит не EC-номер (${badEcField.length}): ${preview(badEcField)}. ` +
            'Чаще всего это прочерк из колонки Annex VI: пустую ячейку печатать не надо вовсе.',
        )
      }
      const ok = detail.length === 0
      return {
        id: 'identifiers-in-dist',
        group: 'subs',
        ok,
        headline: ok
          ? `${scanned} страниц просмотрено — ни склеек Annex VI, ни прочерков в поле EC`
          : `расхождений: ${detail.length}`,
        detail: ok
          ? [
              'ищется след колонки, а не совпадение с базой: склейка «NNN-NNN-N[1]…» и непустое поле EC не той формы',
              '⚠ проверка НЕ видит того, что рисует браузер: этикетка конструктора собирается на клиенте, ' +
                'и её сторожит label-identifiers — прогоном самой функции разбора',
            ]
          : detail,
      }
    },
  },

  {
    id: 'subs-toc',
    group: 'subs',
    title: 'Оглавление страницы вещества совпадает с её секциями в обе стороны',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('subs-toc', slugs)
      if (miss) return miss

      // ⚠⚠ ЭТО ПРОВЕРКА НА ССЫЛКУ В НИКУДА. Пункт оглавления, ведущий на якорь,
      // которого на странице нет, не даёт ни ошибки в консоли, ни красноты в
      // сборке: браузер просто остаётся на месте, и читатель решает, что
      // сломана страница. Ловится только сверкой множеств.
      //
      // ⚠ Секции условные (у 987 веществ нет реактивной группы, у части нет
      // свойств), поэтому сверять надо КАЖДУЮ страницу со своим набором, а не
      // с эталонным списком из тринадцати пунктов.
      const NAV = 'class="sub-toc"'
      assertAscii('subs-toc', [NAV])

      const noNav: string[] = []
      const brokenAnchor: string[] = []
      const orphanSection: string[] = []
      let itemsTotal = 0
      for (const slug of slugs!) {
        const html = readPage(join('substances', slug, 'index.html'))
        if (html === null) continue
        if (!html.includes(NAV)) { noNav.push(slug); continue }

        // Оглавление — от <nav class="sub-toc"> до его </nav>.
        const navStart = html.indexOf('<nav class="sub-toc"')
        const navEnd = html.indexOf('</nav>', navStart)
        const nav = navStart >= 0 && navEnd > navStart ? html.slice(navStart, navEnd) : ''
        const items = [...nav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
        itemsTotal += items.length

        // ⚠ Секции считаем ПОСЛЕ оглавления: у героя id нет, но на будущее.
        const body = html.slice(navEnd < 0 ? 0 : navEnd)
        const sections = new Set([...body.matchAll(/<section[^>]*\sid="([^"]+)"/g)].map((m) => m[1]))

        for (const id of items) if (!sections.has(id)) brokenAnchor.push(`${slug} → #${id}`)
        for (const id of sections) if (!items.includes(id)) orphanSection.push(`${slug} → #${id}`)
      }

      const detail: string[] = []
      if (noNav.length) detail.push(`нет оглавления (${noNav.length}): ${preview(noNav)}`)
      if (brokenAnchor.length) {
        detail.push(
          `пункт ведёт на якорь, которого на странице нет (${brokenAnchor.length}): ${preview(brokenAnchor)}. ` +
            'Условие в массиве toc разошлось с условием у самой секции.',
        )
      }
      if (orphanSection.length) {
        detail.push(
          `секция есть, а пункта в оглавлении нет (${orphanSection.length}): ${preview(orphanSection)}. ` +
            'Новую секцию надо добавлять в toc в том же коммите.',
        )
      }
      const ok = detail.length === 0
      return {
        id: 'subs-toc',
        group: 'subs',
        ok,
        headline: ok
          ? `${slugs!.length} страниц, ${itemsTotal} пунктов оглавления — все якоря на месте`
          : `расхождений: ${detail.length}`,
        detail: ok ? [`маркер: ${NAV}`, 'сверка идёт в обе стороны: пункт → секция и секция → пункт'] : detail,
      }
    },
  },

  {
    id: 'sds-toc',
    group: 'SDS',
    title: 'Навигация SDS совпадает с секциями страницы в обе стороны',
    run: async () => {
      // ⚠⚠ ТА ЖЕ ПРОВЕРКА, ЧТО subs-toc, И ЗАВЕДЕНА ПО ТОЙ ЖЕ ПРИЧИНЕ. На SDS
      // липкая навигация стояла с самого начала, и именно поэтому дыру в ней
      // никто не искал: в session 41 нашлось, что §13 Disposal рисуется на
      // странице, а пункта в navItems у него нет. Между «§12 Ecology» и
      // «§14 Transport» читатель видел пропуск номера и решал, что раздела нет.
      //
      // ⚠ Сверка идёт в ОБЕ стороны: пункт без секции — ссылка в никуда,
      // секция без пункта — раздел, которого не найти.
      const slugs = pageSlugs('sds')
      if (slugs.length === 0) {
        return {
          id: 'sds-toc', group: 'SDS', ok: false,
          headline: 'в dist/sds/ ноль страниц',
          detail: ['Раздел не собран — зелёный ответ был бы тихим провалом.'],
        }
      }
      const NAV = 'aria-label="On this page"'
      assertAscii('sds-toc', [NAV])

      const noNav: string[] = []
      const brokenAnchor: string[] = []
      const orphanSection: string[] = []
      let itemsTotal = 0
      for (const slug of slugs) {
        const html = readPage(join('sds', slug, 'index.html'))
        if (html === null) continue
        const navStart = html.indexOf(NAV)
        if (navStart < 0) { noNav.push(slug); continue }
        const navEnd = html.indexOf('</nav>', navStart)
        const nav = navEnd > navStart ? html.slice(navStart, navEnd) : ''
        const items = [...nav.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
        itemsTotal += items.length

        // ⚠ Считаем только <section id>. Оверлей «Emergency» — это <div id>,
        // и пунктом навигации он быть не должен: его открывает своя кнопка.
        const body = html.slice(navEnd < 0 ? 0 : navEnd)
        const sections = new Set([...body.matchAll(/<section[^>]*\sid="([^"]+)"/g)].map((m) => m[1]))

        for (const id of items) if (!sections.has(id)) brokenAnchor.push(`${slug} → #${id}`)
        for (const id of sections) if (!items.includes(id)) orphanSection.push(`${slug} → #${id}`)
      }

      const detail: string[] = []
      if (noNav.length) detail.push(`нет навигации (${noNav.length}): ${preview(noNav)}`)
      if (brokenAnchor.length) detail.push(`пункт ведёт на якорь, которого нет (${brokenAnchor.length}): ${preview(brokenAnchor)}`)
      if (orphanSection.length) {
        detail.push(
          `секция есть, а пункта в навигации нет (${orphanSection.length}): ${preview(orphanSection)}. ` +
            'Новую секцию надо добавлять в navItems тем же условием, что и саму секцию.',
        )
      }
      const ok = detail.length === 0
      return {
        id: 'sds-toc',
        group: 'SDS',
        ok,
        headline: ok
          ? `${slugs.length} страниц, ${itemsTotal} пунктов навигации — все якоря на месте`
          : `расхождений: ${detail.length}`,
        detail: ok ? [`маркер: ${NAV}`, 'сверка в обе стороны; оверлей #emergency — <div>, пунктом быть не обязан'] : detail,
      }
    },
  },

  {
    id: 'mobile-table-labels',
    group: 'Вёрстка',
    title: 'Подписи колонок на телефоне: класс в разметке, правило в бандле, та же точка перелома',
    run: async () => {
      // ⚠⚠ ЗАЧЕМ ЭТА ПРОВЕРКА СУЩЕСТВУЕТ. Ниже 720 px hub.css прячет `thead` и
      // раскладывает строку таблицы в стопку. У Таблицы A семь колонок, и без
      // подписей строка читается «ACETONE · 3 · F1 · II · знак · 3 · 2 · 33»:
      // «2» — категория перевозки, «33» — номер Кемлера, «3» встречается дважды
      // и значит разное. В СРАВНИТЕЛЬНОЙ таблице это хуже вдвое: имя юрисдикции
      // живёт только в шапке, и на телефоне два значения ложились друг под
      // друга безымянными — прямое нарушение инварианта раздела.
      //
      // ⚠⚠ ТРИ ВЕЩИ ПРОВЕРЯЮТСЯ, И ТРЕТЬЯ — ГЛАВНАЯ.
      //   1. класс есть в разметке;
      //   2. у класса есть правило в СОБРАННОМ css (класс без правила молчит);
      //   3. правило лежит в ТОМ ЖЕ медиазапросе, что и `thead{display:none}`.
      // Третье написано потому, что в session 41 подписи страницы вещества были
      // выкачены с `max-width: 640px` при перепаде таблицы на 720. В полосе
      // 641…720 шапка уже спрятана, а подписей ещё нет. Ни сборка, ни первые
      // две проверки такого не видят: класс на месте, правило на месте, а на
      // экране голые значения. Поймано скриншотом уже после деплоя.
      if (styleFiles().length === 0) {
        return {
          id: 'mobile-table-labels', group: 'Вёрстка', ok: false,
          headline: 'в dist/_astro/ нет ни одного .css',
          detail: ['Стили не собраны — проверять нечего, и зелёный ответ здесь был бы ложью.'],
        }
      }

      // Точка перелома самой таблицы — эталон, с которым всё сверяется.
      const TABLE_STACK = '.hub-table thead{display:none}'
      const tableWidth = mediaWidthOf(TABLE_STACK)
      if (tableWidth === null || tableWidth === 0) {
        return {
          id: 'mobile-table-labels', group: 'Вёрстка', ok: false,
          headline: 'не нашёл правило, которое прячет шапку таблицы',
          detail: [
            `искал в собранном css подстроку ${JSON.stringify(TABLE_STACK)}`,
            'Оно есть в hub.css. Если минификатор стал писать иначе — поправить строку поиска здесь,',
            'а не удалять проверку: без эталонной ширины сверять подписи не с чем.',
          ],
        }
      }

      // ⚠ Классы собираются ИЗ РАЗМЕТКИ, а не списком здесь: список разошёлся бы
      // молча ровно так же, как словарь знаков в сессии 39.
      // ⚠⚠ Сверяем ЦЕЛЫЙ токен класса, а не подстроку. `\bun-[a-z]+\b` по
      // подстроке находит «un-panel» внутри «sub-un-panel», «un-jur» внутри
      // «sub-un-jur» и ещё три таких — проверка потребовала бы у них подписи
      // и покраснела бы на пустом месте.
      const MARKER = /^(?:unt|un)-[a-z]+$/
      const used = new Set<string>()
      for (const dir of ['un', 'substances']) {
        for (const slug of pageSlugs(dir)) {
          const html = readPage(join(dir, slug, 'index.html'))
          if (!html) continue
          for (const m of html.matchAll(/class="([^"]*)"/g)) {
            for (const t of m[1].split(/\s+/)) if (MARKER.test(t)) used.add(t)
          }
        }
      }

      // ⚠ Два класса подписи не несут намеренно: `unt-name` — имя груза, оно
      // говорит само за себя, `unt-field` — сам заголовок строки в сравнении.
      const NO_LABEL = new Set(['unt-name', 'unt-field'])

      const noRule: string[] = []
      const noBefore: string[] = []
      const wrongWidth: string[] = []
      for (const cls of [...used].sort()) {
        if (!styleHas(`.${cls}`)) { noRule.push(cls); continue }
        if (NO_LABEL.has(cls)) continue
        const needle = `.${cls}::before`
        const w = mediaWidthOf(needle)
        if (w === null) { noBefore.push(cls); continue }
        if (w !== tableWidth) wrongWidth.push(`${cls} (${w || 'вне медиазапроса'} против ${tableWidth})`)
      }

      const detail: string[] = []
      if (noRule.length) detail.push(`класс в разметке, правила в бандле нет (${noRule.length}): ${preview(noRule)}`)
      if (noBefore.length) {
        detail.push(
          `нет подписи ::before (${noBefore.length}): ${preview(noBefore)}. ` +
            'На телефоне это значение без имени колонки.',
        )
      }
      if (wrongWidth.length) {
        detail.push(
          `подпись включается не на той ширине (${wrongWidth.length}): ${preview(wrongWidth)}. ` +
            `Таблица схлопывается на ${tableWidth}px — в полосе между этими числами шапка уже спрятана, ` +
            'а подписей ещё нет.',
        )
      }
      const ok = detail.length === 0
      return {
        id: 'mobile-table-labels',
        group: 'Вёрстка',
        ok,
        headline: ok
          ? `${used.size} классов-подписей, все с правилом и все на ${tableWidth}px`
          : `расхождений: ${detail.length}`,
        detail: ok
          ? [
              `эталон ширины взят из правила ${TABLE_STACK} — ${tableWidth}px`,
              `без подписи намеренно: ${[...NO_LABEL].join(', ')}`,
              'классы собраны из разметки собранных страниц, не списком в коде',
            ]
          : detail,
      }
    },
  },

  // ── Label maker: входы и адреса (session 52, A4/A8 плана) ─────────────────
  {
    id: 'annex6-errata-page',
    group: 'Annex VI',
    title: 'Страница-разбор печатает те же свидетельства, что модуль, и не обещает полноты',
    run: async () => {
      // ⚠⚠⚠ ЗАЧЕМ ЭТА ПРОВЕРКА. Страница обвиняет официальный текст Евросоюза.
      // Если её формулировка разойдётся с той, что ушла в ECHA и в Бюро
      // публикаций, разницу найдёт адресат подачи — сверив письмо с сайтом.
      // Поэтому свидетельства сверяются ДОСЛОВНО и в обе стороны: каждое из
      // модуля обязано быть на странице, и ничего сверх списка на ней быть не
      // должно.
      const REL = 'compliance/clp-translation-errors/index.html'
      const html = readPage(REL)
      if (html === null) {
        return {
          id: 'annex6-errata-page', group: 'Annex VI', ok: false,
          headline: 'страницы нет в dist',
          detail: [`искали ${REL}`, 'страница собирается из src/data/errata-dossier.json и src/lib/annex6Errata.ts'],
        }
      }
      const text = unescapeHtml(html)
      const detail: string[] = []

      // 1. Каждое свидетельство — дословно.
      let found = 0
      for (const index of ERRATA_INDEX_NUMBERS) {
        for (const lang of erratumLanguages(index)) {
          const e = erratumFor(index, lang)!
          if (text.includes(e.note)) found++
          else detail.push(`нет свидетельства ${index} · ${lang}`)
          const cite = erratumCitation(e)
          if (!text.includes(cite)) detail.push(`нет ссылки на полосу ОЖ у ${index} · ${lang}: ${cite}`)
          const st = erratumStatusLabel(erratumStatus(index, lang))
          if (!text.includes(st)) detail.push(`нет состояния у ${index} · ${lang}: «${st}»`)
        }
      }

      // 2. Карточек ровно столько, сколько свидетельств. Лишняя — такой же
      //    дефект, как недостающая: страница печатала бы находку, которой в
      //    подаче нет.
      const cards = (html.match(/class="err-item"/g) ?? []).length
      if (cards !== ERRATA_COUNT) detail.push(`карточек ${cards}, свидетельств ${ERRATA_COUNT}`)

      // 3. ⭐⭐⭐ ОГОВОРКА О НЕПОЛНОТЕ. Метод сверяет 23 редакции друг с другом,
      //    и ошибка, повторённая одинаково во всех, ему не видна. Утверждать
      //    полноту значило бы обещать то, чего замер не даёт.
      const CLAIM = 'This list is not claimed to be complete'
      const hasClaim = text.includes(CLAIM)
      if (!hasClaim) detail.push(`пропала оговорка о неполноте: «${CLAIM}»`)

      // 4. ⚠⚠ КОНТРОЛЬ С ПРОТИВОПОЛОЖНЫМ ОЖИДАНИЕМ. Проверка «текст есть на
      //    странице» пройдёт и на странице, где напечатан ВЕСЬ модуль скопом.
      //    Заведомо отсутствующая строка обязана НЕ найтись.
      const ABSENT = 'The Portuguese edition prints the name of the preceding entry'
      const leaked = text.includes(ABSENT)
      if (leaked) detail.push('контроль не сошёлся: на странице нашлось свидетельство, которого нет в модуле')

      const ok = detail.length === 0
      return {
        id: 'annex6-errata-page', group: 'Annex VI', ok,
        headline: ok
          ? `${found} свидетельств, ${cards} карточек — всё сверено дословно с annex6Errata`
          : `расхождений: ${detail.length}`,
        detail: ok
          ? [
              `оговорка о неполноте на месте: «${CLAIM}»`,
              'контроль «чужого свидетельства на странице нет»: сошёлся',
              'сверка идёт в обе стороны: модуль → страница и счёт карточек → счёт свидетельств',
            ]
          : detail.slice(0, 20),
      }
    },
  },
  {
    id: 'p-precedence-snapshot',
    group: 'Движок P-фраз',
    title: 'Снимок /data/p-precedence.json собран, сходится с базой и несёт gradedCodes',
    run: async () => {
      /**
       * ⚠⚠ ЗАЧЕМ ЭТА ПРОВЕРКА. Session 65 завела эндпоинт, который собирает
       * `/data/p-precedence.json` на КАЖДОЙ сборке, — и ни одна из 106 проверок
       * его не смотрела. Файл не страница: он не попадает ни в `allPages()`, ни
       * в sitemap, ни в обход ссылок. Обрежься он или соберись без поля —
       * сборка зелёная, все проверки зелёные, а инструмент у посетителя молча
       * отказывает. Ровно тот разряд дефекта, что в session 65 поймал `dist`:
       * «новая вещь в разделе — это отдельные вопросы, и их забывают задать».
       *
       * ⭐⭐ И ГЛАВНОЕ: снимок сверяется С БАЗОЙ, а не сам с собой. Внутренняя
       * согласованность счётчиков ловит порчу файла, но не ловит СТАРЫЙ файл,
       * собранный до того, как в базу легли новые строки.
       */
      const rel = 'data/p-precedence.json'
      const abs = join(DIST, rel)
      if (!existsSync(abs)) {
        return {
          id: 'p-precedence-snapshot', group: 'Движок P-фраз', ok: false,
          headline: `нет файла ${rel} — эндпоинт не отработал на сборке`,
          detail: ['страница /p-statements/selector/ и панель «Why these ones?» покажут отказ загрузки'],
        }
      }

      let snap: any
      try {
        snap = JSON.parse(readFileSync(abs, 'utf8'))
      } catch (e) {
        return {
          id: 'p-precedence-snapshot', group: 'Движок P-фраз', ok: false,
          headline: `${rel} не разбирается как JSON`,
          detail: [String(e)],
        }
      }

      const problems: string[] = []
      const detail: string[] = []

      // ① Счётчики против собственного содержимого — порча файла.
      for (const [k, arr] of [
        ['matrix', snap.matrix], ['echa', snap.echa], ['combos', snap.combos],
        ['conditions', snap.conds], ['texts', snap.text], ['gradedCodes', snap.gradedCodes],
      ] as [string, unknown[]][]) {
        if (!Array.isArray(arr)) { problems.push(`нет массива ${k}`); continue }
        if (snap.counts?.[k] !== arr.length) {
          problems.push(`счётчик ${k}=${snap.counts?.[k]}, а в массиве ${arr.length}`)
        }
      }
      if (snap.counts?.pairs !== snap.hidx?.length) {
        problems.push(`счётчик pairs=${snap.counts?.pairs}, а в hidx ${snap.hidx?.length}`)
      }

      // ② Содержимое против БАЗЫ — старый или обрезанный снимок.
      const [matrixRows, scopes, blocks, recs] = await Promise.all([
        selectAll<{ class_code: string; category_code: string }>('clp_matrix_full', 'class_code, category_code'),
        selectAll<{ table_id: number }>('echa_p_table_scope', 'table_id'),
        selectAll<{ block_id: number; table_id: number; p_code: string }>('echa_p_block', 'block_id, table_id, p_code'),
        selectAll<{ block_id: number }>('echa_p_recommendation', 'block_id'),
      ])
      const blockById = new Map(blocks.map((b) => [b.block_id, b]))
      const scopeCount = new Map<number, number>()
      for (const s of scopes) scopeCount.set(s.table_id, (scopeCount.get(s.table_id) ?? 0) + 1)

      const echaExpected = recs.reduce((n, r) => {
        const b = blockById.get(r.block_id)
        return n + (b ? scopeCount.get(b.table_id) ?? 0 : 0)
      }, 0)
      const gradedExpected = new Set(
        recs.map((r) => blockById.get(r.block_id)?.p_code).filter((c): c is string => !!c),
      )
      const pairsExpected = new Set(matrixRows.map((r) => `${r.class_code}|${r.category_code}`))

      const vsBase: [string, number, number][] = [
        ['matrix', snap.matrix?.length ?? -1, matrixRows.length],
        ['echa', snap.echa?.length ?? -1, echaExpected],
        ['echaRecommendations', snap.counts?.echaRecommendations ?? -1, recs.length],
        ['pairs', snap.hidx?.length ?? -1, pairsExpected.size],
        ['gradedCodes', snap.gradedCodes?.length ?? -1, gradedExpected.size],
      ]
      for (const [name, got, want] of vsBase) {
        if (got !== want) problems.push(`${name}: в снимке ${got}, база ожидает ${want} — снимок собран не с этой базой`)
      }
      detail.push(`сверено с базой: ${vsBase.map(([n, , w]) => `${n} ${w}`).join(' · ')}`)

      // ③ ⛔⛔ ДВА ПОЛЮСА ДЕФЕКТА SESSION 66 — счёт их не ловит.
      // `P330` ECHA оценивает (у ACUTE_TOX_ORAL 4) — он ОБЯЗАН быть в списке,
      // иначе движок снова выбросит «Rinse mouth» у категорий 1–3.
      // `P301` ECHA не оценивает нигде — его в списке быть НЕ ДОЛЖНО, иначе
      // правило затупится и на этикетку пойдёт голая часть пары.
      const graded: string[] = Array.isArray(snap.gradedCodes) ? snap.gradedCodes : []
      if (!graded.includes('P330')) problems.push('P330 нет в gradedCodes — вернётся дефект session 66')
      if (graded.includes('P301')) problems.push('P301 попал в gradedCodes — правило «нет уровня нигде» затупилось')
      if (graded.includes('P330') && !graded.includes('P301')) {
        detail.push('полюса на месте: P330 в списке (ECHA оценивает у ACUTE_TOX_ORAL 4), P301 вне списка (не оценивает нигде)')
      }
      const gradedWrong = graded.filter((c) => !gradedExpected.has(c))
      if (gradedWrong.length) problems.push(`в gradedCodes ${gradedWrong.length} кодов, которых база не даёт: ${gradedWrong.slice(0, 6).join(', ')}`)

      /**
       * ④ ⭐⭐ АДРЕС, ПО КОТОРОМУ ФАЙЛ ПРОСЯТ, И ФАЙЛ, КОТОРЫЙ СОБРАН.
       *
       * Тот же разряд, что дефект session 38 с `?cas=` против `?substance=`:
       * ссылка синтаксически безупречна, файл существует, а инструмент пуст.
       * С session 66 в адресе стоит метка `?v=`, чтобы старый снимок не лежал
       * сутки в кэше посетителя, — и опечатка в ПУТИ рядом с меткой ничем бы
       * себя не выдала.
       */
      const astro = join(DIST, '_astro')
      const asked = new Set<string>()
      if (existsSync(astro)) {
        for (const f of readdirSync(astro)) {
          if (!f.endsWith('.js')) continue
          const js = readFileSync(join(astro, f), 'utf8')
          if (!js.includes('/data/p-precedence.json')) continue
          for (const m of js.matchAll(/["'`](\/data\/p-precedence\.json[^"'`]*)["'`]/g)) asked.add(m[1])
          /**
           * ⭐⭐ КИРИЛЛИЦА ОТСЮДА УБРАНА, И ЭТО НЕ ОСЛАБЛЕНИЕ. Session 66
           * проверяла её ЗДЕСЬ — то есть только в бандлах, где встретилась
           * строка `/data/p-precedence.json`. Из тридцати бандлов их два, и
           * `continue` пятью строками выше отсекал остальные двадцать восемь:
           * русское сообщение из `labelEngine.ts` уезжало посетителю мимо
           * проверки полтора месяца. С session 67 правило живёт в группе
           * «Язык интерфейса» и смотрит ВСЕ бандлы и ВСЕ страницы. Держать
           * здесь вторую редакцию — значит завести список, который разойдётся
           * с первым молча.
           */
        }
      }
      if (!asked.size) {
        problems.push('ни один бандл не просит /data/p-precedence.json — снимок собран, но его никто не читает')
      }
      for (const url of asked) {
        const path = url.split('?')[0].replace(/^\//, '')
        if (!existsSync(join(DIST, path))) problems.push(`бандл просит ${url}, а файла ${path} в dist нет`)
      }
      if (asked.size) detail.push(`бандлы просят: ${[...asked].join(', ')} — путь существует`)

      /**
       * ⑥ ⛔⛔ `_headers` — ЕДИНСТВЕННОЕ МЕСТО, ГДЕ КЭШ СНИМКА ВООБЩЕ ЗАДАЁТСЯ.
       *
       * Сборка статическая: заголовки из `Response` эндпоинта Astro выбрасывает,
       * на диск идёт только тело. Session 65 полтора месяца держала в эндпоинте
       * `Cache-Control: max-age=86400`, который не действовал ни дня, — и ни
       * одна проверка этого не видела, потому что смотреть было некуда.
       *
       * ⚠ Верхняя граница здесь не вкусовая. Снимок меняется с каждым деплоем,
       * трогающим данные, адрес при этом прежний, а кэш В БРАУЗЕРЕ посетителя
       * очистить нельзя ничем: длинный `max-age` = столько же времени отбора
       * P-фраз по вчерашней матрице Annex IV.
       */
      const headersFile = join(DIST, '_headers')
      if (!existsSync(headersFile)) {
        problems.push('в dist нет _headers — кэш браузера задавать нечем, за нас решит Cloudflare')
      } else {
        const rules: { path: string; cc: string | null }[] = []
        for (const line of readFileSync(headersFile, 'utf8').split(/\r?\n/)) {
          if (!line.trim() || /^\s*#/.test(line)) continue
          if (!/^\s/.test(line)) { rules.push({ path: line.trim(), cc: null }); continue }
          const m = /^\s*cache-control\s*:(.*)$/i.exec(line)
          if (m && rules.length) rules[rules.length - 1].cc = m[1].trim()
        }
        const ageOf = (cc: string | null) => Number(/max-age\s*=\s*(\d+)/i.exec(cc ?? '')?.[1] ?? -1)
        const byPath = new Map(rules.map((r) => [r.path, r]))

        // ① Снимок движка — коротко. Данные меняются, адрес прежний.
        const dataCc = byPath.get('/data/*')?.cc ?? null
        const dataAge = ageOf(dataCc)
        if (!dataCc) problems.push('в _headers нет правила /data/* с Cache-Control — снимок отдаётся с тем, что придумает Cloudflare')
        else if (dataAge < 0 || dataAge > 900) {
          problems.push(
            `_headers держит снимок у посетителя ${dataAge} с. Кэш браузера очистить нельзя — ` +
            `столько же он будет отбирать фразы по вчерашней матрице Annex IV. Предел 900`,
          )
        } else detail.push(`_headers: /data/* → «${dataCc}»`)

        // ② Бандлы — длинно. Хеш содержимого в имени файла делает это безопасным.
        const astroCc = byPath.get('/_astro/*')?.cc ?? null
        const astroAge = ageOf(astroCc)
        if (!astroCc) problems.push('в _headers нет правила /_astro/* — бандлы перезапрашиваются на каждой странице впустую')
        else if (astroAge < 86400) {
          problems.push(
            `_headers даёт бандлам всего ${astroAge} с. В имени файла лежит хеш содержимого: ` +
            `изменилось содержимое — изменился адрес, поэтому длинный срок здесь безопасен по построению`,
          )
        } else detail.push(`_headers: /_astro/* → «${astroCc}»`)

        /**
         * ③ ⛔⛔ НИ ОДНО ДЛИННОЕ ПРАВИЛО НЕ СМЕЕТ НАКРЫТЬ СТРАНИЦУ.
         *
         * Это и есть дефект, ради которого затевалась вся правка: кэш браузера
         * нельзя очистить ни Purge-ем, ни деплоем. Страница, залипшая у
         * посетителя на сутки, — это сутки старых фраз, и поделать нельзя
         * ничего. Соблазн написать `/pictograms/*` велик: там 101 картинка —
         * и ОДНА страница, хаб раздела.
         *
         * ⚠ Проверяется по dist, а не по списку в коде: список разошёлся бы.
         */
        const pageUnder = (relDir: string): string | null => {
          const abs = relDir ? join(DIST, relDir) : DIST
          if (!existsSync(abs)) return null
          const stack = [abs]
          while (stack.length) {
            const cur = stack.pop()!
            for (const e of readdirSync(cur, { withFileTypes: true })) {
              if (e.isDirectory()) stack.push(join(cur, e.name))
              else if (e.name === 'index.html') return join(cur, e.name).slice(DIST.length + 1)
            }
          }
          return null
        }
        for (const r of rules) {
          const age = ageOf(r.cc)
          if (age <= 900) continue
          if (r.path.endsWith('/*')) {
            const page = pageUnder(r.path.slice(1, -2))
            if (page) {
              problems.push(
                `правило ${r.path} (max-age ${age}) накрывает СТРАНИЦУ ${page}. ` +
                `Кэш браузера очистить нельзя ничем — страница залипнет у посетителя на весь срок`,
              )
            }
          } else if (!existsSync(join(DIST, r.path.replace(/^\//, '')))) {
            problems.push(`правило ${r.path} указывает на файл, которого в dist нет — оно молча ничего не делает`)
          }
        }
        detail.push(`_headers: ${rules.length} правил, ни одно длинное не накрывает страницу и не бьёт мимо файла`)
      }

      const kb = Math.round(readFileSync(abs).length / 1024)
      return {
        id: 'p-precedence-snapshot',
        group: 'Движок P-фраз',
        ok: problems.length === 0,
        headline: problems.length === 0
          ? `снимок на месте (${kb} КБ), ${vsBase.length} счётчиков сошлись с базой, gradedCodes ${graded.length}`
          : `${problems.length} расхождений в ${rel}`,
        detail: problems.length === 0 ? detail : [...problems, ...detail].slice(0, 20),
      }
    },
  },
  {
    id: 'interface-language',
    group: 'Язык интерфейса',
    title: 'До браузера не доезжает ни одного русского слова: ни в бандлах, ни в комментариях страниц',
    run: async () => {
      /**
       * ⚠⚠ ЗАЧЕМ ЭТА ПРОВЕРКА. Сайт англоязычный целиком, русской версии нет и
       * не планируется. Значит любое русское слово, доехавшее до посетителя, —
       * дефект по определению, а не вкусовщина.
       *
       * Session 66 завела такую проверку внутри группы «Движок P-фраз» — и она
       * смотрела ТОЛЬКО бандлы со строкой `/data/p-precedence.json`. Строка
       * `if (!js.includes(...)) continue` отсекала 28 бандлов из 30. Session 67
       * прогнала то же правило по всем: `pictogram: корневого <svg> нет` из
       * `labelEngine.ts` печаталось посетителю в блоке «PDF could not be
       * generated», а `supabase.ts` писал ему в консоль «попытка 2 из 3 —
       * повтор через 400 мс». Ни то, ни другое старая проверка не видела.
       *
       * ⛔⛔ И ГЛАВНОЕ, ЧЕГО ОНА НЕ ВИДЕЛА ВООБЩЕ: HTML-комментарии. В `.astro`
       * запись `<!-- ... -->` попадает в вывод дословно — это не комментарий
       * сборщика, а разметка. 154 таких комментария отдавали посетителю рабочие
       * заметки на русском: 1 681 байт с КАЖДОЙ из 4 501 страницы, потому что
       * четыре из них стоят в `Layout.astro`. Комментарий, набранный ради себя,
       * читался через «Просмотр кода страницы» кем угодно. Лечение — `{/* ... *\/}`:
       * текст остаётся в исходнике на русском и не уезжает никуда.
       *
       * ⭐⭐ ПОЧЕМУ ПРАВИЛО НЕ «НИ ОДНОГО КИРИЛЛИЧЕСКОГО СИМВОЛА». Кириллица на
       * этом сайте ЗАКОННА: болгарский — официальный язык ЕС, `български` стоит
       * в списке языков этикетки, а таблицы ширин глифов в `labelEngine.ts`
       * держат кириллические буквы как ДАННЫЕ рядом с греческими. Правило,
       * запрещающее алфавит, било бы по ним каждый день и было бы отключено на
       * первой же неделе. Поэтому спрашивается не «есть ли кириллица», а
       * «ИЗВЕСТЕН ЛИ ЕЁ ИСТОЧНИК»: разрешение собирается ИЗ САМИХ ИСТОЧНИКОВ —
       * `EU_LANGUAGES` и `W_*_SPEC`, — а не переписывается сюда списком.
       * Добавится язык — разрешение подтянется само; появится русская строка —
       * проверка упадёт.
       *
       * ⚠ Буквы, а не «кириллический блок»: U+0483…0489 — комбинирующие знаки,
       * они лежат внутри регулярки нормализации Unicode в Fuse.js. Наивное
       * `\p{Script=Cyrillic}` давало на них ложную тревогу в стороннем коде.
       */
      const CYR_RUN = /(?:(?!\p{M})\p{Script=Cyrillic})+/gu
      const problems: string[] = []
      const detail: string[] = []

      // ① Разрешение собирается из источников, а не из списка в этом файле.
      const allowed = new Map<string, string>()
      for (const l of EU_LANGUAGES) {
        for (const m of l.native.matchAll(CYR_RUN)) allowed.set(m[0], `эндоним ${l.code}`)
      }
      const enginePath = resolve(process.cwd(), 'src/lib/labelEngine.ts')
      const engineSrc = existsSync(enginePath) ? readFileSync(enginePath, 'utf8') : ''
      if (!engineSrc) problems.push('не читается src/lib/labelEngine.ts — таблицы ширин глифов взять неоткуда')
      let widthRows = 0
      for (const table of ['W_REGULAR_SPEC', 'W_BOLD_SPEC']) {
        const m = engineSrc.match(new RegExp(`const ${table}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`))
        if (!m) {
          problems.push(`в labelEngine.ts не нашлась таблица ${table} — разрешение собрано не полностью, дальше пойдут ложные тревоги`)
          continue
        }
        for (const row of m[1].matchAll(/\[\s*[\d.]+\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g)) {
          widthRows++
          for (const c of row[1].matchAll(CYR_RUN)) if (!allowed.has(c[0])) allowed.set(c[0], `ширины ${table}`)
        }
      }

      /**
       * ⭐ САМОПРОВЕРКА ПРАВИЛА. Сломайся `CYR_RUN` или разбор таблиц — множество
       * разрешённого осталось бы пустым, и проверка стала бы ЗЕЛЕНОЙ на пустом
       * месте, ничего не сравнивая. Поэтому сначала утверждается, что источники
       * прочитаны: болгарский эндоним на месте и строки ширин найдены.
       */
      if (!allowed.has('български')) problems.push('в разрешении нет болгарского эндонима — источник языков прочитан неверно, сравнивать не с чем')
      if (widthRows < 100) problems.push(`строк таблиц ширин найдено ${widthRows} — разбор labelEngine.ts сломан`)
      detail.push(`разрешение собрано из источников: ${allowed.size} фрагментов (${EU_LANGUAGES.length} эндонимов, ${widthRows} строк таблиц ширин)`)

      // ② Бандлы — ВСЕ, а не только те, что просят снимок движка.
      const astroDir = join(DIST, '_astro')
      let bundles = 0
      const unexplained: string[] = []
      if (!existsSync(astroDir)) {
        problems.push('в dist нет _astro — смотреть нечего')
      } else {
        for (const f of readdirSync(astroDir)) {
          if (!f.endsWith('.js')) continue
          bundles++
          // ⚠ Сборщик экранирует не-ASCII: в файле может лежать `б`, а не «б».
          const js = readFileSync(join(astroDir, f), 'utf8')
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
          const seen = new Set<string>()
          for (const m of js.matchAll(CYR_RUN)) if (!allowed.has(m[0])) seen.add(m[0])
          if (seen.size) unexplained.push(`${f}: ${[...seen].slice(0, 8).map((s) => `«${s}»`).join(', ')}`)
        }
      }
      if (unexplained.length) {
        problems.push(...unexplained.map((u) => `русское слово доехало до браузера — ${u}`))
      } else if (bundles) {
        detail.push(`бандлов просмотрено ${bundles} из ${bundles} — необъяснённой кириллицы нет ни в одном`)
      }

      // ③ HTML-комментарии: в выводе их быть не должно совсем.
      const pages = allPages()
      let withComments = 0
      let cyrChars = 0
      const worst: [number, string][] = []
      for (const { rel, html } of pages) {
        let n = 0
        for (const c of html.matchAll(/<!--[\s\S]*?-->/g)) {
          for (const run of c[0].matchAll(CYR_RUN)) n += run[0].length
        }
        if (n) { withComments++; cyrChars += n; worst.push([n, rel]) }
      }
      if (withComments) {
        worst.sort((a, b) => b[0] - a[0])
        problems.push(
          `русские HTML-комментарии уехали в браузер: ${withComments} страниц из ${pages.length}, ` +
          `${cyrChars} букв всего. Самые тяжёлые: ${worst.slice(0, 3).map(([n, r]) => `${r} (${n})`).join(', ')}`,
        )
        problems.push('лечение: в .astro комментарий пишется {/* ... *\/}, а не <!-- ... --> — второе есть разметка и попадает в вывод дословно')
      } else {
        detail.push(`страниц просмотрено ${pages.length} — ни одна не отдаёт русский комментарий`)
      }

      return {
        id: 'interface-language',
        group: 'Язык интерфейса',
        ok: problems.length === 0,
        headline: problems.length === 0
          ? `${bundles} бандлов и ${pages.length} страниц: посетителю едет только английский, кириллица только там, где её источник известен`
          : `${problems.length} мест, где посетитель увидел бы русский`,
        detail: problems.length === 0 ? detail : [...problems, ...detail].slice(0, 20),
      }
    },
  },
  {
    id: 'label-maker-href',
    group: 'Label maker',
    title: 'Все ссылки в конструктор разбираются его же разборщиком',
    run: async () => {
      // ⚠⚠ ЗАЧЕМ ЭТА ПРОВЕРКА ВООБЩЕ. Session 38: со всех 3 650 страниц веществ
      // стояла ссылка на ATE-калькулятор с `?cas=`, а калькулятор читал
      // `?substance=`. Ссылка вела на живую страницу, параметр был синтаксически
      // безупречен, сборка и все проверки зелёные — и калькулятор открывался
      // ПУСТЫМ. Такое ловится либо глазами на конкретной странице, либо здесь.
      // ⚠⚠ Список берётся ИЗ `labelMakerHub.ts`, а не собирается здесь заново.
      // С session 60 по нему решается ещё и то, куда возвращать человека со
      // страницы подбора, — вторая редакция такого списка стала бы дырой.
      const known = LABEL_MAKER_PATHS
      // ⚠ Ищем именно `href="…"`: строка `/ghs-label-maker/` встречается ещё и в
      // JSON-LD, и в текстах — разбирать их этим разборщиком бессмысленно.
      const re = /href="(\/ghs-label-maker\/[^"]*)"/g
      const bad = new Map<string, { problems: string[]; pages: Set<string> }>()
      let seen = 0
      const hrefs = new Set<string>()
      for (const { rel, html } of allPages()) {
        for (const m of html.matchAll(re)) {
          const href = unescapeHtml(m[1])
          seen++
          hrefs.add(href)
          const problems = labelMakerHrefProblems(href, known)
          // ⚠⚠ ФОРМУ CAS РАЗБОРЩИК НЕ ПРОВЕРЯЕТ, И ЭТО ПРАВИЛЬНО: в браузере
          // адрес пишет человек, и падать на опечатке нельзя. А вот в СОБРАННЫХ
          // страницах `?cas=` пишем МЫ, и склейка форм Annex VI там — дефект.
          // Замер session 52: на девяти страницах пиктограмм стояли адреса
          // `?cas=110-45-2%5B1%5D35073-27-` — конструктор открывался пустым.
          const rawCas = new URLSearchParams(href.split('#')[0].split('?')[1] ?? '').get('cas')
          if (rawCas && !casShapeOk(rawCas)) problems.push(`CAS не той формы: «${rawCas}»`)
          if (!problems.length) continue
          const got = bad.get(href)
          if (got) got.pages.add(rel)
          else bad.set(href, { problems, pages: new Set([rel]) })
        }
      }
      const detail: string[] = []
      for (const [href, v] of bad) {
        detail.push(`${href} — ${v.problems.join('; ')} (страниц: ${v.pages.size}, напр. ${[...v.pages][0]})`)
      }
      return {
        id: 'label-maker-href',
        group: 'Label maker',
        ok: bad.size === 0,
        headline:
          bad.size === 0
            ? `${seen} ссылок, ${hrefs.size} различных — все разобрались, ${known.length} известных страниц раздела`
            : `${bad.size} различных негодных адресов из ${hrefs.size}`,
        detail: bad.size === 0 ? [] : detail.slice(0, 20),
      }
    },
  },
  {
    id: 'label-maker-branch-roundtrip',
    group: 'Label maker',
    title: 'С ветки за веществом и обратно: настройки и сама ветка не теряются',
    run: async () => {
      // ⚠⚠⚠ ЧТО ИМЕННО ЛОВИТ ЭТА ПРОВЕРКА. Session 60, находка Сергея: человек
      // открывал `/ghs-label-maker/secondary-container-labels/`, шёл за
      // веществом, выбирал его — и возвращался на КОРЕНЬ раздела в режиме
      // OSHA-этикетки поставщика. Настройки ветки приходят в остров ПРОПАМИ, в
      // адресной строке их нет вовсе, а прежний код собирал адрес страницы
      // подбора только из адресной строки: копировать было нечего.
      //
      // ⚠⚠ НИ ОДНА ПРОВЕРКА ЭТОГО НЕ ВИДЕЛА, и увидеть не могла: таких адресов
      // в собранных страницах нет — их строит браузер в момент нажатия. Ради
      // проверяемости сборка адреса и вынесена из острова в `labelMakerLink.ts`;
      // здесь работает ТА ЖЕ функция, что и в браузере, а не её пересказ.
      const detail: string[] = []
      let good = 0

      for (const b of BRANCHES) {
        const base = `${LABEL_MAKER_BASE}${b.slug}/`
        // ⚠ Адресная строка ПУСТА — ровно так выглядит заход на ветку по ссылке.
        const href = pickHrefFor({
          search: '',
          base,
          defaults: { jurisdiction: b.jurisdiction, purpose: b.purpose },
        })
        const q = new URLSearchParams(href.split('?')[1] ?? '')
        const got = {
          jur: q.get(LM_PARAM.jurisdiction),
          purpose: q.get(LM_PARAM.purpose),
          back: readReturnBase(q, LABEL_MAKER_PATHS),
        }
        const want = { jur: b.jurisdiction, purpose: b.purpose, back: base }
        if (got.jur === want.jur && got.purpose === want.purpose && got.back === want.back) { good++; continue }
        detail.push(`${b.slug}: ждали ${JSON.stringify(want)}, вышло ${JSON.stringify(got)}`)
      }

      // ⭐⭐⭐ ДВА КОНТРОЛЯ С ПРОТИВОПОЛОЖНЫМ ОЖИДАНИЕМ, И ОБА ПЕЧАТАЮТСЯ ДО
      // ВЕРДИКТА. Проверка, умеющая только подтверждать, ничего не стоит: она
      // была бы так же зелена, если бы `readReturnBase` возвращала переданное
      // ей значение не глядя. Первый контроль требует, чтобы годный адрес
      // ПРОШЁЛ, второй — чтобы подделанный НЕ прошёл.
      const okSample = `${LABEL_MAKER_BASE}${BRANCHES[0].slug}/`
      const passes = readReturnBase(new URLSearchParams({ [LM_PARAM.from]: okSample }), LABEL_MAKER_PATHS) === okSample

      // ⚠⚠ Подделанный `from` — это открытый редирект с нашего домена: человек
      // видит ссылку на ghspictograms.com, а уезжает на чужой сайт. Каждый из
      // этих адресов обязан молча свернуться в корень раздела.
      const FORGED = [
        '//example.com/',
        'https://example.com/ghs-label-maker/',
        '/ghs-label-maker/../../elsewhere/',
        '/ghs-label-maker/no-such-branch/',
        '/ghs-label-maker/eu-clp/../../../etc/',
        '/some-other-section/',
      ]
      const leaked = FORGED.filter(
        (v) => readReturnBase(new URLSearchParams({ [LM_PARAM.from]: v }), LABEL_MAKER_PATHS) !== LABEL_MAKER_BASE,
      )

      const ok = detail.length === 0 && passes && leaked.length === 0
      const controls = [
        `контроль «годный адрес проходит»: ${passes ? 'да' : 'НЕТ'} (${okSample})`,
        `контроль «подделанный не проходит»: ${leaked.length === 0 ? `да, все ${FORGED.length} свернулись в корень` : `НЕТ, прошли: ${leaked.join(', ')}`}`,
      ]
      return {
        id: 'label-maker-branch-roundtrip',
        group: 'Label maker',
        ok,
        headline: ok
          ? `${good} веток из ${BRANCHES.length} возвращают человека на себя же, с их настройками`
          : `${detail.length} веток теряют настройки или ветку${passes && leaked.length === 0 ? '' : '; контроль не сошёлся'}`,
        detail: [...controls, ...detail.slice(0, 20)],
      }
    },
  },
  {
    id: 'label-maker-statements',
    group: 'Label maker',
    title: 'У каждой страницы H- и P-фразы есть контекстный вход в конструктор',
    run: async () => {
      // ⚠⚠ ПОРОГ НЕ КОНСТАНТА. Строка `/ghs-label-maker/` есть на ВСЕХ 4 499
      // страницах — её дают шапка и подвал, и именно это обмануло замер в
      // session 45. Порог берётся с заведомо «пустых» страниц; если шапка
      // поменяется, он поедет сам. ⚠ Их две, и они обязаны совпасть: если нет,
      // «пустая страница» перестала быть пустой, и проверка честно падает.
      const NEEDLE = '/ghs-label-maker/'
      const baselinePages = ['privacy/index.html', 'terms/index.html']
      const baselines = baselinePages.map((rel) => {
        const html = readPage(rel)
        return html === null ? null : countOccurrences(html, NEEDLE)
      })
      if (baselines.some((b) => b === null)) {
        return {
          id: 'label-maker-statements',
          group: 'Label maker',
          ok: false,
          headline: 'не из чего взять порог: нет одной из служебных страниц',
          detail: [`искали ${baselinePages.join(', ')} — порог берётся оттуда, а не цифрой в коде`],
        }
      }
      if (baselines[0] !== baselines[1]) {
        return {
          id: 'label-maker-statements',
          group: 'Label maker',
          ok: false,
          headline: `служебные страницы разошлись: ${baselinePages[0]} — ${baselines[0]}, ${baselinePages[1]} — ${baselines[1]}`,
          detail: [
            'Порог «сколько вхождений даёт одна навигация» больше не определён однозначно.',
            'Либо на одну из этих страниц добавили ссылку в конструктор, либо шапка/подвал',
            'рендерятся по-разному. Пока не сойдётся, проверка не может отличить',
            'контекстную ссылку от навигационной.',
          ],
        }
      }
      const nav = baselines[0] as number
      const empty: string[] = []
      let checked = 0
      for (const dir of ['h-statements', 'p-statements']) {
        for (const rel of [`${dir}/index.html`, ...pageSlugs(dir).map((s) => `${dir}/${s}/index.html`)]) {
          const html = readPage(rel)
          if (html === null) continue
          checked++
          if (countOccurrences(html, NEEDLE) <= nav) empty.push(rel)
        }
      }
      return {
        id: 'label-maker-statements',
        group: 'Label maker',
        ok: empty.length === 0 && checked > 0,
        headline:
          checked === 0
            ? 'ни одной страницы фраз в dist — сборка вернула пустой список'
            : empty.length === 0
              ? `${checked} страниц фраз, у каждой больше ${nav} вхождений (${nav} даёт навигация)`
              : `${empty.length} из ${checked} страниц без контекстной ссылки`,
        detail: empty.length ? [preview(empty, 20)] : [`порог ${nav} измерен по ${baselinePages.join(' и ')}`],
      }
    },
  },

  // ⚠⚠ У `label-maker-statements` ЕСТЬ СЛЕПАЯ ЗОНА, И ЭТА ПРОВЕРКА ЗАКРЫВАЕТ
  // ЕЁ КРАЙ. Ссылки, которые рисует React-остров, в `dist/*.html` не попадают:
  // их собирает браузер после гидратации. Значит вход в конструктор с
  // `/pictogram-selector/` и с ATE-калькулятора (пункты A2 и A3) не виден НИ
  // ОДНОЙ проверке, читающей разметку, — включая ту, что стоит выше.
  //
  // ⭐ Ищем в `dist/_astro/*.js` — там же, где `affiliate-subid` находит
  // партнёрские ссылки инструментов. Маркер — заголовок блока: он приходит из
  // `labelMakerCta.ts` строковым литералом и переживает минификацию.
  // ⚠ База адреса проверяется ОТДЕЛЬНО от заголовка: сборщик волен развести
  // `labelMakerCta` и `labelMakerLink` по разным кускам, и требование «оба
  // литерала в одном файле» падало бы на ровном месте.
  {
    id: 'label-maker-island-cta',
    group: 'Label maker',
    title: 'Блок-передача в конструктор доехал до бандлов селектора и ATE',
    run: async () => {
      // ⚠⚠ Бандл ищется по `component-url` НА САМОЙ СТРАНИЦЕ, а не по угаданному
      // имени файла — так же, как в `subs-deeplink-params` и `storage-tool`.
      // Разметка знает адрес своего острова точно; список имён в проверке был бы
      // вторым источником правды.
      const BASE = '/ghs-label-maker/'
      const BLOCKS: { page: string; island: string; title: string }[] = [
        { page: 'pictogram-selector/index.html', island: 'PictogramSelector', title: 'Now put it on a label' },
        {
          page: 'tools/ate-mixture-calculator/index.html',
          island: 'AteMixtureCalculator',
          title: 'Put this classification on a label',
        },
      ]
      assertAscii('label-maker-island-cta', [BASE, ...BLOCKS.map((b) => b.title)])

      const seen: string[] = []
      const problems: string[] = []

      for (const b of BLOCKS) {
        const html = readPage(b.page)
        if (html === null) {
          problems.push(`нет ${b.page} — страница инструмента не собралась`)
          continue
        }
        const m = html.match(new RegExp(`component-url="(/_astro/${b.island}\\.[A-Za-z0-9_-]+\\.js)"`))
        if (!m) {
          problems.push(
            `на ${b.page} нет component-url острова ${b.island}. Поправить карту BLOCKS, а не выключать ` +
              'проверку: без неё вход в конструктор с этой страницы не виден вообще ничему.',
          )
          continue
        }
        const entry = m[1].replace(/^\//, '')
        const entryText = existsSync(join(DIST, entry)) ? readFileSync(join(DIST, entry), 'utf8') : null
        if (entryText === null) {
          problems.push(`${entry} объявлен в разметке, но файла в dist нет`)
          continue
        }

        // Заголовок блока приходит из `labelMakerCta.ts` строковым литералом и
        // переживает минификацию. ⚠ Rollup волен вынести его в общий чанк — это
        // законно, поэтому ищем шире, но ГДЕ нашли, печатаем.
        const findIn = (needle: string): string | null => {
          if (entryText.includes(needle)) return entry
          const other = assetFiles().find((f) => f.text.includes(needle))
          return other ? `${other.name} (общий чанк, не входной)` : null
        }
        const whereTitle = findIn(b.title)
        const whereBase = findIn(BASE)
        if (!whereTitle) {
          problems.push(`${b.island}: заголовка блока «${b.title}» нет ни в ${entry}, ни в одном _astro/*.js`)
          continue
        }
        if (!whereBase) {
          problems.push(`${b.island}: базы ${BASE} нет ни в ${entry}, ни в одном _astro/*.js — ссылку строить нечем`)
          continue
        }
        seen.push(`${b.page}: блок в ${whereTitle}, база адреса в ${whereBase}`)
      }

      const ok = problems.length === 0
      return {
        id: 'label-maker-island-cta',
        group: 'Label maker',
        ok,
        headline: ok ? `${seen.length} блока доехали до бандлов инструментов` : `проблем: ${problems.length}`,
        detail: ok
          ? [...seen, 'в dist/*.html этих блоков нет вовсе — их рисует браузер, и разметочные проверки их не видят']
          : problems,
      }
    },
  },
  {
    /**
     * ⚠⚠ ЭТА ПРОВЕРКА ЗАВЕДЕНА ВМЕСТО ПРЕДУПРЕЖДЕНИЯ В ДОКУМЕНТЕ.
     *
     * Дефект «reaction mass of: A; B» был описан ДОСЛОВНО в
     * claude/substance-display-name-plan.md §3.3 — и всё равно приехал в базу и
     * прожил в проде до session 55. Документ не удерживает; удерживает проверка,
     * которая падает.
     *
     * ⭐⭐ СЧЁТ ПРИСУТСТВИЯ, БЕЗ ПОРОГА. Проверка вида «всё найденное верно» не
     * скажет, что искать было негде: если таблица переводов опустеет, проверка
     * без счёта останется зелёной. Поэтому ожидание — «каждая запись таблицы
     * лежит в базе на 23 языках», а число берётся из самой базы.
     *
     * ⚠ Второе направление не менее важно первого. Регламент правят, и в новой
     * редакции появится реакционная масса, которой в таблице нет. Признак тот
     * же, которым таблица выведена: двоеточие, вводящее список компонентов, не
     * меньше чем у 13 языковых редакций одной записи.
     */
    id: 'substance-name-composite',
    group: 'subs',
    title: 'Составная запись Annex VI — одно имя, а не имя плюс компонент',
    run: async () => {
      // ⚠⚠ Чтение таблицы — общее (`nameTranslations`), и ORDER BY живёт там же.
      // Разбор того, почему сортировка обязательна, записан в шапке загрузчика:
      // именно эта проверка на нём и споткнулась в session 55.
      const rows = await nameTranslations()
      const byIndex = await nameTranslationsByIndex()

      const problems: string[] = []
      const seen: string[] = []

      // ── 1. Записи таблицы: designations не больше объявленного ────────────
      let checkedRows = 0
      let missingEntries = 0
      for (const [index, head] of COMPOSITE_HEAD) {
        const langRows = byIndex.get(index)
        if (!langRows?.length) { missingEntries++; continue }
        for (const r of langRows) {
          checkedRows++
          const n = r.synonyms?.length ?? 0
          if (n > head) {
            problems.push(
              `${index} ${r.lang}: designations ${n}, а по таблице их ${head} — ` +
              `компонент смеси лежит отдельным именем: ${JSON.stringify(r.synonyms?.[head] ?? '')}`)
          }
        }
      }
      if (missingEntries) {
        problems.push(
          `записей таблицы нет в базе вовсе: ${missingEntries} — ` +
          'либо заливка не прошла, либо номер в таблице набран с опечаткой',
          `⚠ прочитано строк: ${rows.length}. Если их меньше, чем в таблице базы, ` +
          'дело не в номерах, а в постраничном чтении — см. комментарий про ORDER BY выше.')
      }

      // ── 2. Обратное направление: составная запись ВНЕ таблицы ─────────────
      /**
       * ⚠ Тот же признак, которым таблица выведена: двоеточие, вводящее список.
       * Ищется в куске имени, а не в ячейке целиком, — иначе двоеточие из
       * соседнего синонима считалось бы признаком этого.
       * ⚠⚠ Порог 13 языков взят из замеренного разрыва: записей с двоеточием
       * ровно у 12 языков нет ни одной, а ниже порога лежат опечатки редакции.
       */
      const LIST_COLON = /[^0-9]:[ \u00a0]+[^ \u00a0]/
      const NEW_COMPOSITE_MIN_LANGS = 13
      const strangers: string[] = []
      for (const [index, langRows] of byIndex) {
        if (COMPOSITE_HEAD.has(index)) continue
        const withColon = langRows.filter((r) => (r.synonyms ?? []).some((seg) => LIST_COLON.test(seg)))
        if (withColon.length >= NEW_COMPOSITE_MIN_LANGS) {
          strangers.push(`${index}: двоеточие-список у ${withColon.length} языков, в таблице записи нет`)
        }
      }
      if (strangers.length) {
        problems.push(...strangers)
        problems.push(
          'Так выглядит новая редакция Annex VI: реакционная масса, которой у нас ещё нет.',
          'Смотреть глазами и дописывать в COMPOSITE_HEAD в scripts/clp-name-annotations.mjs,',
          'а не подгонять порог.')
      }

      const langs = new Set(rows.map((r) => r.lang)).size
      seen.push(`таблица составных записей: ${COMPOSITE_HEAD.size} номеров, проверено строк ${checkedRows} на ${langs} языках`)
      seen.push(`всего строк переводов имён: ${rows.length}`)
      seen.push(`записей вне таблицы, у которых признак составной не сработал: ${byIndex.size - COMPOSITE_HEAD.size}`)

      const ok = problems.length === 0
      return {
        id: 'substance-name-composite',
        group: 'subs',
        ok,
        headline: ok
          ? `${COMPOSITE_HEAD.size} составных записей целы на ${langs} языках`
          : `проблем: ${problems.length}`,
        detail: ok ? seen : problems,
      }
    },
  },

  {
    /**
     * ⭐⭐ СЧЁТ ПРИСУТСТВИЯ, БЕЗ ПОРОГА. Блок имён на странице вещества — первое
     * место, где неанглийские имена попадают в отданный файл. Проверка вида
     * «всё напечатанное верно» промолчала бы о том, что печатать перестали
     * вовсе: пустая таблица, обрезанный список языков, потерянные обозначения —
     * всё это выглядит как ровная зелёная страница. Поэтому ожидание — «набор
     * языков блока равен набору языков этой записи в базе», и число берётся из
     * самой базы, на каждой из 3 650 страниц.
     *
     * ⚠ Сверка идёт В ОБЕ СТОРОНЫ. Лишний язык в блоке — такой же дефект, как
     * недостающий: он означает, что имя пришло не из строки этой записи.
     *
     * ⚠⚠ Имена сверяются ДОСЛОВНО, а не по числу строк. Ровно тут и живёт
     * ошибка, ради которой блок вообще проверяют: строка на месте, язык на
     * месте, а имя в ней — от соседней записи или склеено из кусков.
     */
    id: 'substance-name-languages',
    group: 'subs',
    title: 'Имя записи Annex VI по языковым редакциям: блок страницы сходится с базой в обе стороны',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('substance-name-languages', slugs)
      if (miss) return miss

      const exp = await substanceExpectation()
      const byIndex = await nameTranslationsByIndex()

      const ANCHOR = 'id="names"'
      const CELL = 'c-name'
      assertAscii('substance-name-languages', [ANCHOR, CELL])

      const noBlock: string[] = []
      const noRows: string[] = []
      const langsDiffer: string[] = []
      const nameMissing: string[] = []
      const ldDiffer: string[] = []
      let pagesWithBlock = 0
      let langCells = 0
      let namesChecked = 0
      let verbatimCells = 0

      for (const slug of slugs!) {
        const want = exp.bySlug.get(slug)
        // ⚠ Страница без строки базы — забота проверки subs-pages, не этой.
        if (!want) continue
        const html = readPage(join('substances', slug, 'index.html'))
        if (html === null) continue

        const index = want.row.index_number
        const expected = index ? buildOfficialNames(byIndex.get(index) ?? []) : []
        if (!expected.length) {
          // ⚠⚠ Ноль ожидаемых имён — это не «проверять нечего», а факт о базе,
          // и он называется поимённо: замер 2026-08-09 давал ноль таких страниц.
          noRows.push(`${slug} (index ${index ?? '—'})`)
          continue
        }

        const start = html.indexOf(ANCHOR)
        if (start < 0) { noBlock.push(slug); continue }
        const end = html.indexOf('</section>', start)
        const block = html.slice(start, end < 0 ? html.length : end)
        pagesWithBlock++

        // ⚠ Ячейки ищем разбором тегов, а не одной регуляркой по всей строке:
        // порядок атрибутов у сборщика — его дело, и завязываться на него значит
        // получить красную проверку от смены версии Astro, а не от дефекта.
        const langs: string[] = []
        for (const tag of block.match(/<td\b[^>]*>/g) ?? []) {
          if (!tag.includes(CELL)) continue
          const m = /lang="([a-zA-Z-]+)"/.exec(tag)
          langs.push((m?.[1] ?? '').toUpperCase())
        }
        langCells += langs.length

        const wantLangs = expected.map((n) => n.code)
        if (langs.join(',') !== wantLangs.join(',')) {
          const extra = langs.filter((l) => !wantLangs.includes(l))
          const lost = wantLangs.filter((l) => !langs.includes(l))
          langsDiffer.push(
            `${slug}: в блоке ${langs.length} языков, в базе ${wantLangs.length}` +
            (lost.length ? `, нет на странице: ${lost.join(' ')}` : '') +
            (extra.length ? `, лишние на странице: ${extra.join(' ')}` : '') +
            (!lost.length && !extra.length ? ' — набор тот же, а порядок разошёлся с порядком регламента' : ''),
          )
        }

        const text = unescapeHtml(block)
        for (const n of expected) {
          const wanted = n.verbatim ? [n.verbatim] : n.designations
          if (n.verbatim) verbatimCells++
          for (const value of wanted) {
            namesChecked++
            if (!text.includes(value)) {
              nameMissing.push(`${slug} ${n.code}: ${JSON.stringify(value.slice(0, 80))}`)
            }
          }
        }

        // ⚠⚠ Разметка обязана обещать ровно то, что видно на странице. Языковая
        // метка в `alternateName` — единственное, чем JSON-LD отличает имя из
        // регламента от торгового синонима PubChem; потеряется она — и поиск
        // прочтёт «Aceton» как английское написание.
        const ldBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? []
        const chem = ldBlocks.find((b) => b.includes('"ChemicalSubstance"'))
        const wantTags = expected
          .filter((n) => !n.verbatim && n.designations.length)
          .filter((n) => n.designations[0].toLowerCase() !== want.name.toLowerCase()).length
        const gotTags = chem ? countOccurrences(chem, '"@language"') : -1
        if (gotTags !== wantTags) {
          ldDiffer.push(`${slug}: языковых меток в JSON-LD ${gotTags}, имён из регламента ${wantTags}`)
        }
      }

      const problems: string[] = []
      if (noRows.length) {
        problems.push(
          `страниц, у записи которых в базе нет ни одной строки имени (${noRows.length}): ${preview(noRows)}. ` +
          'Либо заливка переводов не прошла, либо у страницы пуст index_number — ' +
          'а без него связать вещество с Annex VI нечем.',
        )
      }
      if (noBlock.length) {
        problems.push(
          `имена в базе есть, а блока на странице нет (${noBlock.length}): ${preview(noBlock)}. ` +
          `Маркер: ${ANCHOR}.`,
        )
      }
      if (langsDiffer.length) problems.push(`набор языков разошёлся (${langsDiffer.length}): ${preview(langsDiffer)}`)
      if (nameMissing.length) {
        problems.push(
          `имя из базы не найдено в блоке дословно (${nameMissing.length}): ${preview(nameMissing)}. ` +
          'Чаще всего это склейка обозначений своим разделителем: у греческой редакции ' +
          'разделитель — ано телия «·», и точка с запятой вместо неё печатает имя, ' +
          'которого в Annex VI нет.',
        )
      }
      if (ldDiffer.length) {
        problems.push(`языковых меток в JSON-LD не столько, сколько имён (${ldDiffer.length}): ${preview(ldDiffer)}`)
      }

      const ok = problems.length === 0
      return {
        id: 'substance-name-languages',
        group: 'subs',
        ok,
        headline: ok
          ? `${pagesWithBlock} страниц, ${langCells} языковых строк, ${namesChecked} имён сверено дословно`
          : `расхождений: ${problems.length}`,
        detail: ok
          ? [
              'ожидание берётся из базы на каждой странице отдельно, порога нет',
              'сверка идёт в обе стороны: язык базы → строка блока и строка блока → язык базы',
              `ячеек, показанных дословной ячейкой регламента (групповая или ненадёжная запись): ${verbatimCells}`,
              'имена собраны тем же buildOfficialNames, которым их печатает страница',
            ]
          : problems,
      }
    },
  },
  {
    /**
     * 105-я. ⭐⭐ ПОМЕТКА ОБ ОШИБКЕ САМОГО РЕГЛАМЕНТА СТОИТ РОВНО ТАМ, ГДЕ ДОЛЖНА.
     *
     * ⚠⚠ ЭТО НЕ ПРОВЕРКА НАШИХ ДАННЫХ. Все 29 свидетельств сверены с
     * первоисточником (`.tmp-eurlex/clp-consolidated-<lang>.html`): в регламенте
     * напечатано то же, что у нас в базе. Проверяется не имя, а ПРЕДУПРЕЖДЕНИЕ:
     * стоит ли оно у тех строк, у которых должно, и не стоит ли у прочих.
     *
     * ⚠⚠ СВЕРКА В ОБЕ СТОРОНЫ, как у 103-й. Лишняя пометка — такой же дефект,
     * как недостающая: она обвиняет регламент там, где он прав, а читатель
     * пойдёт искать ошибку, которой нет.
     *
     * ⭐⭐ ЧТО ОНА ЗНАЧИТ, КОГДА КРАСНЕЕТ. Список курируемый и сверен вручную,
     * поэтому её падение почти наверняка означает НЕ нашу поломку, а то, что
     * EUR-Lex выпустил новую консолидацию и набор ошибок изменился. Тогда
     * `annex6Errata.ts` пересматривается по первоисточнику, а не подгоняется
     * под страницу.
     */
    id: 'annex6-errata-flags',
    group: 'subs',
    title: 'Ошибки языковых редакций Annex VI: пометка стоит у помеченных строк и только у них',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('annex6-errata-flags', slugs)
      if (miss) return miss

      const exp = await substanceExpectation()
      const byIndex = await nameTranslationsByIndex()

      const MARK = 'name-erratum'
      assertAscii('annex6-errata-flags', [MARK])

      const noteMissing: string[] = []
      const citeMissing: string[] = []
      const markCountDiffers: string[] = []
      const tableNoteMissing: string[] = []
      const tableNoteExtra: string[] = []
      const langNotBuilt: string[] = []
      let pagesFlagged = 0
      let notesChecked = 0

      // ⚠ Записи списка, у которых страницы нет вовсе, называются отдельно:
      // молча пропустить их значило бы не заметить опечатку в index-номере.
      const builtIndexes = new Set<string>()

      for (const slug of slugs!) {
        const want = exp.bySlug.get(slug)
        if (!want) continue
        const index = want.row.index_number
        if (index) builtIndexes.add(index)

        const html = readPage(join('substances', slug, 'index.html'))
        if (html === null) continue

        const start = html.indexOf('id="names"')
        if (start < 0) continue
        const end = html.indexOf('</section>', start)
        const block = html.slice(start, end < 0 ? html.length : end)
        const text = unescapeHtml(block)

        // ⚠⚠ Ожидание считается ТЕМ ЖЕ кодом, что печатает страницу, и только
        // по языкам, реально попавшим в блок: редакции, которой у записи нет,
        // неоткуда взять и пометку.
        const printed = index ? buildOfficialNames(byIndex.get(index) ?? []) : []
        const wanted = printed
          .map((n) => ({ code: n.code, err: erratumFor(index ?? '', n.code) }))
          .filter((x) => x.err)

        // ⚠ Свидетельство есть, а редакции на странице нет — это не «нечего
        // проверять», а расхождение списка с базой.
        for (const code of erratumLanguages(index ?? '')) {
          if (!printed.some((n) => n.code === code)) {
            langNotBuilt.push(`${slug} (index ${index}): в списке есть ${code}, а строки этой редакции в блоке нет`)
          }
        }

        const marks = (block.match(new RegExp(MARK, 'g')) ?? []).length
        if (marks !== wanted.length) {
          markCountDiffers.push(`${slug}: пометок на странице ${marks}, ожидалось ${wanted.length}`)
        }
        if (wanted.length) pagesFlagged++

        // ⚠⚠ Текст свидетельства ищется ДОСЛОВНО. Считать пометки числом мало:
        // так у двух помеченных строк можно было бы напечатать одно и то же
        // объяснение, и общая фраза прошла бы проверку.
        for (const { code, err } of wanted) {
          notesChecked++
          if (!text.includes(err!.note)) {
            noteMissing.push(`${slug} ${code}: ${JSON.stringify(err!.note.slice(0, 60))}`)
          }
          // ⚠⚠ Ссылка на полосу ОЖ проверяется ТАК ЖЕ ДОСЛОВНО, как
          // свидетельство. Без неё пометка остаётся утверждением, которое
          // читателю негде проверить, — а мы обвиняем официальный текст.
          const cite = erratumCitation(err!)
          if (!text.includes(cite)) {
            citeMissing.push(`${slug} ${code}: ${JSON.stringify(cite)}`)
          }
        }

        const hasTableNote = text.includes(ERRATA_TABLE_NOTE)
        if (wanted.length && !hasTableNote) tableNoteMissing.push(slug)
        if (!wanted.length && hasTableNote) tableNoteExtra.push(slug)
      }

      const noPage = ERRATA_INDEX_NUMBERS.filter((i) => !builtIndexes.has(i))

      const problems: string[] = []
      if (markCountDiffers.length) {
        problems.push(`пометок не столько, сколько свидетельств (${markCountDiffers.length}): ${preview(markCountDiffers)}`)
      }
      if (noteMissing.length) {
        problems.push(`свидетельство не найдено на странице дословно (${noteMissing.length}): ${preview(noteMissing)}`)
      }
      if (citeMissing.length) {
        problems.push(`ссылка на полосу ОЖ не найдена дословно (${citeMissing.length}): ${preview(citeMissing)}`)
      }
      if (tableNoteMissing.length) {
        problems.push(`страница с пометкой без подписи под таблицей (${tableNoteMissing.length}): ${preview(tableNoteMissing)}`)
      }
      if (tableNoteExtra.length) {
        problems.push(`подпись под таблицей на странице без пометок (${tableNoteExtra.length}): ${preview(tableNoteExtra)}`)
      }
      if (langNotBuilt.length) {
        problems.push(`редакция из списка отсутствует в блоке (${langNotBuilt.length}): ${preview(langNotBuilt)}`)
      }

      const ok = problems.length === 0
      return {
        id: 'annex6-errata-flags',
        group: 'subs',
        ok,
        headline: ok
          ? `${pagesFlagged} страниц помечено, ${notesChecked} свидетельств и столько же ссылок на полосу ОЖ сверено дословно (в списке ${ERRATA_COUNT})`
          : `расхождений: ${problems.length}`,
        detail: ok
          ? [
              'сверка в обе стороны: свидетельство → пометка на странице и пометка → свидетельство',
              'ожидание считается тем же buildOfficialNames и тем же annex6Errata, что печатают страницу',
              `записей списка без построенной страницы: ${noPage.length}${noPage.length ? ' — ' + noPage.join(', ') : ''}`,
              'красная проверка означает скорее новую консолидацию EUR-Lex, чем нашу поломку',
            ]
          : problems,
      }
    },
  },
  {
    /**
     * Ошибки регламента ВНУТРИ строки Annex VI (session 76): напечатанный код
     * H-фразы не соответствует напечатанному классу той же строки. Шесть
     * записей, все — базовый текст 2008 года, одинаковы во всех 23 редакциях.
     *
     * ⚠⚠ ПРОВЕРЯЕТСЯ ТРИ ВЕЩИ, И КАЖДАЯ — В ОБЕ СТОРОНЫ:
     *   1. пометка стоит у шести страниц и ТОЛЬКО у них (лишняя пометка
     *      обвиняет регламент там, где он прав);
     *   2. свидетельство и ссылка на полосы ОЖ напечатаны ДОСЛОВНО;
     *   3. H-фразы в базе у этих записей — ровно `shownStatements` модуля.
     *      Иначе пометка «this page shows H260» начнёт врать в тот день, когда
     *      кто-то «поправит» базу по напечатанной колонке кодов.
     *
     * ⭐ ЧТО ЗНАЧИТ, КОГДА КРАСНЕЕТ. Если разошёлся пункт 3 — менялась база;
     * если 1–2 — страница или модуль. Новая консолидация EUR-Lex здесь менее
     * вероятна, чем у языковых ошибок: эти строки не трогал ни один ATP.
     */
    id: 'annex6-row-errata-flags',
    group: 'subs',
    title: 'Ошибки строк Annex VI (класс ≠ H-код): пометка у шести записей и только у них, база по классу',
    run: async () => {
      const slugs = builtSubstanceSlugs()
      const miss = substanceSectionMissing('annex6-row-errata-flags', slugs)
      if (miss) return miss

      const exp = await substanceExpectation()

      const MARK = 'row-erratum'
      assertAscii('annex6-row-errata-flags', [MARK])

      // ⚠ H-фразы базы — отдельным чтением: в общем ожидании их нет, а
      // тянуть 4 178 массивов ради шести строк незачем.
      type HRow = { index_number: string | null; h_statement_codes: string[] | null }
      const hRows = (must(
        'substances (row errata, h_statement_codes)',
        await supabase
          .from('substances')
          .select('index_number, h_statement_codes')
          .in('index_number', ROW_ERRATA_INDEX_NUMBERS),
      ) ?? []) as HRow[]
      const dbCodes = new Map(hRows.map((r) => [r.index_number ?? '', [...(r.h_statement_codes ?? [])].sort()]))

      const markCountDiffers: string[] = []
      const noteMissing: string[] = []
      const citeMissing: string[] = []
      const tableNoteMissing: string[] = []
      const tableNoteExtra: string[] = []
      const dbDiffers: string[] = []
      const builtIndexes = new Set<string>()
      let pagesFlagged = 0

      for (const slug of slugs!) {
        const want = exp.bySlug.get(slug)
        if (!want) continue
        const index = want.row.index_number
        if (index) builtIndexes.add(index)
        const err = rowErratumFor(index)

        const html = readPage(join('substances', slug, 'index.html'))
        if (html === null) continue

        // ⚠ Считаем по ВСЕЙ странице, а не по блоку: лишняя пометка в любом
        // месте — дефект, и искать её надо везде.
        const marks = (html.match(new RegExp(`hub-note warn ${MARK}`, 'g')) ?? []).length
        const wantMarks = err ? 1 : 0
        if (marks !== wantMarks) {
          markCountDiffers.push(`${slug}: пометок ${marks}, ожидалось ${wantMarks}`)
        }
        const text = unescapeHtml(html)
        const hasTableNote = text.includes(ROW_ERRATA_TABLE_NOTE)
        if (err && !hasTableNote) tableNoteMissing.push(slug)
        if (!err && hasTableNote) tableNoteExtra.push(slug)
        if (!err) continue

        pagesFlagged++
        // ⚠⚠ Заголовок, свидетельство и ссылка — ДОСЛОВНО, как у языковых ошибок.
        for (const piece of [ROW_ERRATUM_LEAD[err.kind], err.note]) {
          if (!text.includes(piece)) noteMissing.push(`${slug}: ${JSON.stringify(piece.slice(0, 60))}`)
        }
        const cite = rowErratumCitation(err)
        if (!text.includes(cite)) citeMissing.push(`${slug}: ${JSON.stringify(cite)}`)

        // ⚠⚠ База по классу: набор H-фраз записи равен `shownStatements`.
        const inDb = dbCodes.get(index ?? '') ?? []
        const shown = [...err.shownStatements].sort()
        if (inDb.join(' ') !== shown.join(' ')) {
          dbDiffers.push(`${slug} (index ${index}): в базе ${inDb.join(' ') || '—'}, модуль ожидает ${shown.join(' ')}`)
        }
      }

      const noPage = ROW_ERRATA_INDEX_NUMBERS.filter((i) => !builtIndexes.has(i))

      const problems: string[] = []
      if (markCountDiffers.length) {
        problems.push(`пометок не столько, сколько свидетельств (${markCountDiffers.length}): ${preview(markCountDiffers)}`)
      }
      if (noteMissing.length) {
        problems.push(`свидетельство не найдено на странице дословно (${noteMissing.length}): ${preview(noteMissing)}`)
      }
      if (citeMissing.length) {
        problems.push(`ссылка на полосы ОЖ не найдена дословно (${citeMissing.length}): ${preview(citeMissing)}`)
      }
      if (tableNoteMissing.length) {
        problems.push(`страница с пометкой без подписи под таблицей (${tableNoteMissing.length}): ${preview(tableNoteMissing)}`)
      }
      if (tableNoteExtra.length) {
        problems.push(`подпись под таблицей на странице без пометки (${tableNoteExtra.length}): ${preview(tableNoteExtra)}`)
      }
      if (dbDiffers.length) {
        problems.push(`H-фразы в базе не равны shownStatements модуля (${dbDiffers.length}): ${preview(dbDiffers)}`)
      }
      // ⚠ Запись без страницы — НЕ провал, а строка отчёта (как у языковых
      // ошибок): 609-010-00-5 «salts of picric acid» не имеет CAS («—»), и
      // страницы у неё нет по правилу отбора. Пометка ждёт свою страницу.

      const ok = problems.length === 0
      return {
        id: 'annex6-row-errata-flags',
        group: 'subs',
        ok,
        headline: ok
          ? `${pagesFlagged} страниц помечено из ${ROW_ERRATA_COUNT} в списке; свидетельства, ссылки на полосы ОЖ и H-фразы базы сверены`
          : `расхождений: ${problems.length}`,
        detail: ok
          ? [
              'сверка в обе стороны: свидетельство → пометка на странице и пометка → свидетельство',
              'H-фразы базы у шести записей равны shownStatements модуля — база ведётся по классу, а не по напечатанному коду',
              'ожидание считается тем же annex6RowErrata, что печатает страницу',
              `записей списка без построенной страницы: ${noPage.length}${noPage.length ? ' — ' + noPage.join(', ') + ' (нет CAS — нет страницы)' : ''}`,
            ]
          : problems,
      }
    },
  },

  // ───────────────────────── /hazard-classes/ ─────────────────────────
  {
    id: 'hazard-classes-pcodes',
    group: 'Hazard classes',
    title: 'Число P-кодов у каждой категории на /hazard-classes/ равно clp_matrix_full',
    run: async () => {
      // ⚠⚠ Зачем проверка. Session 76: в матрицу добавились 54 строки классов
      // 2023/707, стало 1 036 — и страница молча потеряла последние 36: запрос
      // `range(0, 4999)` одним куском, а PostgREST отдаёт не больше 1 000.
      // Сборка зелёная, 112 проверок зелёные, на проде «4 P-codes» вместо 9.
      // Увидел Сергей на скриншоте. Теперь число в каждой строке сверяется с
      // базой, а базу читаем тем же постраничным selectAll.
      const matrix = await selectAll<{ class_code: string; category_code: string; p_code: string | null }>(
        'clp_matrix_full',
        'class_code, category_code, p_code',
        (q: any) => q.not('p_code', 'is', null).order('class_code').order('category_code').order('p_code'),
      )
      assertNonEmpty('hazard-classes-pcodes', 'clp_matrix_full', matrix)
      // ⚠ Ожидание считается ТЕМ ЖЕ мостом, что печатает страницу: матрица
      // именует категории по Annex IV, реестр — по Annex I. Первый прогон этой
      // проверки без моста показал 21 ключ матрицы без строки на странице —
      // и это были не лишние ключи, а 21 строка с ложным «none» на проде.
      const expected = new Map<string, Set<string>>()
      for (const r of matrix) {
        for (const cat of matrixToMappingCategories(r.class_code, r.category_code)) {
          const key = `${r.class_code}|${cat}`
          const set = expected.get(key)
          if (set) set.add(r.p_code!)
          else expected.set(key, new Set([r.p_code!]))
        }
      }
      // Обратную сторону сверяем только по категориям, которые страница печатает:
      // not_in_clp (Skin Irrit. 3, Eye Irrit. 2B…) на странице нет по правилу.
      const mappingRows = await selectAll<{ category_code: string; clp_status: string | null; hazard_class_catalog: { class_code: string } | null }>(
        'hazard_category_mapping',
        'category_code, clp_status, hazard_class_catalog(class_code)',
      )
      assertNonEmpty('hazard-classes-pcodes', 'hazard_category_mapping', mappingRows)
      const known = new Set(
        mappingRows.filter((r) => r.hazard_class_catalog).map((r) => `${r.hazard_class_catalog!.class_code}|${r.category_code}`),
      )
      const printed = new Set(
        mappingRows
          .filter((r) => r.clp_status !== 'not_in_clp' && r.hazard_class_catalog)
          .map((r) => `${r.hazard_class_catalog!.class_code}|${r.category_code}`),
      )

      const html = readPage('hazard-classes/index.html')
      if (html === null) {
        return { id: 'hazard-classes-pcodes', group: 'Hazard classes', ok: false, headline: 'нет hazard-classes/index.html', detail: [] }
      }
      const rows = [...html.matchAll(/<tr data-cat="([^"]*)" data-cls="([^"]*)" data-pn="(\d+)"/g)]
      if (rows.length === 0) {
        return {
          id: 'hazard-classes-pcodes',
          group: 'Hazard classes',
          ok: false,
          headline: 'на странице нет ни одной строки с маркером data-pn',
          detail: ['маркер: <tr data-cat data-cls data-pn> — страница собрана старым кодом?'],
        }
      }

      const problems: string[] = []
      const seen = new Set<string>()
      for (const m of rows) {
        const [, cat, cls, pn] = m
        const key = `${cls}|${cat}`
        seen.add(key)
        const want = expected.get(key)?.size ?? 0
        if (Number(pn) !== want) problems.push(`${cls} ${cat}: на странице ${pn} P-кодов, база ожидает ${want}`)
      }
      // Обратная сторона: категория с P-кодами в базе, которой на странице нет
      // вовсе. Категории not_in_clp страница не печатает — у них и P-кодов в
      // матрице быть не должно; если появятся, это тоже расхождение.
      for (const [key, set] of expected) {
        if (!known.has(key)) {
          problems.push(`${key.replace('|', ' ')}: в матрице ${set.size} P-кодов, а в реестре такой категории нет — мост matrixCategoryBridge не знает её`)
          continue
        }
        if (!printed.has(key)) continue // not_in_clp — страница не печатает по правилу
        if (!seen.has(key)) problems.push(`${key.replace('|', ' ')}: в базе ${set.size} P-кодов, на странице строки нет`)
      }

      const total = [...expected.values()].reduce((n, s) => n + s.size, 0)
      const ok = problems.length === 0
      return {
        id: 'hazard-classes-pcodes',
        group: 'Hazard classes',
        ok,
        headline: ok
          ? `${rows.length} строк категорий, ${total} связок «категория ↔ P-код» сошлись с базой`
          : `расхождений: ${problems.length}`,
        detail: ok
          ? [
              'маркер: <tr data-cat data-cls data-pn>; база читается постранично по 1 000 (selectAll)',
              'категории матрицы (Annex IV) переведены в категории реестра мостом matrixCategoryBridge — тем же, что у страницы',
              `строк матрицы в базе: ${matrix.length}`,
              'сверка в обе стороны: строка страницы → база и ключ базы → строка страницы',
            ]
          : problems.slice(0, 30),
      }
    },
  },

  /**
   * ⭐⭐⭐ №122 — МАРКЕРНЫЙ СТОРОЖ СТРАНИЦЫ КЛАССИФИКАТОРА (session 82).
   *
   * Заведён после главного дефекта session 81: инструкция «How to use», весь
   * дисклеймер и четыре исходящие ссылки ОТСУТСТВОВАЛИ в собранном HTML при
   * полностью зелёном прогоне. Astro рендерит остров на сборке ровно один раз,
   * в НАЧАЛЬНОМ состоянии: всё, что стояло за `{helpOpen && …}` и
   * `{result && …}`, в `dist/` не попадало вовсе. Нашлось живым запросом к
   * проду, а не проверкой.
   *
   * ⚠⚠ Ни одна из 114 проверок этого не искала — и это не их изъян: они
   * сверяют НАПЕЧАТАННОЕ с базой, а про пропущенный текст им никто не сказал,
   * что он обязателен. Список ниже и есть то самое объявление: пока кусок
   * назван здесь поимённо, «пропало из HTML» краснеет на сборке, а не
   * обнаруживается через неделю на проде.
   *
   * ⚠ Маркеры взяты БЕЗ разметки: `<b>` внутри абзаца рвёт подстроку, а JSX
   * склеивает перенос строки с отступом в один пробел. Ищем ровно тот текст,
   * который в HTML лежит одним куском.
   */
  {
    id: 'classifier-page',
    group: 'Classifier',
    title: 'Страница классификатора несёт инструкцию, дисклеймер и четыре исходящие ссылки',
    run: async () => {
      const rel = 'tools/clp-mixture-classifier/index.html'
      const html = readPage(rel)
      if (!html) {
        return { id: 'classifier-page', group: 'Classifier', ok: false, headline: `нет ${rel}`, detail: [] }
      }

      // Раскрытие инструкции — нативный <details>, поэтому его содержимое
      // обязано быть в HTML независимо от гидратации.
      const HELP = ['How to use this calculator', '6 steps']
      // Шесть шагов — по жирному началу каждого пункта.
      const STEPS = [
        'Add every ingredient.',
        'Enter each concentration.',
        'Say what you know about ingredients without data.',
        'Set the mixture properties.',
        'Read the result.',
        'Keep the record.',
      ]
      // Дисклеймер: заголовок и та строка, ради которой он вообще стоит.
      const DISCLAIMER = [
        'read before you use any result from this tool',
        'Article 4 of Regulation (EC) No 1272/2008',
      ]
      // Четыре ссылки — межстраничная сетка, ради неё блок и вынесен из ветки результата.
      const LINKS = [
        'href="/tools/ate-mixture-calculator/"',
        'href="/ghs-label-maker/"',
        'href="/sds-sections/section-2-hazards-identification/"',
        'href="/hazard-classes/"',
      ]
      // Честность выдачи: раздел «The contract» и формула, которой помечены
      // непосчитанные классы. Пустая ячейка читается как «неопасно» (урок s76).
      const HONESTY = ['The contract', 'not computed in this version']
      // ⭐⭐ Печатный отчёт (№118, s84). Кнопки живут В ВЕТКЕ РЕЗУЛЬТАТА, значит
      // в собранном HTML их нет и быть не может — сторожится ОБЕЩАНИЕ отчёта:
      // шаг 6 инструкции и абзац «What you get today». Обещание, пережившее
      // удаление возможности, — ровно тот дефект, ради которого заведена эта
      // проверка (s81: элемент обещал содержимое и не давал его).
      const REPORT = [
        'Full report',
        'Download PDF',
        'Share link',
        'A printable report of the whole calculation',
      ]

      const groups: [string, string[]][] = [
        ['инструкция', HELP],
        ['шаги инструкции', STEPS],
        ['дисклеймер', DISCLAIMER],
        ['исходящие ссылки', LINKS],
        ['контракт версии', HONESTY],
        ['печатный отчёт', REPORT],
      ]
      const all = groups.flatMap(([, markers]) => markers)
      assertAscii('classifier-page', all)

      const detail: string[] = []
      let missing = 0
      for (const [name, markers] of groups) {
        const gone = markers.filter((m) => !html.includes(m))
        if (gone.length) {
          missing += gone.length
          detail.push(`${name}: нет в HTML (${gone.length}) — ${gone.join(' | ')}`)
        }
      }

      // Остров и его бандл — тем же приёмом, что `storage-tool`: ссылка на
      // отсутствующий файл означает живую вёрстку и мёртвый расчёт.
      const island = html.match(/component-url="(\/_astro\/MixtureClassifier\.[A-Za-z0-9_-]+\.js)"/)
      let bundle = ''
      if (!island) {
        missing++
        detail.push('остров: на странице нет <astro-island> с MixtureClassifier')
      } else {
        bundle = island[1].replace(/^\//, '')
        if (!existsSync(join(DIST, bundle))) {
          missing++
          detail.push(`остров: бандл ${bundle} — ФАЙЛА НЕТ`)
        }
      }

      const ok = missing === 0
      return {
        id: 'classifier-page',
        group: 'Classifier',
        ok,
        headline: ok
          ? `${all.length} обязательных маркеров на месте, остров и бандл существуют`
          : `не хватает ${missing}`,
        detail: ok
          ? [
              `${STEPS.length} шагов инструкции — нативный <details>, а не состояние React`,
              'дисклеймер и Related tools стоят ВНЕ ветки результата: иначе их нет в собранном HTML',
              `бандл острова: ${bundle}`,
              'заведено в s82 после дефекта s81: зелёный чек-лист не видит того, чего в HTML нет',
            ]
          : detail,
      }
    },
  },

  /**
   * ⭐⭐⭐ СЧЁТЧИК ИНСТРУМЕНТОВ — СПЛОШНОЙ ОБХОД, А НЕ СПИСОК МЕСТ (session 82).
   *
   * Число «сколько у нас инструментов» напечатано на сайте ШЕСТЬ раз: дважды на
   * главной (подзаголовок секции и ссылка «All N tools»), дважды на `/tools/`
   * (чип шапки и meta description) и ещё дважды в ОБЩИХ компонентах — панель
   * `SiteHeader` и колонка `SiteFooter`, то есть на каждой из 4 510 страниц.
   *
   * ⚠⚠⚠ ПЕРВАЯ ВЕРСИЯ ЭТОЙ ПРОВЕРКИ БЫЛА ХУЖЕ, ЧЕМ НИЧЕГО. Она перечисляла
   * четыре места, которые автор помнил, и внутри страницы брала ПЕРВОЕ
   * совпадение регулярки. Правки s82 поставили «15» первым — и проверка
   * отрапортовала «все четыре места говорят 15», пока в шапке и подвале той же
   * страницы стояло «14». Она подтвердила ожидание автора, а не факт, и дала
   * ложное спокойствие вместо тревоги. Нашлось грепом по `dist/` руками.
   *
   * Отсюда устройство второй версии: **найти ВСЕ вхождения и потребовать, чтобы
   * они совпали**. Список мест в голове проверяющего — не источник истины;
   * источник — собранный HTML.
   *
   * ⚠ Проверка НЕ знает, сколько инструментов «на самом деле», и знать не
   * должна: подсчёт карточек хаба был бы вторым источником истины и разошёлся
   * бы с замыслом (девять калькуляторов по пиктограммам — это один пункт или
   * девять? решение человека). Она сторожит РОВНО ОДНО: чтобы все напечатанные
   * числа были одним числом.
   */
  {
    id: 'tools-counter',
    group: 'Tools',
    title: 'Все напечатанные счётчики инструментов называют одно число',
    run: async () => {
      // Обе страницы несут общие шапку и подвал, поэтому двух достаточно,
      // чтобы увидеть и собственные счётчики страниц, и счётчики компонентов.
      const PAGES = ['index.html', 'tools/index.html']
      // «15 free tools», «All 15 tools», «15 tools», «15 free online GHS compliance tools».
      const RE = /(\d+)\s+(?:free\s+)?(?:online\s+GHS\s+compliance\s+)?tools\b/g

      const hits: { page: string; n: string; context: string }[] = []
      for (const rel of PAGES) {
        const html = readPage(rel)
        if (!html) {
          return { id: 'tools-counter', group: 'Tools', ok: false, headline: `нет ${rel}`, detail: [] }
        }
        // ⚠ Экземпляр регулярки создаётся заново на каждую страницу: у /g есть
        // lastIndex, и общий экземпляр терял бы совпадения через одно.
        const re = new RegExp(RE.source, 'g')
        for (const m of html.matchAll(re)) {
          const at = m.index ?? 0
          hits.push({
            page: rel,
            n: m[1],
            // Текст вокруг — чтобы красная проверка САМА называла место,
            // а не отправляла человека искать его грепом.
            context: html.slice(Math.max(0, at - 60), at + m[0].length + 20).replace(/\s+/g, ' ').trim(),
          })
        }
      }

      const values = [...new Set(hits.map((h) => h.n))]
      // Меньше четырёх — значит формулировку переписали и обход больше не видит
      // тех мест, ради которых заведён. Это тоже расхождение.
      const ok = hits.length >= 4 && values.length === 1
      return {
        id: 'tools-counter',
        group: 'Tools',
        ok,
        headline: ok
          ? `${hits.length} вхождений на ${PAGES.length} страницах, все говорят «${values[0]}»`
          : values.length > 1
            ? `счётчики разошлись: ${values.join(' / ')}`
            : `найдено только ${hits.length} вхождений — изменилась формулировка?`,
        detail: ok
          ? [
              'обход сплошной: ищутся ВСЕ вхождения «N tools», а не заранее перечисленные места',
              'шапка и подвал общие — их счётчики стоят на каждой из страниц сайта',
              ...hits.map((h) => `${h.page}: ${h.context}`),
            ]
          : hits.map((h) => `${h.page}: [${h.n}] ${h.context}`),
      }
    },
  },

  /**
   * ⭐⭐⭐ ВИТРИНА КЛАССИФИКАТОРА НА ГЛАВНОЙ СВЕРЯЕТСЯ С РЕЕСТРОМ МОДУЛЕЙ (s83).
   *
   * Карточка на главной печатает выдержку настоящего ответа движка: две строки
   * посчитанных классов и одну — непосчитанного («витрина обязана показывать и
   * неудачное», урок s76/s82). Обе половины стареют по-разному и обе — молча:
   * в s82 третьей строкой стояла аспирация, в s83 движок её посчитал, и главная
   * страница сайта начала занижать собственный инструмент. Ни одна зелёная
   * проверка этого не увидела — нашлось чтением файла руками.
   *
   * ⚠ Поэтому проверка НЕ перечисляет ожидаемые классы (это подтверждало бы
   * ожидание автора, а не факт — главный урок s82). Она читает `data-class`
   * каждой строки витрины и спрашивает у САМИХ МОДУЛЕЙ, считается этот класс
   * или нет: строка с пометкой `off` обязана называть НЕпосчитанный класс,
   * строка без пометки — посчитанный. Плюс обе половины должны быть на месте.
   */
  {
    id: 'classifier-showcase',
    group: 'Classifier',
    title: 'Витрина классификатора на главной согласована с реестром модулей',
    run: async () => {
      const rel = 'index.html'
      const html = readPage(rel)
      if (!html) {
        return { id: 'classifier-showcase', group: 'Classifier', ok: false, headline: `нет ${rel}`, detail: [] }
      }

      const computed = new Set<string>([
        ...acuteToxModule.classes,
        ...CUTOFF_PLANS.map((p) => p.classCode),
      ])

      // Сплошной обход, а не список мест: ищутся ВСЕ строки витрины.
      const RE = /<div class="(hp-class-row[^"]*)"[^>]*data-class="([A-Za-z0-9_]+)"/g
      const rows: { off: boolean; code: string; label: string }[] = []
      for (const m of html.matchAll(RE)) {
        const at = m.index ?? 0
        rows.push({
          off: m[1].split(/\s+/).includes('off'),
          code: m[2],
          // Текст вокруг — чтобы красная проверка САМА называла место.
          label: html.slice(at, at + 260).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90),
        })
      }

      const wrongOff = rows.filter((r) => r.off && computed.has(r.code))
      const wrongOn = rows.filter((r) => !r.off && !computed.has(r.code))
      const offCount = rows.filter((r) => r.off).length
      const onCount = rows.length - offCount

      const problems: string[] = []
      if (!rows.length) problems.push('строк витрины не найдено — изменилась разметка или пропал data-class')
      if (rows.length && !offCount) problems.push('в витрине не осталось строки про НЕпосчитанный класс — она показывает только удачное')
      if (rows.length && !onCount) problems.push('в витрине не осталось ни одной посчитанной строки')
      for (const r of wrongOff) problems.push(`строка «not computed» называет класс ${r.code}, который движок УЖЕ считает: ${r.label}`)
      for (const r of wrongOn) problems.push(`строка результата называет класс ${r.code}, которого движок НЕ считает: ${r.label}`)

      const ok = problems.length === 0
      return {
        id: 'classifier-showcase',
        group: 'Classifier',
        ok,
        headline: ok
          ? `${rows.length} строк витрины: ${onCount} посчитанных, ${offCount} непосчитанных — все согласованы с ${computed.size} классами модулей`
          : problems[0],
        detail: ok
          ? [
              'принадлежность класса берётся из реестра модулей, а не из списка в проверке',
              ...rows.map((r) => `${r.off ? 'not computed' : 'computed  '} · ${r.code} · ${r.label}`),
            ]
          : problems,
      }
    },
  },

  /**
   * ⭐⭐⭐ №113 — СЕКРЕТ В БАНДЛЕ (session 81).
   *
   * До этой проверки правило «service-ключ живёт только в
   * `functions/api/classify/_shared.ts`» держалось на одном грепе, который надо
   * не забыть повторить: «из `src/` этот файл никто не импортирует». Греп —
   * не сторож. Один `import` ради удобства в островe — и ключ, дающий полный
   * обход RLS на все 70 таблиц, уезжает в `dist/_astro/*.js` и читается по
   * Ctrl+U. Отменить такую утечку нельзя: ключ придётся ротировать.
   *
   * ⚠ Ищем ТРИ разные вещи, потому что утечь может каждая по-своему:
   *   1. имя переменной (`SUPABASE_SERVICE_ROLE_KEY`) и слово `service_role` —
   *      так выглядит сборка, затянувшая `_shared.ts` или `supabaseServer.ts`;
   *   2. САМ КЛЮЧ: JWT, в чьём payload стоит `"role":"service_role"`. Слова
   *      `service_role` в бандле при этом НЕТ — оно внутри base64. Проверка,
   *      которая ищет только подстроку, такую утечку не увидит;
   *   3. новый формат ключей Supabase (`sb_secret_…`) — у него ни JWT, ни слова.
   *
   * ⚠ Обходим ВЕСЬ dist, а не только html и `_astro/*.js`: секрет может осесть
   * в json, xml, `.map` или манифесте. Двоичные расширения пропускаем по списку.
   *
   * ⚠ Анонимный ключ — это НЕ находка: он публичен по устройству и лежит в
   * бандле законно. Поэтому JWT разбираются, а не считаются скопом: красным
   * становится только `service_role`.
   */
  {
    id: 'no-service-key-in-dist',
    group: 'Секреты',
    title: 'service-ключ Supabase не попал в собранный сайт',
    run: async () => {
      const TEXT_EXT = ['.html', '.js', '.mjs', '.cjs', '.json', '.txt', '.xml', '.css', '.map', '.webmanifest', '.svg']

      // ⚠⚠ Файлы НЕ копятся в массив: в dist больше четырёх тысяч страниц, и
      // сложить их тексты в память означало бы съесть гигабайты ради поиска
      // подстроки. Каждый файл читается, проверяется и отпускается.
      const hits: string[] = []
      let files = 0
      let jwtSeen = 0
      const rolesSeen = new Set<string>()

      // base64url payload JWT: разбираем и смотрим роль.
      // ⚠ `atob` в Node 22 есть; padding base64url восстанавливаем вручную.
      const roleOf = (payload: string): string | null => {
        try {
          const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
          const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
          const role = /"role"\s*:\s*"([^"]+)"/.exec(json)
          return role ? role[1] : null
        } catch { return null }
      }

      const scan = (rel: string, text: string): void => {
        for (const needle of ['SUPABASE_SERVICE_ROLE_KEY', 'service_role']) {
          if (text.includes(needle)) hits.push(`${rel}: строка ${needle}`)
        }
        // ⚠ Регулярка создаётся на каждый файл: у /g есть lastIndex, и общий
        // экземпляр между файлами терял бы совпадения через одно.
        for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
          jwtSeen++
          const role = roleOf(m[1])
          if (role === 'service_role') hits.push(`${rel}: JWT с ролью service_role`)
          else if (role) rolesSeen.add(role)
        }
        if (/\bsb_secret_[A-Za-z0-9_-]{8,}/.test(text)) hits.push(`${rel}: ключ формата sb_secret_…`)
      }

      const walk = (dir: string, prefix: string): void => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) { walk(join(dir, e.name), `${prefix}${e.name}/`); continue }
          if (!TEXT_EXT.some((x) => e.name.toLowerCase().endsWith(x))) continue
          files++
          scan(`${prefix}${e.name}`, readFileSync(join(dir, e.name), 'utf8'))
        }
      }
      walk(DIST, '')

      const ok = hits.length === 0
      return {
        id: 'no-service-key-in-dist',
        group: 'Секреты',
        ok,
        headline: ok
          ? `чисто: ${files} текстовых файлов dist, ${jwtSeen} JWT — роли ${[...rolesSeen].sort().join(', ') || 'нет'}`
          : `⛔ НАЙДЕН СЕКРЕТ В dist (${hits.length}) — не деплоить, ключ ротировать`,
        detail: ok
          ? [
              'ищем: строку SUPABASE_SERVICE_ROLE_KEY, слово service_role, JWT с "role":"service_role", ключ sb_secret_…',
              'анонимный ключ находкой не считается: он публичен по устройству',
              'правило, которое это сторожит: service-ключ живёт только в functions/api/classify/_shared.ts и в бандл сайта не собирается',
            ]
          : [...new Set(hits)].slice(0, 30),
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
