/**
 * Заливка имён веществ Annex VI на языки ЕС в substance_name_translations.
 *
 * Запуск из корня ghspictograms:
 *   npx tsx scripts/import-substance-names.ts
 *   npx tsx scripts/import-substance-names.ts --dry        (ничего не пишет)
 *   npx tsx scripts/import-substance-names.ts --only de,fr
 *
 * Требуется .env.local: PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.
 * Вход: .tmp-eurlex/parsed-<lang>.json от scripts/parse-clp-language.mjs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠⚠ ЭТО НЕ ПЕРЕВОДЫ. Имена напечатаны в самом регламенте, в языковых версиях
 * Annex VI, и берутся оттуда как есть. Машинному переводу здесь места нет: имя
 * вещества на этикетке — обязательный элемент с установленной редакцией.
 *
 * ⚠ Ирландского нет и не будет: консолидированного CLP на ирландском не
 * существует, все адреса CELLAR отдают 404. 23 языка, не 24.
 *
 * ⚠⚠ Юридически аутентичен только текст в электронном Official Journal
 * (Reg. 216/2013, Art. 1(2)). Лицензия — Commission Decision 2011/833/EU,
 * указание источника есть условие лицензии, а не вежливость.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⭐⭐ ЧТО СКРИПТ ОБЯЗАН НАПЕЧАТАТЬ, ДАЖЕ ЕСЛИ ВСЁ ХОРОШО: сколько веществ ИЗ
 * НАШЕЙ таблицы `substances` получили имя на каждом языке. Число строк в файле
 * об этом не говорит ничего — регламент шире нашего справочника, и заливка
 * может пройти «успешно», не покрыв половины сайта.
 */
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

config({ path: resolve(process.cwd(), '.env.local') })
config()

const SOURCE_REF = 'CELEX:02008R1272-20260501 / Annex VI'
const BATCH = 500

const ARGV = process.argv.slice(2)
const DRY = ARGV.includes('--dry')
const ONLY = (() => {
  const i = ARGV.indexOf('--only')
  return i >= 0 && ARGV[i + 1] ? ARGV[i + 1].split(',').map((s) => s.trim().toLowerCase()) : null
})()

/**
 * 23 языка. ⚠ Ирландского (`ga`) в списке нет намеренно — см. шапку файла.
 * Порядок тот, в котором их печатает регламент.
 */
const LANGS = ['bg', 'es', 'cs', 'da', 'de', 'et', 'el', 'en', 'fr', 'hr', 'it',
  'lv', 'lt', 'hu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'fi', 'sv']

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) {
  console.error('Нужны PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local')
  process.exit(1)
}
const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey)

/**
 * ⚠ `annotations` — скобочный материал, СНЯТЫЙ с имени: примесь, физическая
 * форма, определение EINECS, примечание, аббревиатура. Правило — Annex VI
 * Part 1 п. 1.1.1.4, таблица классов — scripts/clp-name-annotations.mjs.
 * ⭐ Печатается на этикетке только `composition`.
 */
type Annotation = { kind: string; text: string }

type ParsedName = {
  index_number: string
  lang: string
  name: string
  kind: 'group' | 'single'
  forms: string[]
  members: Record<string, string>
  synonyms: string[]
  annotations?: Annotation[]
}
type ParsedFile = { lang: string; source: string; substance_names: ParsedName[] }

type Row = {
  index_number: string
  lang: string
  name: string
  kind: string
  forms: string[]
  members: Record<string, string>
  synonyms: string[]
  annotations: Annotation[]
  source_ref: string
}

/**
 * ⭐⭐ ЧТО УЖЕ ЛЕЖИТ В БАЗЕ ПО ЭТОМУ ЯЗЫКУ — для ПОСТРОЧНОЙ СВЕРКИ.
 *
 * Повторная заливка без сверки — это заливка вслепую: upsert одинаково молча
 * пройдёт и когда изменилась одна запись, и когда разбор сломался и переписал
 * четыре тысячи. Session 49 сверила правку меток построчно (4418 → 4419,
 * добавилась ровно одна, потеряно ноль) и только поэтому знала, что чинила.
 */
async function existingRows(lang: string): Promise<Map<string, Partial<Row>>> {
  const out = new Map<string, Partial<Row>>()
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('substance_name_translations')
      .select('index_number,name,kind,forms,members,synonyms,annotations')
      .eq('lang', lang.toUpperCase())
      .range(from, from + page - 1)
    // ⚠ Колонки annotations может ещё не быть — тогда сверка не должна валить
    // заливку, но обязана сказать об этом вслух, а не притвориться пустой базой.
    if (error) {
      console.log(`  ⚠ сверку сделать не удалось (${error.message}) — заливаю без неё`)
      return new Map()
    }
    const rows = (data ?? []) as Partial<Row>[]
    for (const r of rows) if (r.index_number) out.set(r.index_number, r)
    if (rows.length < page) break
  }
  return out
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * ⚠⚠ ОТЧЁТ НАЗЫВАЕТ ПРЕДМЕТ ПОИМЁННО, а не только количество.
 * «Изменилось 137 записей» заставляет читателя делать работу заново; «forms 137,
 * первые пять — вот эти» позволяет проверить глазами за минуту.
 */
