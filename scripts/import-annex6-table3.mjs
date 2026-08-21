/**
 * Импорт полного среза Annex VI Table 3 в public.annex6_table3.
 *
 * Источник данных: .tmp-eurlex/annex6-table3-full.json — извлечение session 74
 * из консолидированного CLP (CELEX 02008R1272, ред. 2026-05-01, снимок
 * clp-consolidated.html от 2026-08-07). 4 418 записей, ячейки дословно,
 * CAS/EC — полными списками форм (без обрезки 20 знаков).
 *
 * Запуск из корня ghspictograms:
 *   node --use-system-ca scripts/import-annex6-table3.mjs
 *
 * Требуется .env.local:
 *   PUBLIC_SUPABASE_URL=
 *   SUPABASE_SERVICE_ROLE_KEY=
 *
 * Идемпотентен: upsert по index_number, повторный запуск безопасен.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) {
  console.error('Нужны PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, serviceKey)

const DATA = resolve(process.cwd(), '.tmp-eurlex/annex6-table3-full.json')
const rows = JSON.parse(readFileSync(DATA, 'utf8'))
console.log(`Читаю ${DATA}: ${rows.length} записей (ожидается 4418)`)
if (rows.length !== 4418) {
  console.error('⚠ Число записей не равно 4418 — файл не тот или повреждён. Стоп.')
  process.exit(1)
}

const mapped = rows.map((r) => ({
  index_number: r.index_number,
  name_raw: r.name ?? '',
  ec_raw: r.ec ?? [],
  cas_raw: r.cas ?? [],
  class_cat_raw: r.class_cat ?? [],
  hazard_h_raw: r.h_codes ?? [],
  scl_m_raw: r.scl_m && r.scl_m.length ? r.scl_m.join('\n') : null,
  notes_raw: r.notes ?? [],
}))

const BATCH = 400
let done = 0
for (let i = 0; i < mapped.length; i += BATCH) {
  const chunk = mapped.slice(i, i + BATCH)
  const { error } = await supabase
    .from('annex6_table3')
    .upsert(chunk, { onConflict: 'index_number' })
  if (error) {
    console.error(`⛔ Батч ${i}-${i + chunk.length}: ${error.message}`)
    process.exit(1)
  }
  done += chunk.length
  console.log(`  ${done} / ${mapped.length}`)
}

const { count } = await supabase
  .from('annex6_table3')
  .select('*', { count: 'exact', head: true })
console.log(`\nГотово. В annex6_table3 сейчас ${count} строк (ожидается 4418).`)
console.log('Дальнейшая сверка с substances — за ассистентом через MCP.')
