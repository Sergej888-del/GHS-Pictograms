// A0 (№101): заполнить public.annex6_classification (+ _row) из annex6_table3.
//
// Запуск из корня ghspictograms (service-ключ из .env.local):
//   node --use-system-ca --experimental-strip-types scripts/build-annex6-classification.ts
//   … --dry-run        — только разбор и отчёт, в базу не писать
//   … --dump-fixtures  — переснять scripts/fixtures/annex6-table3.json и annex6-registry.json
//                        (после новой консолидации или нового класса в реестре)
//
// Что делает: читает annex6_table3 (страницами по 1 000 — кап PostgREST),
// реестр (hazard_category_mapping ⋈ hazard_class_catalog), разбирает каждую
// строку парсером src/lib/classifier/annex6Classification.ts с учётом
// src/lib/annex6RowErrata.ts, проверяет жёсткие ворота приёмки и только потом
// переписывает обе таблицы (delete + upsert батчами по 400). Идемпотентен.
//
// ⛔ Жёсткие ворота (если красные — в базу НЕ пишет): нераспознанных кусков 0,
// пар без H-кода вне errata 0, Acute Tox. без пути 0, расхождений с реестром 0,
// остатка H-кодов вне errata 0. Это та же приёмка, что в check-classifier.ts.
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  parseAnnex6Row, RegistryIndex, ANNEX6_CLASSIFICATION_PARSER_VERSION,
  type Annex6Row, type RegistryRow, type RowErratumLite, type RowResult,
} from '../src/lib/classifier/annex6Classification.ts';
import { rowErratumFor } from '../src/lib/annex6RowErrata.ts';

config({ path: resolve(process.cwd(), '.env.local') });

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const DUMP = args.has('--dump-fixtures');

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Нужны PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

/** Все строки таблицы страницами по 1 000 с фиксированным порядком (кап PostgREST). */
async function selectAll<T>(table: string, columns: string, orderBy: string): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.from(table).select(columns).order(orderBy).range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

// ── 1. данные ────────────────────────────────────────────────────────────────
const rows = await selectAll<Annex6Row>('annex6_table3', 'index_number, class_cat_raw, hazard_h_raw', 'index_number');
console.log(`annex6_table3: ${rows.length} строк`);

type CatalogRow = { id: string; class_code: string };
type MappingRow = { hazard_class_id: string; category_code: string | null; h_statement_code: string | null };
const catalog = await selectAll<CatalogRow>('hazard_class_catalog', 'id, class_code', 'class_code');
const mapping = await selectAll<MappingRow>('hazard_category_mapping', 'hazard_class_id, category_code, h_statement_code', 'hazard_class_id');
const classById = new Map(catalog.map((c) => [c.id, c.class_code]));
const registryRows: RegistryRow[] = mapping
  .filter((m) => m.category_code != null && classById.has(m.hazard_class_id))
  .map((m) => ({ classCode: classById.get(m.hazard_class_id)!, categoryCode: m.category_code!, hCode: m.h_statement_code }));
const registry = new RegistryIndex(registryRows);
console.log(`реестр: ${catalog.length} классов · ${registryRows.length} пар`);

if (DUMP) {
  const fx = resolve(process.cwd(), 'scripts/fixtures');
  const stamp = new Date().toISOString().slice(0, 10);
  writeFileSync(resolve(fx, 'annex6-table3.json'),
    `{"source":"public.annex6_table3 (index_number, class_cat_raw, hazard_h_raw), snapshot ${stamp}","rows":[\n`
    + rows.map((r) => JSON.stringify([r.index_number, r.class_cat_raw, r.hazard_h_raw])).join(',\n') + '\n]}\n');
  const regSorted = [...registryRows].sort((a, b) => a.classCode.localeCompare(b.classCode) || a.categoryCode.localeCompare(b.categoryCode));
  const seen = new Set<string>();
  const regUnique = regSorted.filter((r) => { const k = `${r.classCode}|${r.categoryCode}|${r.hCode}`; if (seen.has(k)) return false; seen.add(k); return true; });
  writeFileSync(resolve(fx, 'annex6-registry.json'),
    `{"source":"hazard_category_mapping ⋈ hazard_class_catalog, snapshot ${stamp}, ${mapping.length} rows → ${regUnique.length} distinct (class, category, h)","rows":[\n`
    + regUnique.map((r) => JSON.stringify([r.classCode, r.categoryCode, r.hCode])).join(',\n') + '\n]}\n');
  console.log(`снимки переписаны в ${fx}`);
}

// ── 2. разбор ────────────────────────────────────────────────────────────────
function erratumLite(index: string): RowErratumLite | null {
  const e = rowErratumFor(index);
  return e ? { kind: e.kind, shownStatements: e.shownStatements, printedStatements: e.printedStatements } : null;
}
const results: RowResult[] = rows.map((r) => parseAnnex6Row(r, registry, erratumLite(r.index_number)));
const pairs = results.flatMap((r) => r.pairs);
console.log(`разобрано: ${results.length} строк → ${pairs.length} пар · ${ANNEX6_CLASSIFICATION_PARSER_VERSION}`);

