// Проверка A0: разбор всех строк Annex VI Table 3 в пары «класс + категория
// реестра» с обратной сверкой — без сборки Astro и без базы.
//
//   npm run check:classifier
//   (= node --experimental-strip-types scripts/check-classifier.ts)
//
// Снимки: scripts/fixtures/annex6-table3.json (4 419 строк `annex6_table3`,
// session 78) и scripts/fixtures/annex6-registry.json (`hazard_category_mapping`
// ⋈ `hazard_class_catalog`). ⚠ При новой консолидации / новом классе в реестре
// снимки переснять (`scripts/build-annex6-classification.ts --dump-fixtures`).
//
// Приёмка (design-doc §4.1): 100 % строк разобраны; у каждой пары есть H-код
// в строке либо строка — в `ROW_ERRATA`; остаток H-кодов без пары — только у
// errata `class-missing`; каждая пара есть в реестре (дыра `SKIN_CORR_IRRIT '1'`
// закрыта №102 в s78). Любое «none» без причины — красное.
import { readFileSync } from 'node:fs';
import {
  parseAnnex6Row, RegistryIndex, ANNEX6_CLASSIFICATION_PARSER_VERSION,
  type Annex6Row, type RegistryRow, type RowErratumLite, type RowResult,
} from '../src/lib/classifier/annex6Classification.ts';
import { rowErratumFor, ROW_ERRATA_INDEX_NUMBERS } from '../src/lib/annex6RowErrata.ts';

const here = (p: string) => new URL(p, import.meta.url);
const t3 = JSON.parse(readFileSync(here('./fixtures/annex6-table3.json'), 'utf8')) as { rows: [string, string[], string[]][] };
const rg = JSON.parse(readFileSync(here('./fixtures/annex6-registry.json'), 'utf8')) as { rows: [string, string, string | null][] };

const rows: Annex6Row[] = t3.rows.map(([index_number, class_cat_raw, hazard_h_raw]) => ({ index_number, class_cat_raw, hazard_h_raw }));
const registry = new RegistryIndex(rg.rows.map(([classCode, categoryCode, hCode]): RegistryRow => ({ classCode, categoryCode, hCode })));

function erratumLite(index: string): RowErratumLite | null {
  const e = rowErratumFor(index);
  return e ? { kind: e.kind, shownStatements: e.shownStatements, printedStatements: e.printedStatements, impliedClasses: e.impliedClasses } : null;
}

export function runAll(): RowResult[] {
  return rows.map((r) => parseAnnex6Row(r, registry, erratumLite(r.index_number)));
}

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
  else console.log(`  ✓ ${name}`);
}
const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;

const results = runAll();
const pairs = results.flatMap((r) => r.pairs);
const byIndex = new Map(results.map((r) => [r.indexNumber, r]));

console.log(`A0 · ${ANNEX6_CLASSIFICATION_PARSER_VERSION}`);
console.log(`строк: ${results.length} · пар: ${pairs.length} · errata-строк в словаре: ${ROW_ERRATA_INDEX_NUMBERS.length}\n`);

// ── 1. покрытие ─────────────────────────────────────────────────────────────
console.log('1. Покрытие колонки (3)');
check('4 419 строк в снимке', results.length === 4419, String(results.length));
const unparsed = results.filter((r) => r.rowFlags.includes('UNPARSED'));
check('ни одного нераспознанного куска', unparsed.length === 0,
  unparsed.slice(0, 10).map((r) => `${r.indexNumber}: «${r.unparsed.join(' | ')}» из «${r.normalizedClassCat}»`).join('\n      '));
check('у каждой строки ≥ 1 пара либо флаг PHYS_TEST_REQUIRED',
  results.every((r) => r.pairs.length > 0 || r.rowFlags.includes('PHYS_TEST_REQUIRED')),
  results.filter((r) => r.pairs.length === 0 && !r.rowFlags.includes('PHYS_TEST_REQUIRED')).map((r) => r.indexNumber).join(','));

// ── 2. обратная сверка пара → H-код ─────────────────────────────────────────
console.log('\n2. Обратная сверка «пара → H-код в строке или errata»');
const hMissing = pairs.filter((p) => p.flags.includes('H_MISSING'));
check('ни одной пары без H-кода вне errata / NO_H_IN_ANNEX6', hMissing.length === 0,
  hMissing.slice(0, 12).map((p) => `${p.indexNumber} ${p.raw} [${byIndex.get(p.indexNumber)!.normalizedH}]`).join('\n      '));
