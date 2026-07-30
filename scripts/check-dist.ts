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