function compareToDb(lang: string, rows: Row[], before: Map<string, Partial<Row>>): void {
  if (!before.size) { console.log(`    сверка: в базе по ${lang.toUpperCase()} ничего не было — всё ниже добавляется впервые`); return }
  const now = new Set(rows.map((r) => r.index_number))
  const added = rows.filter((r) => !before.has(r.index_number)).map((r) => r.index_number)
  const lost = [...before.keys()].filter((i) => !now.has(i))
  const fields: (keyof Row)[] = ['name', 'kind', 'forms', 'members', 'synonyms', 'annotations']
  const changed = new Map<string, string[]>()
  for (const r of rows) {
    const b = before.get(r.index_number)
    if (!b) continue
    for (const f of fields) {
      if (f in b && !same(r[f], b[f])) {
        if (!changed.has(f)) changed.set(f, [])
        changed.get(f)!.push(r.index_number)
      }
    }
  }
  const head = (l: string[], n = 5) => l.slice(0, n).join(', ') + (l.length > n ? ` … +${l.length - n}` : '')
  console.log(`    сверка с базой: было ${before.size} · станет ${rows.length}`
    + ` · добавляется ${added.length} · ${lost.length ? '⚠⚠ ' : ''}пропадает ${lost.length}`)
  if (added.length) console.log(`      + ${head(added)}`)
  // ⚠⚠ Пропажа — это НЕ норма: языковые версии Annex VI перечисляют одни и те же
  // вещества, и запись, которая была и исчезла, означает сломанный разбор.
  if (lost.length) console.log(`      ⚠⚠ ПРОПАДАЮТ (upsert их НЕ удалит, но разбор их больше не видит): ${head(lost, 10)}`)
  for (const [f, list] of changed) console.log(`      изменилось «${f}»: ${list.length} — ${head(list)}`)
  if (!added.length && !lost.length && !changed.size) console.log('      ничего не изменилось')
}

/** Все индексные номера нашего справочника — по ним и меряется покрытие. */
async function ourIndexNumbers(): Promise<Set<string>> {
  const out = new Set<string>()
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('substances').select('index_number').range(from, from + page - 1)
    if (error) throw new Error(`substances: ${error.message}`)
    const rows = (data ?? []) as { index_number: string | null }[]
    for (const r of rows) if (r.index_number) out.add(r.index_number.trim().toUpperCase())
    if (rows.length < page) break
  }
  return out
}