const routeUnknown = pairs.filter((p) => p.flags.includes('ROUTE_UNKNOWN'));
check('у каждого Acute Tox. определён путь', routeUnknown.length === 0,
  routeUnknown.slice(0, 12).map((p) => `${p.indexNumber} ${p.raw}`).join(', '));
const mismatch = pairs.filter((p) => p.flags.includes('H_MISMATCH'));
check('H-код строки = H-код реестра для пары', mismatch.length === 0,
  mismatch.slice(0, 12).map((p) => `${p.indexNumber} ${p.classCode}/${p.categoryCode} ${p.hCode}`).join(', '));
const unmatched = results.filter((r) => r.rowFlags.includes('H_UNMATCHED'));
check('остаток H-кодов без пары — только у errata class-missing', unmatched.length === 0,
  unmatched.slice(0, 12).map((r) => `${r.indexNumber}: ${r.unmatchedH.join(' ')} · (3)=«${r.normalizedClassCat}»`).join('\n      '));
const errataPairs = pairs.filter((p) => p.flags.includes('ERRATA_ROW'));
check('пары по errata: ровно 6 (009-017 H260 · 609-010 H200 · 006-014 H400 · 012-002 H251 · 607-225 H242 · 602-091 H411)', errataPairs.length === 6,
  errataPairs.map((p) => `${p.indexNumber} ${p.hCode}`).join(', '));
check('errata-строк: 9', ROW_ERRATA_INDEX_NUMBERS.length === 9, String(ROW_ERRATA_INDEX_NUMBERS.length));

// ── 3. реестр ───────────────────────────────────────────────────────────────
console.log('\n3. Язык реестра');
const gaps = pairs.filter((p) => p.flags.includes('REGISTRY_GAP'));
const gapKinds = [...new Set(gaps.map((p) => `${p.classCode}/${p.categoryCode}`))];
check('ни одной пары вне реестра (REGISTRY_GAP = 0; Skin Corr. 1 добавлена в реестр №102)', gaps.length === 0, gapKinds.join(', '));
check('SKIN_CORR_IRRIT/1 — 9 строк Annex VI (замер s77)', count(pairs, (p) => p.classCode === 'SKIN_CORR_IRRIT' && p.categoryCode === '1') === 9,
  String(count(pairs, (p) => p.classCode === 'SKIN_CORR_IRRIT' && p.categoryCode === '1')));
check('все классы пар есть в каталоге', pairs.every((p) => registry.hasClass(p.classCode)),
  [...new Set(pairs.filter((p) => !registry.hasClass(p.classCode)).map((p) => p.classCode))].join(','));
const noCat = pairs.filter((p) => p.categoryCode == null);
check('категория null только у Press. Gas и «Expl. ****»',
  noCat.every((p) => p.classCode === 'GAS_PRESSURE' || (p.classCode === 'EXPLOSIVES' && p.testRequired)),
  [...new Set(noCat.filter((p) => !(p.classCode === 'GAS_PRESSURE' || p.classCode === 'EXPLOSIVES')).map((p) => p.indexNumber + ' ' + p.raw))].join(', '));

// ── 4. точечные проверки ───────────────────────────────────────────────────
console.log('\n4. Точечные проверки');
const pr = (i: string) => byIndex.get(i)!.pairs.map((p) => `${p.classCode}/${p.categoryCode ?? '∅'}:${p.hCodeFull ?? '∅'}${p.star ? '*' : ''}${p.testRequired ? '****' : ''}`);
check('001-001-00-9 hydrogen → FLAM_GAS/1A:H220 + GAS_PRESSURE/∅',
  pr('001-001-00-9').join(' ') === 'FLAM_GAS/1A:H220 GAS_PRESSURE/∅:∅', pr('001-001-00-9').join(' '));
check('007-006-00-2 ethyl nitrite → 3× Acute Tox. 4 * по путям inhal/dermal/oral',
  pr('007-006-00-2').slice(2).join(' ') === 'ACUTE_TOX_INHAL/4:H332* ACUTE_TOX_DERMAL/4:H312* ACUTE_TOX_ORAL/4:H302*', pr('007-006-00-2').join(' '));
check('009-002-00-6 hydrogen fluoride → inhal 2 · dermal 1 · oral 2 (порядок печати)',
  pr('009-002-00-6').join(' ') === 'ACUTE_TOX_INHAL/2:H330* ACUTE_TOX_DERMAL/1:H310 ACUTE_TOX_ORAL/2:H300* SKIN_CORR_IRRIT/1A:H314', pr('009-002-00-6').join(' '));
