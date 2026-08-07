/**
 * Заливка переводов H-, EUH- и P-фраз на 24 языка ЕС в statement_translations.
 *
 * Запуск из корня ghspictograms:
 *   npx tsx scripts/import-clp-translations.ts
 *
 * Требуется .env.local:
 *   PUBLIC_SUPABASE_URL=
 *   SUPABASE_SERVICE_ROLE_KEY=
 *
 * Вход: .tmp-eurlex/clp-translations.json — разобранные Annex III и Annex IV
 * консолидированного CLP (CELEX 02008R1272-20260501). Файл получен так:
 *   1) scripts/download-clp-annexes.mjs скачал HTML с Publications Office;
 *   2) scripts/parse-clp-annexes.py разобрал оба приложения.
 *
 * ⚠⚠ ПОЧЕМУ ЭТО ЗАКОННО И ПОЧЕМУ ИСТОЧНИК ИМЕННО ТАКОЙ. Машиночитаемого файла с
 * этими текстами у ECHA нет, а её Legal notice прямо запрещает «scraping, data
 * mining and extraction». EUR-Lex — можно: Commission Decision 2011/833/EU
 * разрешает повторное использование, включая коммерческое, бесплатно и без
 * заявки, при условии указания источника. Указание источника — не вежливость, а
 * условие лицензии, и оно обязано стоять на странице инструмента.
 *
 * ⚠ Юридически аутентичен только текст в электронном Official Journal
 * (Reg. 216/2013, Art. 1(2)). Эта оговорка тоже идёт на страницу.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

config({ path: resolve(process.cwd(), '.env.local') })

const SOURCE_REF = 'CELEX:02008R1272-20260501'
const INPUT = resolve(process.cwd(), '.tmp-eurlex', 'clp-translations.json')
const BATCH = 500

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Нужны PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey)

type Parsed = Record<string, { annex: 'III' | 'IV'; texts: Record<string, string> }>

type Row = { code: string; lang: string; text: string; annex: string; source_ref: string }

/** 24 официальных языка ЕС. Ничего кроме них в таблицу не попадает. */
const LANGS = new Set([
  'BG', 'ES', 'CS', 'DA', 'DE', 'ET', 'EL', 'EN', 'FR', 'GA', 'HR', 'IT',
  'LV', 'LT', 'HU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SL', 'FI', 'SV',
])

async function main(): Promise<void> {
  let parsed: Parsed
  try {
    parsed = JSON.parse(readFileSync(INPUT, 'utf8')) as Parsed
  } catch (e) {
    console.error(`Не читается ${INPUT}: ${(e as Error).message}`)
    console.error('Сначала скачай и разбери приложения — см. шапку файла.')
    process.exit(1)
  }

  const rows: Row[] = []
  const problems: string[] = []

  for (const [code, rec] of Object.entries(parsed)) {
    const langs = Object.keys(rec.texts)
    // ⚠ Неполный набор — признак того, что разбор поймал не ту таблицу. Такие
    // коды не заливаются молча: на этикетку уедет пустая строка вместо фразы.
    if (langs.length !== 24) {
      problems.push(`${code}: ${langs.length} языков вместо 24`)
      continue
    }
    for (const [lang, text] of Object.entries(rec.texts)) {
      if (!LANGS.has(lang)) { problems.push(`${code}: неизвестный язык ${lang}`); continue }
      if (!text.trim()) { problems.push(`${code}/${lang}: пустой текст`); continue }
      rows.push({ code, lang, text: text.trim(), annex: rec.annex, source_ref: SOURCE_REF })
    }
  }

  if (problems.length) {
    console.error(`✖ ${problems.length} проблем, импорт остановлен:`)
    for (const p of problems.slice(0, 30)) console.error('   ' + p)
    process.exit(1)
  }

  console.log(`кодов: ${Object.keys(parsed).length}, строк к заливке: ${rows.length}`)

  let done = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const { error } = await supabase
      .from('statement_translations')
      .upsert(chunk, { onConflict: 'code,lang' })
    if (error) {
      console.error(`✖ партия ${i}–${i + chunk.length}: ${error.message}`)
      process.exit(1)
    }
    done += chunk.length
    process.stdout.write(`\r  залито ${done} из ${rows.length}`)
  }
  process.stdout.write('\n')

  // ── Сверка: сколько фраз справочников получили переводы ───────────────────
  // ⚠⚠ Проверять надо ИМЕННО пересечение с h_statements/p_statements, а не
  // число строк. Строки могут лечь все до одной, а на этикетке всё равно будет
  // пусто, если коды в справочниках записаны иначе.
  const [{ count: total }, hRes, pRes, tRes] = await Promise.all([
    supabase.from('statement_translations').select('*', { count: 'exact', head: true }),
    supabase.from('h_statements').select('code'),
    supabase.from('p_statements').select('code'),
    supabase.from('statement_translations').select('code').eq('lang', 'EN'),
  ])

  const translated = new Set((tRes.data ?? []).map((r: { code: string }) => r.code))
  const hCodes = (hRes.data ?? []).map((r: { code: string }) => r.code)
  const pCodes = (pRes.data ?? []).map((r: { code: string }) => r.code)
  const hMiss = hCodes.filter((c) => !translated.has(c))
  const pMiss = pCodes.filter((c) => !translated.has(c))

  console.log(`\nв таблице переводов: ${total} строк`)
  console.log(`h_statements: ${hCodes.length - hMiss.length} из ${hCodes.length} с переводами`)
  console.log(`p_statements: ${pCodes.length - pMiss.length} из ${pCodes.length} с переводами`)
  if (hMiss.length) console.log(`  без перевода (H): ${hMiss.sort().join(', ')}`)
  if (pMiss.length) console.log(`  без перевода (P): ${pMiss.sort().join(', ')}`)
  console.log(
    '\n⚠ Коды без перевода — это НЕ сбой импорта. Их официального текста нет в\n' +
    '  действующем Annex III: часть отменена прежними ATP (EUH001, EUH006, EUH059),\n' +
    '  часть — фразы UN GHS, которые ЕС не принимал (H303, H305, H313, H316, H320,\n' +
    '  H333, H401, H402), а суффиксные формы (H350i, H360F, H360D, H360FD, H361f,\n' +
    '  H361d и прочие) регламент отдельными строками не публикует вовсе — они\n' +
    '  собираются из H350/H360/H361 по правилам Annex VI.\n' +
    '  ⚠⚠ Склеивать их переводы самим НЕЛЬЗЯ: это сочинение юридического текста.\n' +
    '  На этикетке такие фразы остаются на английском и помечаются явно.',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