const gates: Array<[string, number, string[]]> = [
  ['нераспознанные куски колонки (3)', results.filter((r) => r.rowFlags.includes('UNPARSED')).length,
    results.filter((r) => r.rowFlags.includes('UNPARSED')).map((r) => `${r.indexNumber}: ${r.unparsed.join(' | ')}`)],
  ['пары без H-кода вне errata', pairs.filter((p) => p.flags.includes('H_MISSING')).length,
    pairs.filter((p) => p.flags.includes('H_MISSING')).map((p) => `${p.indexNumber} ${p.raw}`)],
  ['Acute Tox. без пути', pairs.filter((p) => p.flags.includes('ROUTE_UNKNOWN')).length,
    pairs.filter((p) => p.flags.includes('ROUTE_UNKNOWN')).map((p) => `${p.indexNumber} ${p.raw}`)],
  ['H-код строки ≠ H-код реестра', pairs.filter((p) => p.flags.includes('H_MISMATCH')).length,
    pairs.filter((p) => p.flags.includes('H_MISMATCH')).map((p) => `${p.indexNumber} ${p.classCode}/${p.categoryCode} ${p.hCode}`)],
  ['остаток H-кодов вне errata', results.filter((r) => r.rowFlags.includes('H_UNMATCHED')).length,
    results.filter((r) => r.rowFlags.includes('H_UNMATCHED')).map((r) => `${r.indexNumber}: ${r.unmatchedH.join(' ')}`)],
  ['класс пары не в каталоге', pairs.filter((p) => !registry.hasClass(p.classCode)).length,
    [...new Set(pairs.filter((p) => !registry.hasClass(p.classCode)).map((p) => p.classCode))]],
];
let red = 0;
for (const [name, n, examples] of gates) {
  console.log(`  ${n === 0 ? '✓' : '✗'} ${name}: ${n}${n ? '\n      ' + examples.slice(0, 10).join('\n      ') : ''}`);
  if (n) red++;
}
const gaps = pairs.filter((p) => p.flags.includes('REGISTRY_GAP'));
console.log(`  ${gaps.length === 0 ? '✓' : '⚠'} пары вне реестра (REGISTRY_GAP; после №102 ожидается 0): ${gaps.length}${gaps.length ? ' — ' + [...new Set(gaps.map((p) => `${p.classCode}/${p.categoryCode}`))].join(', ') : ''}`);
if (red) {
  console.error(`\n⛔ ${red} ворот красные — в базу не пишу. Сначала словарь/errata, потом повтор.`);
  process.exit(1);
}
if (DRY) { console.log('\n--dry-run: в базу не пишу.'); process.exit(0); }

// ── 3. запись ────────────────────────────────────────────────────────────────
const pairRows = pairs.map((p) => ({
  index_number: p.indexNumber, seq: p.seq, class_code: p.classCode, category_code: p.categoryCode,
  category_raw: p.categoryRaw, h_code: p.hCode, h_code_full: p.hCodeFull, organs: p.organs, h_marker: p.hMarker,
  star: p.star, test_required: p.testRequired, raw: p.raw, flags: p.flags,
  parser_version: ANNEX6_CLASSIFICATION_PARSER_VERSION,
}));
const rowRows = results.map((r) => ({
  index_number: r.indexNumber, n_pairs: r.pairs.length, row_flags: r.rowFlags, unparsed: r.unparsed,
  unmatched_h: r.unmatchedH, class_cat_norm: r.normalizedClassCat, h_norm: r.normalizedH,
  parser_version: ANNEX6_CLASSIFICATION_PARSER_VERSION,
}));

// старые строки прочь (пары строки могли стать короче — upsert их не уберёт)
for (const table of ['annex6_classification', 'annex6_classification_row']) {
  const { error } = await supabase.from(table).delete().neq('index_number', '');
  if (error) { console.error(`⛔ delete ${table}: ${error.message}`); process.exit(1); }
}
const BATCH = 400;
async function upsertAll(table: string, data: Record<string, unknown>[], onConflict: string) {
  let done = 0;
  for (let i = 0; i < data.length; i += BATCH) {
    const chunk = data.slice(i, i + BATCH);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) { console.error(`⛔ ${table} батч ${i}-${i + chunk.length}: ${error.message}`); process.exit(1); }
    done += chunk.length;
    if (done % 2000 === 0 || done === data.length) console.log(`  ${table}: ${done} / ${data.length}`);
  }
}
await upsertAll('annex6_classification', pairRows, 'index_number,seq');
await upsertAll('annex6_classification_row', rowRows, 'index_number');

const { count: nPairs } = await supabase.from('annex6_classification').select('*', { count: 'exact', head: true });
const { count: nRows } = await supabase.from('annex6_classification_row').select('*', { count: 'exact', head: true });
console.log(`\nГотово. annex6_classification: ${nPairs} (ожидается ${pairRows.length}) · annex6_classification_row: ${nRows} (ожидается ${rowRows.length})`);
if (nPairs !== pairRows.length || nRows !== rowRows.length) { console.error('⛔ счётчики не сошлись'); process.exit(1); }