check('612-199-00-7 «Carc. 1B Muta.» | «1B Repr. 2» → склейка ячеек даёт MUTAGEN/1B',
  pr('612-199-00-7').join(' ') === 'CARCINOGEN/1B:H350 MUTAGEN/1B:H340 REPRO_TOX/2:H361f ACUTE_TOX_INHAL/3:H331* ACUTE_TOX_DERMAL/3:H311* ACUTE_TOX_ORAL/3:H301* AQUATIC_CHRONIC/2:H411', pr('612-199-00-7').join(' '));
check('612-199-00-7 H361f *** → hMarker «***»', byIndex.get('612-199-00-7')!.pairs[2]!.hMarker === '***');
check('603-023-00-X → STOT_SE/3:H335 и STOT_SE/3 narcotic:H336',
  pr('603-023-00-X').includes('STOT_SE/3:H335') && pr('603-023-00-X').includes('STOT_SE/3 narcotic:H336'), pr('603-023-00-X').join(' '));
check('602-008-00-5 «Aquatic» | «Chronic 3» → AQUATIC_CHRONIC/3:H412', pr('602-008-00-5').includes('AQUATIC_CHRONIC/3:H412'), pr('602-008-00-5').join(' '));
check('016-089-00-4 Self-react. C **** → SELF_REACTIVE/Type C and D:H242****', pr('016-089-00-4')[0] === 'SELF_REACTIVE/Type C and D:H242****', pr('016-089-00-4').join(' '));
check('053-003-00-4 Expl. **** → EXPLOSIVES/∅ NO_H_IN_ANNEX6 + testRequired',
  byIndex.get('053-003-00-4')!.pairs[0]!.flags.includes('NO_H_IN_ANNEX6') && byIndex.get('053-003-00-4')!.pairs[0]!.testRequired);
check('603-227-00-9 голые **** → PHYS_TEST_REQUIRED, пары только водные',
  byIndex.get('603-227-00-9')!.rowFlags.includes('PHYS_TEST_REQUIRED') && pr('603-227-00-9').join(' ') === 'AQUATIC_ACUTE/1:H400 AQUATIC_CHRONIC/1:H410', pr('603-227-00-9').join(' '));
check('649-378-00-4 petrol (s76) → Carc 1B · Muta 1B · Asp 1, без FLAM_LIQ',
  pr('649-378-00-4').join(' ') === 'CARCINOGEN/1B:H350 MUTAGEN/1B:H340 ASPIRATION/1:H304', pr('649-378-00-4').join(' '));
check('649-297-00-4 «Muta. 1B A» → MUTAGEN/1B с TYPO_FIXED',
  byIndex.get('649-297-00-4')!.pairs[1]!.categoryCode === '1B' && byIndex.get('649-297-00-4')!.pairs[1]!.flags.includes('TYPO_FIXED'));
check('604-016-00-4 «Carc. 1Β» (бета) → CARCINOGEN/1B TYPO_FIXED',
  byIndex.get('604-016-00-4')!.pairs.some((p) => p.classCode === 'CARCINOGEN' && p.categoryCode === '1B' && p.flags.includes('TYPO_FIXED')), pr('604-016-00-4').join(' '));
check('009-017-00-8 errata mismatch → WATER_REACTIVE/1:H260 (ERRATA_ROW), H270 в остатке без H_UNMATCHED',
  pr('009-017-00-8').includes('WATER_REACTIVE/1:H260') && !byIndex.get('009-017-00-8')!.rowFlags.includes('H_UNMATCHED'),
  pr('009-017-00-8').join(' ') + ' rest=' + byIndex.get('009-017-00-8')!.unmatchedH.join(','));
check('649-175-00-0 errata class-missing → нет MUTAGEN, H340 в остатке без H_UNMATCHED',
  !pr('649-175-00-0').some((s) => s.startsWith('MUTAGEN')) && byIndex.get('649-175-00-0')!.unmatchedH.includes('H340') && !byIndex.get('649-175-00-0')!.rowFlags.includes('H_UNMATCHED'),
  pr('649-175-00-0').join(' '));
check('006-014-00-3 errata statement-missing → AQUATIC_ACUTE/1:H400 ERRATA_ROW',
  byIndex.get('006-014-00-3')!.pairs.some((p) => p.classCode === 'AQUATIC_ACUTE' && p.hCode === 'H400' && p.flags.includes('ERRATA_ROW')), pr('006-014-00-3').join(' '));
