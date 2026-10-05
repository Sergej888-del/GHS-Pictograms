/**
 * check:search — сторож чистки строки поиска (№149, session 91).
 *
 *   npm run check:search
 *
 * Что сторожит:
 *   1. `normalizeSearchQuery` (src/lib/searchQuery.ts) на фикстурах, снятых с живого
 *      лога `tool_search_miss` (s88–s90): полноширинные цифры японской раскладки,
 *      подпись «CAS …» из паспорта безопасности, неразрывный дефис и тире из PDF.
 *      Фикстура — не «ожидаемое из головы», а то, что люди реально вводили и не находили.
 *   2. Что чистка СТОИТ во всех шести островах с поиском и в `/api/classify/lookup`:
 *      грепом по исходникам — снять импорт по случайности нельзя молча.
 *   3. Сквозной прогон через Fuse с настройками `SubstancePicker` по снимку
 *      `dist/data/substances-index.json` (если собран): «１０８－８８－３» обязан найти
 *      толуол, а БЕЗ чистки — обязан НЕ найти (контроль, что сторож сторожит).
 *
 * ⚠ Без сети. Если `dist/` не собран, часть 3 пропускается с предупреждением —
 * на машине Сергея после `astro build` она обязательна.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Fuse from 'fuse.js'
import { normalizeSearchQuery, looksLikeCas, CAS_SHAPE } from '../src/lib/searchQuery.ts'

const ROOT = resolve(import.meta.dirname, '..')

let failed = 0
let total = 0
function check(name: string, cond: boolean, detail = '') {
  total++
  if (cond) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ── 1. Фикстуры из лога промахов ───────────────────────────────────────────────
console.log('\n1. normalizeSearchQuery — фикстуры из tool_search_miss')
const FIXTURES: Array<[string, string, string]> = [
  // [ввод, ожидание, откуда]
  ['１０８－８８－３', '108-88-3', 'полноширинные цифры, ×5 в логе (толуол)'],
  ['ＣＡＳ １０８－８８－３', '108-88-3', 'полноширинная подпись + цифры'],
  ['CAS 111-90-0', '111-90-0', 'лог 09.2026'],
  ['CAS 1317-36-8', '1317-36-8', 'лог 09.2026'],
  ['CAS No. 98-95-3', '98-95-3', 'подпись из SDS'],
  ['CAS No 98-95-3', '98-95-3', 'подпись без точки'],
  ['CAS№ 98-95-3', '98-95-3', 'русская подпись'],
  ['CAS#98-95-3', '98-95-3', 'решётка без пробела'],
  ['CAS RN: 50-00-0', '50-00-0', 'CAS RN'],
  ['CAS Nr. 50-00-0', '50-00-0', 'немецкая подпись Nr.'],
  ['casnothing', 'casnothing', '«casno…» внутри слова — не подпись'],
  ['cas-67-64-1', '67-64-1', 'дефис после подписи'],
  ['CAS108-88-3', '108-88-3', 'подпись впритык'],
  ['98 95 3', '98 95 3', 'неразрывные пробелы → обычные (номер остров склеит сам)'],
  ['98‑95‑3', '98-95-3', 'неразрывный дефис U+2011'],
  ['98–95–3', '98-95-3', 'короткое тире U+2013'],
  ['98−95−3', '98-95-3', 'знак минус U+2212'],
  ['  acetone  ', 'acetone', 'обрезка'],
  ['acetone,', 'acetone', 'запятая на конце'],
  ['108-88-3.', '108-88-3', 'точка на конце'],
  ['castor oil', 'castor oil', '«cas» внутри слова — не подпись'],
  ['Caspofungin', 'Caspofungin', '«Cas» внутри имени — не подпись'],
  ['cas', '', 'одна подпись без номера → пусто'],
  ['tolu　ene', 'tolu ene', 'идеографический пробел U+3000'],
  ['', '', 'пусто'],
]
for (const [input, expected, why] of FIXTURES) {
  const got = normalizeSearchQuery(input)
  check(`${JSON.stringify(input)} → ${JSON.stringify(expected)} (${why})`, got === expected, `получено ${JSON.stringify(got)}`)
}
check('null/undefined → пусто', normalizeSearchQuery(null) === '' && normalizeSearchQuery(undefined) === '')
check('регистр и орфография НЕ трогаются (это дело островов)', normalizeSearchQuery('Sulphuric Acid') === 'Sulphuric Acid')
check('looksLikeCas после чистки', looksLikeCas(normalizeSearchQuery('CAS No. 98-95-3')) && !looksLikeCas('98-95') && !looksLikeCas('acetone'))
check('CAS_SHAPE — 2–7 цифр', CAS_SHAPE.test('50-00-0') && CAS_SHAPE.test('1234567-12-3') && !CAS_SHAPE.test('1-00-0'))

// ── 2. Чистка стоит везде, где есть поиск ──────────────────────────────────────
console.log('\n2. normalizeSearchQuery стоит во всех островах с поиском и в API')
const SITES: Array<[string, string]> = [
  ['src/components/SubstancePicker.tsx', "from '../lib/searchQuery'"],
  ['src/components/SubstanceFilterBrowse.tsx', "from '../lib/searchQuery'"],
  ['src/components/AteMixtureCalculator.tsx', "from '../lib/searchQuery'"],
  ['src/components/StorageTool.tsx', "from '../lib/searchQuery'"],
  ['src/components/PStatementSelector.tsx', "from '../lib/searchQuery'"],
  ['src/components/MixtureClassifier.tsx', "from '../lib/searchQuery'"],
  ['functions/api/classify/lookup.ts', "from '../../../src/lib/searchQuery.ts'"],
]
for (const [rel, importTail] of SITES) {
  const src = readFileSync(resolve(ROOT, rel), 'utf8')
  const imported = src.includes(importTail) && src.includes('normalizeSearchQuery')
  const used = (src.match(/normalizeSearchQuery\(/g) ?? []).length >= 1
  check(`${rel}: импорт + вызов`, imported && used)
}
// Острова с Fuse обязаны передавать в .search() уже вычищенную строку — сырой `query` туда идти не должен
for (const rel of ['src/components/SubstancePicker.tsx', 'src/components/SubstanceFilterBrowse.tsx']) {
  const src = readFileSync(resolve(ROOT, rel), 'utf8')
  check(`${rel}: fuse.search() не получает сырой query`, !/fuse\.search\(query(\.trim\(\))?\)/.test(src))
}
{
  const src = readFileSync(resolve(ROOT, 'src/components/PStatementSelector.tsx'), 'utf8')
  check('PStatementSelector: свой CAS_SHAPE удалён, берётся общий', !/const CAS_SHAPE = /.test(src) && src.includes('CAS_SHAPE'))
}

// ── 3. Сквозной прогон по снимку справочника ──────────────────────────────────
console.log('\n3. Fuse по dist/data/substances-index.json (настройки SubstancePicker)')
const SNAPSHOT = resolve(ROOT, 'dist', 'data', 'substances-index.json')
if (!existsSync(SNAPSHOT)) {
  console.log('  ⚠ dist/data/substances-index.json не собран — часть 3 пропущена (на машине Сергея после astro build она обязательна)')
} else {
  type Row = { cas_number: string | null; iupac_name: string | null; common_name: string | null; display_name_short: string | null }
  const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as { substances: Row[] }
  const all = snap.substances
  check(`снимок прочитан: ${all.length} веществ`, all.length > 3000)
  // ⚠ Ровно те же ключи и порог, что в SubstancePicker / SubstanceFilterBrowse — иначе прогон врёт.
  const fuse = new Fuse(all, {
    keys: ['cas_number', 'iupac_name', 'common_name', 'display_name_short'],
    threshold: 0.3,
    minMatchCharLength: 2,
  })
  const firstCas = (q: string) => fuse.search(q).map(r => r.item.cas_number)[0] ?? null
  const E2E: Array<[string, string]> = [
    ['１０８－８８－３', '108-88-3'],   // толуол — ×5 в логе
    ['CAS 108-88-3', '108-88-3'],
    ['CAS No. 67-64-1', '67-64-1'],  // ацетон
    ['108‑88‑3', '108-88-3'],
    ['ＣＡＳ：６７－６４－１', '67-64-1'],
  ]
  for (const [q, cas] of E2E) {
    const got = firstCas(normalizeSearchQuery(q))
    check(`${JSON.stringify(q)} → первым ${cas}`, got === cas, `первым ${got}`)
  }
  // Контроль: сторож проверен снятием того, что он сторожит — без чистки толуол НЕ находится.
  check('контроль: без чистки «１０８－８８－３» толуола не находит', firstCas('１０８－８８－３') !== '108-88-3')
  check('контроль: без чистки «CAS 108-88-3» толуол не первый', firstCas('CAS 108-88-3') !== '108-88-3')
}

console.log(`\n${failed === 0 ? '✅' : '❌'} check:search — ${total - failed} из ${total}`)
process.exit(failed === 0 ? 0 : 1)