async function main(): Promise<void> {
  const langs = LANGS.filter((l) => !ONLY || ONLY.includes(l))
  if (!langs.length) {
    console.error(`Под --only ничего не подошло. Языки: ${LANGS.join(', ')}`)
    process.exit(1)
  }

  console.log('')
  console.log('Заливка имён веществ Annex VI' + (DRY ? '  (--dry, ничего не пишется)' : ''))
  console.log(`  база:   ${supabaseUrl}`)
  console.log(`  языков: ${langs.length}`)
  console.log('')

  const ours = await ourIndexNumbers()
  console.log(`Наш справочник: ${ours.size} веществ с индексным номером`)
  console.log('')

  let grandTotal = 0
  let grandX = 0
  const coverage: { lang: string; rows: number; covered: number }[] = []
  const annByKind = new Map<string, number>()
  /** Индексные номера, встреченные ХОТЯ БЫ В ОДНОМ языке. */
  const seenAnywhere = new Set<string>()

  for (const lang of langs) {
    const file = resolve(process.cwd(), '.tmp-eurlex', `parsed-${lang}.json`)
    if (!existsSync(file)) {
      console.error(`✖ нет файла ${file} — сначала: node scripts/parse-clp-language.mjs ${lang}`)
      process.exit(1)
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as ParsedFile
    const names = parsed.substance_names ?? []
    if (!names.length) {
      console.error(`✖ ${lang}: в файле ноль имён — разбор не дошёл, заливать нечего`)
      process.exit(1)
    }

    const rows: Row[] = names.map((n) => ({
      index_number: n.index_number.trim().toUpperCase(),
      lang: (n.lang || lang).toUpperCase(),
      name: n.name,
      kind: n.kind,
      forms: n.forms ?? [],
      members: n.members ?? {},
      synonyms: n.synonyms ?? [],
      annotations: n.annotations ?? [],
      source_ref: SOURCE_REF,
    }))

    // ⚠⚠ Дубли по (index_number, lang) обрушили бы upsert посреди партии, и
    // часть языка легла бы, а часть нет. Ловим ДО записи.
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const r of rows) {
      if (seen.has(r.index_number)) dupes.push(r.index_number)
      seen.add(r.index_number)
    }
    if (dupes.length) {
      console.error(`✖ ${lang}: повторы индексного номера в файле: ${dupes.slice(0, 5).join(', ')}`)
      process.exit(1)
    }

    for (const r of rows) seenAnywhere.add(r.index_number)
    const xEnding = rows.filter((r) => r.index_number.endsWith('X')).length
    const covered = rows.filter((r) => ours.has(r.index_number)).length
    grandTotal += rows.length
    grandX += xEnding
    coverage.push({ lang, rows: rows.length, covered })

    for (const a of rows.flatMap((r) => r.annotations)) {
      annByKind.set(a.kind, (annByKind.get(a.kind) ?? 0) + 1)
    }

    const pctHead = ((covered / Math.max(1, ours.size)) * 100).toFixed(1)
    console.log(`${lang.toUpperCase().padEnd(3)} ${String(rows.length).padStart(5)} строк`
      + `  ·  на «X» ${String(xEnding).padStart(4)}`
      + `  ·  покрыто нашего справочника: ${String(covered).padStart(5)} (${pctHead} %)`)

    // ⚠ Сверка ДО записи: после upsert сравнивать уже не с чем.
    compareToDb(lang, rows, await existingRows(lang))

    if (!DRY) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH)
        const { error } = await supabase
          .from('substance_name_translations')
          .upsert(chunk, { onConflict: 'index_number,lang' })
        // ⚠ Ошибку НЕ глотаем и НЕ продолжаем: половина залитого языка хуже,
        // чем незалитый — расхождение потом ищется вручную по 4 400 строкам.
        if (error) {
          console.error(`✖ ${lang}, партия ${i / BATCH + 1}: ${error.message}`)
          process.exit(1)
        }
      }
    }

  }

  console.log('')
  console.log(`Всего строк: ${grandTotal.toLocaleString('ru')} · из них с контрольным знаком X: ${grandX.toLocaleString('ru')}`)
  if (annByKind.size) {
    const printed = [...annByKind.entries()].filter(([k]) => k === 'composition').reduce((n, [, c]) => n + c, 0)
    console.log(`Скобочных примечаний: ${[...annByKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(' · ')}`)
    console.log(`  ⭐ из них ПЕЧАТАЮТСЯ на этикетке (Annex VI Part 1, п. 1.1.1.4): ${printed}`)
  }

  /**
   * ⚠⚠ ПОКРЫТИЕ ОБЯЗАНО БЫТЬ ОДИНАКОВЫМ У ВСЕХ ЯЗЫКОВ.
   *
   * Разное покрытие означает не «в регламенте так», а нашу дыру: языковые
   * версии Annex VI перечисляют одни и те же вещества. Ровно так уже выходило
   * дважды — сперва длинное тире вместо дефиса, потом контрольный знак «X» в
   * конце индексного номера: и то и другое выпадало МОЛЧА и у всех языков
   * сразу, поэтому сверка языков между собой ничего не замечала.
   */
  const min = Math.min(...coverage.map((c) => c.covered))
  const max = Math.max(...coverage.map((c) => c.covered))
  if (max - min > 20) {
    console.log('')
    console.log(`⚠ Покрытие разнится: от ${min} до ${max}. Это наша дыра, а не свойство регламента —`)
    for (const c of coverage.filter((c) => c.covered < max - 20)) {
      console.log(`   ${c.lang}: ${c.covered}`)
    }
  }

  /**
   * ⚠⚠ НЕ «сколько», А «КАКИЕ ИМЕННО».
   *
   * Первая версия печатала только число — и на живом прогоне сказала «1 вещество
   * не получило имени», не сказав какое. Это ровно тот отчёт, который заставляет
   * гадать: сначала подозреваешь шаблон INDEX_NO (он уже подводил дважды), лезешь
   * его проверять, и только потом выясняется, что дело в другом.
   * Отчёт обязан называть предмет поимённо — иначе он сообщает о работе, которую
   * читателю придётся делать заново.
   */
  const missing = [...ours].filter((idx) => !seenAnywhere.has(idx)).sort()
  if (missing.length > 0) {
    console.log('')
    console.log(`⚠ ${missing.length} веществ нашего справочника не получили имени НИ НА ОДНОМ языке:`)
    for (const idx of missing.slice(0, 25)) console.log(`   ${idx}`)
    if (missing.length > 25) console.log(`   … и ещё ${missing.length - 25}`)
    console.log('  Причины бывают две: знак, который не принимает шаблон INDEX_NO в')
    console.log('  scripts/parse-clp-language.mjs (он уже подводил дважды), либо запись,')
    console.log('  которую поправка к регламенту убрала, а у нас она осталась.')
  }

  console.log('')
  console.log(DRY ? 'Ничего не записано (--dry).' : 'Готово.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
