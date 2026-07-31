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
import { hSlug } from '../src/lib/hStatementSlug'

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
  first_aid: string | null
  fire_haz: string | null
  fire_fight: string | null
  non_fire_resp: string | null
}

let sdsCache: { pages: SdsPage[]; byCas: Map<string, Response> } | null = null

/** Ровно тот же срез, что берёт getStaticPaths страницы: status = 'live'. */
async function sdsData() {
  if (sdsCache) return sdsCache
  const pages = await selectAll<SdsPage>('sds_pages', 'slug, cas_number', (q) => q.eq('status', 'live'))
  const resp = await selectAll<Response>(
    'substance_response',
    'cas_number, first_aid, fire_haz, fire_fight, non_fire_resp',
  )
  const byCas = new Map(resp.map((r) => [r.cas_number, r]))
  sdsCache = { pages, byCas }
  return sdsCache
}

/** Слаги live-страниц, у которых выполняется предикат по substance_response. */
async function sdsSlugsWhere(pred: (r: Response | undefined) => boolean): Promise<Set<string>> {
  const { pages, byCas } = await sdsData()
  return new Set(pages.filter((p) => pred(p.cas_number ? byCas.get(p.cas_number) : undefined)).map((p) => p.slug))
}

const has = (v: string | null | undefined) => typeof v === 'string' && v.trim().length > 0

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