check('012-002-00-9 magnesium (errata s78) → SELF_HEATING/1:H251, H252 в остатке без H_UNMATCHED',
  pr('012-002-00-9').includes('SELF_HEATING/1:H251') && byIndex.get('012-002-00-9')!.unmatchedH.includes('H252') && !byIndex.get('012-002-00-9')!.rowFlags.includes('H_UNMATCHED'),
  pr('012-002-00-9').join(' '));
check('607-225-00-9 (errata s78) → SELF_REACTIVE/Type C and D:H242****',
  pr('607-225-00-9')[0] === 'SELF_REACTIVE/Type C and D:H242****' && !byIndex.get('607-225-00-9')!.rowFlags.includes('H_UNMATCHED'), pr('607-225-00-9').join(' '));
check('602-091-00-8 (errata class-omitted s78) → AQUATIC_CHRONIC/2:H411 ERRATA_ROW, остатка нет',
  byIndex.get('602-091-00-8')!.pairs.some((p) => p.classCode === 'AQUATIC_CHRONIC' && p.categoryCode === '2' && p.hCode === 'H411' && p.flags.includes('ERRATA_ROW'))
  && byIndex.get('602-091-00-8')!.unmatchedH.length === 0, pr('602-091-00-8').join(' '));
check('016-011-00-9 H370 (respiratory system) (inhalation) → organs',
  byIndex.get('016-011-00-9')!.pairs.find((p) => p.hCode === 'H370')?.organs === 'respiratory system; inhalation',
  String(byIndex.get('016-011-00-9')!.pairs.find((p) => p.hCode === 'H370')?.organs));
check('607-699-00-7 «H372 (nervous» | «system) H317» → organs «nervous system», H317 найден',
  byIndex.get('607-699-00-7')!.pairs.find((p) => p.hCode === 'H372')?.organs === 'nervous system' && pr('607-699-00-7').some((s) => s.endsWith(':H317')),
  pr('607-699-00-7').join(' '));
check('050-034-00-5 Skin Corr. 1 → SKIN_CORR_IRRIT/1:H314, в реестре, без флагов',
  byIndex.get('050-034-00-5')!.pairs.some((p) => p.categoryCode === '1' && p.classCode === 'SKIN_CORR_IRRIT' && p.hCode === 'H314' && p.flags.length === 0));
check('601-023-00-4 «H373» | «(hearing organs)» → organs «hearing organs»',
  byIndex.get('601-023-00-4')!.pairs.find((p) => p.hCode === 'H373')?.organs === 'hearing organs');
check('Eye Irrit. 2 → 2A с флагом, 2B нигде',
  pairs.filter((p) => p.classCode === 'EYE_DAMAGE_IRRIT' && p.categoryRaw === '2').every((p) => p.categoryCode === '2A' && p.flags.includes('EYE_IRRIT_2_AS_2A'))
  && !pairs.some((p) => p.categoryCode === '2B'));
check('Flam. Gas 1 → 1A с LEGACY_FLAM_GAS_1, все с H220',
  pairs.filter((p) => p.flags.includes('LEGACY_FLAM_GAS_1')).every((p) => p.categoryCode === '1A' && p.hCode === 'H220'));

// ── 5. статистика ──────────────────────────────────────────────────────────
console.log('\n5. Статистика');
const byClass = new Map<string, number>();
for (const p of pairs) byClass.set(p.classCode, (byClass.get(p.classCode) ?? 0) + 1);
console.log('  пар по классам: ' + [...byClass.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
const flagCount = new Map<string, number>();
for (const p of pairs) for (const f of p.flags) flagCount.set(f, (flagCount.get(f) ?? 0) + 1);
for (const r of results) for (const f of r.rowFlags) flagCount.set('row:' + f, (flagCount.get('row:' + f) ?? 0) + 1);
console.log('  флаги: ' + [...flagCount.entries()].sort().map(([k, v]) => `${k} ${v}`).join(' · '));
console.log(`  star (*): ${count(pairs, (p) => p.star)} · **** : ${count(pairs, (p) => p.testRequired)} · hMarker ** : ${count(pairs, (p) => p.hMarker === '**')} · *** : ${count(pairs, (p) => p.hMarker === '***')} · organs: ${count(pairs, (p) => p.organs != null)}`);
const forms = new Set(rows.flatMap((r) => r.class_cat_raw));
console.log(`  различных форм ячейки (3): ${forms.size}`);

console.log(failed ? `\n✗ ПРОВАЛЕНО: ${failed}` : '\n✓ A0 зелёный');
process.exit(failed ? 1 : 0);
