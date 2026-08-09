/**
 * Пересчёт forms/synonyms/annotations в substance_name_translations БЕЗ перекачки
 * исходников EUR-Lex.
 *
 * Запуск из корня ghspictograms:
 *   npx tsx scripts/rebuild-name-forms.ts --dry     ← сначала так, ничего не пишет
 *   npx tsx scripts/rebuild-name-forms.ts
 *
 * Требуется .env.local: PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠⚠ ПОЧЕМУ ЭТО ЗАКОННО, А НЕ СРЕЗАНИЕ УГЛА.
 *
 * Колонка `name` хранит ЯЧЕЙКУ РЕГЛАМЕНТА КАК ЕСТЬ — так записано в
 * parse-clp-language.mjs и так оно и залито. Значит вход разбора у нас уже есть,
 * и качать 24 файла по 28 МБ ради того же текста незачем.
 *
 * ⚠ Разбор берётся ТЕМ ЖЕ импортом `splitName`, которым разбирает парсер. Второй
 * реализации здесь нет и быть не должно: она разошлась бы с первой молча.
 *
 * ⭐⭐ И ЭТО ЖЕ СЛУЖИТ ПРОВЕРКОЙ ВХОДА. Строка, которая НЕ должна была
 * измениться, обязана пересчитаться в саму себя. Если пересчёт разошёлся со
 * стором у записи, которой нет в COMPOSITE_HEAD, значит `name` в базе — не тот
 * текст, из которого получены forms, и писать нельзя: скрипт останавливается и
 * называет расхождения поимённо.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
// ⚠⚠ Тот же модуль, что и у парсера. Копии правила разбора здесь нет.
import { splitName, COMPOSITE_HEAD } from './clp-name-annotations.mjs'

config({ path: resolve(process.cwd(), '.env.local') })
config()

const ARGV = process.argv.slice(2)
const DRY = ARGV.includes('--dry')
const BATCH = 500

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) {
  console.error('Нужны PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local')
  process.exit(1)
}
const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
})

/**
 * ⚠⚠ ЧИТАЮТСЯ ВСЕ КОЛОНКИ NOT NULL, А НЕ ТОЛЬКО ТЕ, ЧТО МЕНЯЮТСЯ.
 *
 * PostgREST шлёт upsert как `INSERT … ON CONFLICT DO UPDATE`, и Postgres
 * проверяет NOT NULL на ПРЕДЛАГАЕМОЙ строке — до того, как узнает, что дело
 * кончится обновлением. Строка без `source_ref` не доходит до разрешения
 * конфликта и валит всю пачку:
 *   null value in column "source_ref" … violates not-null constraint
 * ⚠ `created_at` не читается намеренно: у него есть значение по умолчанию, и
 * при обновлении не переданная колонка сохраняет своё старое значение. Передать
 * её значило бы переписать дату заливки датой пересчёта.
 */
type Row = {
  index_number: string
  lang: string
  name: string
  kind: string
  forms: string[] | null
  members: Record<string, string> | null
  synonyms: string[] | null
  source_ref: string
  annotations: unknown[] | null
}

/** Читает всю таблицу постранично: PostgREST режет ответ на 1000. */
async function selectAll(): Promise<Row[]> {
  const out: Row[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('substance_name_translations')
      .select('index_number,lang,name,kind,forms,members,synonyms,source_ref,annotations')
      .order('index_number', { ascending: true })
      .order('lang', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw new Error(`чтение: ${error.message}`)
    const rows = (data ?? []) as Row[]
    out.push(...rows)
    if (rows.length < page) break
  }
  return out
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

async function main(): Promise<void> {
  console.log(`База: ${supabaseUrl}`)
  console.log(`Таблица составных записей: ${COMPOSITE_HEAD.size} номеров`)
  const rows = await selectAll()
  console.log(`Прочитано строк: ${rows.length}\n`)

  const changed: Row[] = []
  /** ⚠⚠ Расхождение там, где его быть не должно. См. шапку файла. */
  const unexpected: string[] = []
  const byLang = new Map<string, number>()
  let joinedRows = 0

  for (const r of rows) {
    const v = splitName(r.name, r.index_number)
    const diff =
      v.kind !== r.kind ||
      !same(v.forms, r.forms) ||
      !same(v.synonyms, r.synonyms) ||
      !same(v.members, r.members) ||
      !same(v.annotations, r.annotations)
    if (!diff) continue

    if (!COMPOSITE_HEAD.has(r.index_number)) {
      if (unexpected.length < 40) {
        unexpected.push(
          `${r.index_number} ${r.lang}: было ${JSON.stringify(r.synonyms)}, стало ${JSON.stringify(v.synonyms)}`)
      }
      continue
    }
    const before = r.synonyms?.length ?? 0
    const after = v.synonyms.length
    if (after < before) joinedRows++
    byLang.set(r.lang, (byLang.get(r.lang) ?? 0) + 1)
    changed.push({
      ...r,
      kind: v.kind,
      forms: v.forms,
      // ⚠ `members` приходит из .mjs без типов: у одиночной записи это `{}`.
      members: v.members as Record<string, string>,
      synonyms: v.synonyms,
      annotations: v.annotations,
    })
  }

  if (unexpected.length) {
    console.error('✖✖ ПЕРЕСЧЁТ РАЗОШЁЛСЯ ТАМ, ГДЕ НЕ ДОЛЖЕН БЫЛ.')
    console.error('   Это значит, что колонка `name` — не тот текст, из которого получены forms,')
    console.error('   и писать по ней нельзя. Ничего не записано.\n')
    for (const line of unexpected) console.error(`   ${line}`)
    process.exit(1)
  }

  // ⭐ Печатается ВСЕГДА, а не только когда есть что сказать. Ноль, полученный
  // молчанием, неотличим от проверки, которая не отработала.
  console.log(`РАСХОЖДЕНИЙ ТАМ, ГДЕ НЕ ДОЛЖНО: ${unexpected.length}`)
  console.log(`Строк к правке: ${changed.length}`)
  console.log(`  из них компонент возвращён в имя: ${joinedRows}`)
  const langs = [...byLang.entries()].sort((a, b) => b[1] - a[1])
  console.log(`  по языкам: ${langs.map(([l, n]) => `${l} ${n}`).join(' · ')}`)
  const entries = new Set(changed.map((r) => r.index_number)).size
  console.log(`  записей затронуто: ${entries} из ${COMPOSITE_HEAD.size} в таблице\n`)

  const sample = changed.slice(0, 3)
  for (const r of sample) {
    console.log(`  ${r.index_number} ${r.lang}`)
    console.log(`    forms[0] = ${JSON.stringify(r.forms?.[0])}`)
  }
  console.log('')

  if (DRY) {
    console.log('--dry: ничего не записано.')
    return
  }
  if (!changed.length) {
    console.log('Менять нечего.')
    return
  }

  // ⚠ upsert по первичному ключу (index_number, lang) — повтор безопасен.
  for (let i = 0; i < changed.length; i += BATCH) {
    const slice = changed.slice(i, i + BATCH)
    const { error } = await supabase
      .from('substance_name_translations')
      .upsert(slice, { onConflict: 'index_number,lang' })
    if (error) throw new Error(`запись ${i}: ${error.message}`)
    console.log(`  записано ${Math.min(i + BATCH, changed.length)} из ${changed.length}`)
  }
  console.log('\nГотово. Дальше: npm run build:local, затем npm run check:dist.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
