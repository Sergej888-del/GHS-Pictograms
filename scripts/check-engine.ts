// Проверка КАРКАСА классификатора смесей — `src/lib/classifier/*` — без сборки
// Astro и без базы (фикстуры в коде).
//
//   npm run check:engine
//   (= node --experimental-strip-types scripts/check-engine.ts)
//
// ⭐⭐⭐ ЧТО ИМЕННО СТОРОЖИТ ЭТОТ ФАЙЛ. Не арифметику — её сторожит
// `check:ate` (54 проверки модуля A1). Здесь проверяется КОНТРАКТ выдачи,
// который легко пробить незаметно (design-doc §5.2, §6.3):
//   1. у строки `classified`/`not_classified` есть `rule_key` И дословный `raw`;
//   2. у строки `insufficient_data`/`not_computed` есть причина;
//   3. каждый `rule_key` из результата существует в таблице правил;
//   4. на каждый класс реестра ровно одна строка — ни пропусков, ни дублей;
//   5. ни одного критического предупреждения каркаса (RULE_MISSING,
//      REGISTRY_GAP, MODULE_CONFLICT, MODULE_OVERLAP, REASON_MISSING);
//   6. классы модулей не пересекаются и у каждого класса есть владелец.
// ⛔ Пустая ячейка без причины — запрещена (урок session 76: «none» в колонке
//    читается как «неопасно», а на деле это была потеря данных).

import { classifyMixture, normalize, ENGINE_VERSION } from '../src/lib/classifier/engine.ts';
import { DEFAULT_MODULES } from '../src/lib/classifier/modules/index.ts';
import { RuleIndex, Registry } from '../src/lib/classifier/data.ts';
import type {
  ClassifierData, ClassifierResult, ComponentInput, GenericLimitRow, MixtureInput, RegistryEntry,
} from '../src/lib/classifier/types.ts';

let failed = 0;
let total = 0;
function check(name: string, cond: boolean, detail = ''): void {
  total++;
  if (!cond) { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
  else console.log(`  ✓ ${name}`);
}

/* ── фикстура правил: строки `clp_generic_limits`, на которые ссылается A1 ── */

function rule(p: Partial<GenericLimitRow> & { ruleKey: string; raw: string }): GenericLimitRow {
  return {
    kind: 'SPECIAL', classCode: 'ACUTE_TOX', catalogCodes: null, ghsChapter: '3.1',
    ingredientCategory: null, resultCategory: null, physicalState: null, operator: null,
    limitLow: null, limitHigh: null, unit: null, weightFactor: null, value: null, valueUnit: null,
    formulaRaw: null, sourceRef: null, sourceSection: null, marker: 'B', note: null,
    needsReview: false, ...p,
  };
}

const RULES: GenericLimitRow[] = [
  rule({ ruleKey: '3.1.3.6.1', sourceRef: '3.1.3.6.1', formulaRaw: '100 / ATE_mix = Σ (C_i / ATE_i)',
    raw: 'The ATE of the mixture is determined by calculation from the ATE values for all relevant ingredients according to the following formula for Oral, Dermal or Inhalation Toxicity: …' }),
  rule({ ruleKey: '3.1.3.6.1b-NONHAZARD', sourceRef: '3.1.3.6.1(b)',
    raw: '(b) ignore ingredients that are presumed not acutely toxic (e.g., water, sugar);' }),
  rule({ ruleKey: '3.1.3.6.2.3-UNKNOWN-GT10', kind: 'UNKNOWN_INGREDIENT', marker: 'M4', sourceRef: '3.1.3.6.2.3',
    formulaRaw: '(100 − Σ C_unknown) / ATE_mix = Σ (C_i / ATE_i)', operator: '>', limitLow: 10, unit: '%',
    raw: 'If the total concentration of the relevant ingredient(s) with unknown toxicity is > 10 %, the formula presented in section 3.1.3.6.1 shall be corrected to adjust for the percentage of the unknown ingredient(s)' }),
  rule({ ruleKey: '3.1.3.6.2.3-UNKNOWN-LE10', kind: 'UNKNOWN_INGREDIENT', marker: 'M4', sourceRef: '3.1.3.6.2.3',
    operator: '<=', limitHigh: 10, unit: '%',
    raw: 'If the total concentration of the relevant ingredient(s) with unknown acute toxicity is ≤ 10 % then the formula presented in section 3.1.3.6.1 shall be used.' }),
  rule({ ruleKey: '3.1.3.3a-RELEVANT', kind: 'RELEVANT', sourceRef: '3.1.3.3(a)', operator: '>=', limitLow: 1,
    raw: 'the ‘relevant ingredients’ of a mixture are those which are present in concentrations of 1 % … or greater …' }),
  rule({ ruleKey: 'T1.1-ACUTE_TOX-CAT1-3', kind: 'CUTOFF', marker: 'M19', sourceRef: 'Table 1.1',
    operator: '>=', limitLow: 0.1, unit: '%', raw: '— Category 1-3 | 0,1 %' }),
  rule({ ruleKey: 'T1.1-ACUTE_TOX-CAT4', kind: 'CUTOFF', marker: 'M19', sourceRef: 'Table 1.1',
    operator: '>=', limitLow: 1, unit: '%', raw: '— Category 4 | 1 %' }),
];

/* ── фикстура реестра ────────────────────────────────────────────────────────
   ⚠ Список классов ОБЯЗАН совпадать с `hazard_class_catalog` (37 строк:
   33 GHS + 4 EU-only). Появился класс в каталоге — эта фикстура покраснеет
   на проверке «фикстура покрывает каталог», и её надо дополнить вместе с
   реестром модулей: класс без владельца печатается безымянным «not computed». */

const CLASS_ORDER: [string, string, number][] = [
  ['EXPLOSIVES', 'Explosives', 10], ['FLAM_GAS', 'Flammable gases', 11], ['AEROSOL', 'Aerosols', 12],
  ['OX_GAS', 'Oxidising gases', 13], ['GAS_PRESSURE', 'Gases under pressure', 14],
  ['FLAM_LIQ', 'Flammable liquids', 15], ['FLAM_SOL', 'Flammable solids', 16],
  ['SELF_REACTIVE', 'Self-reactive substances and mixtures', 17], ['PYRO_LIQ', 'Pyrophoric liquids', 18],
  ['PYRO_SOL', 'Pyrophoric solids', 19], ['SELF_HEATING', 'Self-heating substances and mixtures', 20],
  ['WATER_REACTIVE', 'Substances which in contact with water emit flammable gases', 21],
  ['OX_LIQ', 'Oxidising liquids', 22], ['OX_SOL', 'Oxidising solids', 23],
  ['ORG_PEROXIDE', 'Organic peroxides', 24], ['CORR_METAL', 'Corrosive to metals', 25],
  ['DESENS_EXPLOSIVE', 'Desensitised explosives', 26],
  ['ACUTE_TOX_ORAL', 'Acute toxicity - oral', 30], ['ACUTE_TOX_DERMAL', 'Acute toxicity - dermal', 31],
  ['ACUTE_TOX_INHAL', 'Acute toxicity - inhalation', 32],
  ['SKIN_CORR_IRRIT', 'Skin corrosion/irritation', 33],
  ['EYE_DAMAGE_IRRIT', 'Serious eye damage/eye irritation', 34],
  ['RESP_SENS', 'Respiratory sensitisation', 35], ['SKIN_SENS', 'Skin sensitisation', 36],
  ['MUTAGEN', 'Germ cell mutagenicity', 37], ['CARCINOGEN', 'Carcinogenicity', 38],
  ['REPRO_TOX', 'Reproductive toxicity', 39],
  ['STOT_SE', 'Specific target organ toxicity - single exposure', 40],
  ['STOT_RE', 'Specific target organ toxicity - repeated exposure', 41],
  ['ASPIRATION', 'Aspiration hazard', 42], ['ED_HH', 'Endocrine disruption (human health)', 43],
  ['AQUATIC_ACUTE', 'Hazardous to the aquatic environment - acute', 50],
  ['AQUATIC_CHRONIC', 'Hazardous to the aquatic environment - chronic', 51],
  ['ED_ENV', 'Endocrine disruption (environment)', 52], ['PBT_VPVB', 'PBT / vPvB', 53],
  ['PMT_VPVM', 'PMT / vPvM', 54], ['OZONE', 'Hazardous to the ozone layer', 55],
];

/** Категории Acute Tox. и STOT SE — дословно как в `hazard_category_mapping`. */
const REAL_CATEGORIES: Record<string, [string, string | null, string | null, string | null][]> = {
  ACUTE_TOX_ORAL: [['1', 'H300', 'GHS06', 'Danger'], ['2', 'H300', 'GHS06', 'Danger'], ['3', 'H301', 'GHS06', 'Danger'], ['4', 'H302', 'GHS07', 'Warning'], ['5', 'H303', null, 'Warning']],
  ACUTE_TOX_DERMAL: [['1', 'H310', 'GHS06', 'Danger'], ['2', 'H310', 'GHS06', 'Danger'], ['3', 'H311', 'GHS06', 'Danger'], ['4', 'H312', 'GHS07', 'Warning'], ['5', 'H313', null, 'Warning']],
  ACUTE_TOX_INHAL: [['1', 'H330', 'GHS06', 'Danger'], ['2', 'H330', 'GHS06', 'Danger'], ['3', 'H331', 'GHS06', 'Danger'], ['4', 'H332', 'GHS07', 'Warning'], ['5', 'H333', null, 'Warning']],
  STOT_SE: [['1', 'H370', 'GHS08', 'Danger'], ['2', 'H371', 'GHS08', 'Warning'], ['3', 'H335', 'GHS07', 'Warning'], ['3 narcotic', 'H336', 'GHS07', 'Warning']],
};

const REGISTRY: RegistryEntry[] = CLASS_ORDER.flatMap(([classCode, className, displayOrder]) => {
  const cats = REAL_CATEGORIES[classCode] ?? [['1', null, null, null] as [string, string | null, string | null, string | null]];
  return cats.map(([categoryCode, hCode, pictogramCode, signalWord]) => ({
    classCode, className, groupType: null,
    euOnly: ['ED_HH', 'ED_ENV', 'PBT_VPVB', 'PMT_VPVM'].includes(classCode),
    displayOrder, ghsChapter: null, categoryCode, hCode, pictogramCode, signalWord,
  }));
});

const DATA: ClassifierData = {
  generic: RULES,
  registry: REGISTRY,
  release: {
    releaseKey: 'fixture', annex6Consolidation: '02008R1272-20260501', atp: 'fixture',
    engineVersion: ENGINE_VERSION, parserVersion: null, gclMd5: null, limitsMd5: null,
    classificationMd5: null, releasedAt: '2026-08-22T00:00:00Z', note: 'check-engine fixture',
  },
};

/* ── фикстура состава: метанол + едкий натр + вода ──────────────────────── */

function methanol(conc: number): ComponentInput {
  return {
    id: 'methanol', source: 'annex6', indexNumber: '603-001-00-X', casPrimary: '67-56-1', name: 'methanol',
    conc,
    classifications: [
      { classCode: 'FLAM_LIQ', categoryCode: '2', hCode: 'H225', raw: 'Flam. Liq. 2' },
      { classCode: 'ACUTE_TOX_INHAL', categoryCode: '3', hCode: 'H331', star: true, raw: 'Acute Tox. 3' },
      { classCode: 'ACUTE_TOX_DERMAL', categoryCode: '3', hCode: 'H311', star: true, raw: 'Acute Tox. 3' },
      { classCode: 'ACUTE_TOX_ORAL', categoryCode: '3', hCode: 'H301', star: true, raw: 'Acute Tox. 3' },
      { classCode: 'STOT_SE', categoryCode: '1', hCode: 'H370', raw: 'STOT SE 1' },
    ],
  };
}
function naoh(conc: number): ComponentInput {
  return {
    id: 'naoh', source: 'annex6', indexNumber: '011-002-00-6', casPrimary: '1310-73-2', name: 'sodium hydroxide',
    conc,
    classifications: [{ classCode: 'SKIN_CORR_IRRIT', categoryCode: '1A', hCode: 'H314', raw: 'Skin Corr. 1A' }],
  };
}
function water(conc: number, stated = false): ComponentInput {
  return { id: 'water', source: 'supplier', name: 'water (carrier)', conc, classifications: [], knownNonhazard: stated };
}

function mixture(components: ComponentInput[], over: Partial<MixtureInput['properties']> = {}): MixtureInput {
  return { components, properties: { physicalState: 'liquid', inhalForm: 'vapour', ...over }, audience: 'professional' };
}

const run = (m: MixtureInput): ClassifierResult => classifyMixture(m, DATA, { computedAt: '2026-08-22T00:00:00Z' });
const of = (r: ClassifierResult, cls: string) => r.decisions.find((d) => d.classCode === cls);

console.log(`Каркас классификатора — ${ENGINE_VERSION}\n`);

/* ── 1. статика каркаса ─────────────────────────────────────────────────── */
console.log('1. Каркас и реестр модулей');

const registry = new Registry(REGISTRY);
const rules = new RuleIndex(RULES);

check('фикстура покрывает каталог: 37 классов', registry.classes().length === 37, String(registry.classes().length));

const owned = new Map<string, string>();
const dup: string[] = [];
for (const m of DEFAULT_MODULES) {
  for (const cls of m.classes) {
    if (owned.has(cls)) dup.push(`${cls} (${owned.get(cls)} / ${m.key})`);
    else owned.set(cls, m.key);
  }
}
check('классы модулей не пересекаются', dup.length === 0, dup.join(', '));

const orphan = registry.classes().filter((c) => !owned.has(c));
check('у каждого класса реестра есть модуль-владелец', orphan.length === 0, orphan.join(', '));

const ghost = [...owned.keys()].filter((c) => !registry.hasClass(c));
check('модули не заявляют классов, которых нет в реестре', ghost.length === 0, ghost.join(', '));

check('реализован ровно один модуль (A1)', DEFAULT_MODULES.filter((m) => m.implemented).map((m) => m.key).join(',') === 'A1');

/* ── 2. нормализация ────────────────────────────────────────────────────── */
console.log('\n2. Нормализация входа');

const n1 = normalize(mixture([methanol(25), naoh(5), water(70)]));
check('сумма 100 %, остаток 0 %', Math.abs(n1.composition.sumConc - 100) < 1e-9 && Math.abs(n1.composition.remainder) < 1e-9);
check('форма ингаляции по умолчанию для жидкости — vapour', normalize(mixture([methanol(10)], { inhalForm: null })).inhalForm === 'vapour');
check('для твёрдого — dust_mist, для газа — gas',
  normalize(mixture([methanol(10)], { physicalState: 'solid', inhalForm: null })).inhalForm === 'dust_mist'
  && normalize(mixture([methanol(10)], { physicalState: 'gas', inhalForm: null })).inhalForm === 'gas');

const rangeComp: ComponentInput = { ...methanol(10), concMax: 30 };
const nRange = normalize(mixture([rangeComp]));
check('диапазон 10–30 % считается по верху (worst case) и помечается',
  nRange.components[0]!.conc === 30 && nRange.components[0]!.worstCase && nRange.composition.worstCase);

/* ── 3. контракт выдачи ─────────────────────────────────────────────────── */
console.log('\n3. Контракт выдачи (design-doc §5.2)');

const r1 = run(mixture([methanol(25), naoh(5), water(70)]));

check('строк ровно по числу классов реестра', r1.decisions.length === registry.classes().length,
  `${r1.decisions.length} vs ${registry.classes().length}`);
check('ни одного дубля класса', new Set(r1.decisions.map((d) => d.classCode)).size === r1.decisions.length);

const noRule = r1.decisions.filter((d) => (d.status === 'classified' || d.status === 'not_classified') && (!d.ruleKey || !d.raw));
check('у classified / not_classified есть rule_key И дословный raw', noRule.length === 0,
  noRule.map((d) => d.classCode).join(', '));

const noReason = r1.decisions.filter((d) => (d.status === 'insufficient_data' || d.status === 'not_computed') && !d.reason);
check('у insufficient_data / not_computed есть причина', noReason.length === 0,
  noReason.map((d) => d.classCode).join(', '));

const unknownKey = r1.decisions.filter((d) => d.ruleKey && !rules.has(d.ruleKey));
check('каждый rule_key результата существует в таблице правил', unknownKey.length === 0,
  unknownKey.map((d) => `${d.classCode}:${d.ruleKey}`).join(', '));

const CRITICAL = ['RULE_MISSING', 'REASON_MISSING', 'REGISTRY_GAP', 'MODULE_CONFLICT', 'MODULE_OVERLAP'];
const crit = r1.decisions.flatMap((d) => d.warnings.filter((w) => CRITICAL.includes(w.code)).map((w) => `${d.classCode}:${w.code}`))
  .concat(r1.warnings.filter((w) => CRITICAL.includes(w.code)).map((w) => w.code));
check('ни одного критического предупреждения каркаса', crit.length === 0, crit.join(', '));

check('у not_computed назван модуль-владелец',
  r1.decisions.filter((d) => d.status === 'not_computed').every((d) => /module A[1-6]/.test(d.reason ?? '')));
check('not_computed про Skin corr. называет компонент, который несёт класс',
  (of(r1, 'SKIN_CORR_IRRIT')?.reason ?? '').includes('sodium hydroxide'), of(r1, 'SKIN_CORR_IRRIT')?.reason ?? '');
check('версия движка и релиз доехали в ответ', r1.engineVersion === ENGINE_VERSION && r1.release?.releaseKey === 'fixture');
check('метка времени пришла снаружи', r1.computedAt === '2026-08-22T00:00:00Z');

/* ── 4. эхо входа для отчёта (PDF и share) ──────────────────────────────── */
console.log('\n4. Эхо входа для отчёта');

check('в ответе есть все компоненты', r1.input.components.length === 3);
const echoMeth = r1.input.components.find((c) => c.id === 'methanol')!;
check('эхо несёт что ввели и что взяли в расчёт', echoMeth.concEntered.min === 25 && echoMeth.concUsed === 25 && !echoMeth.worstCase);
check('эхо несёт классификации компонента', echoMeth.classifications.length === 5);
const echoRange = run(mixture([rangeComp])).input.components[0]!;
check('при диапазоне эхо печатает обе границы', echoRange.concEntered.min === 10 && echoRange.concEntered.max === 30 && echoRange.concUsed === 30);
check('эхо несёт свойства смеси и аудиторию',
  r1.input.properties.physicalState === 'liquid' && r1.input.audience === 'professional');

/* ── 5. A1 в каркасе: тот же ответ, что у check:ate ─────────────────────── */
console.log('\n5. A1 через каркас');

const oral = of(r1, 'ACUTE_TOX_ORAL')!;
check('метанол 25 % + 75 % неизвестных → oral Category 3, provisional',
  oral.status === 'classified' && oral.categoryCode === '3' && oral.provisional === true,
  `${oral.status} ${oral.categoryCode}`);
check('правило — коррекция 3.1.3.6.2.3', oral.ruleKey === '3.1.3.6.2.3-UNKNOWN-GT10', String(oral.ruleKey));
check('H-код и пиктограмма пришли из реестра', oral.hCode === 'H301' && oral.pictogramCode === 'GHS06' && oral.signalWord === 'Danger');
check('в строке есть вклад каждого компонента', oral.contributions.length === 3);
check('учтён только метанол', oral.contributions.filter((c) => c.counted).map((c) => c.componentId).join(',') === 'methanol');
check('вода помечена как «нет данных, считается в Σ C(unknown)»',
  (oral.contributions.find((c) => c.componentId === 'water')?.provenance ?? '').includes('Σ C(unknown)'));
check('предупреждение о звёздочке доехало', oral.warnings.some((w) => w.code === 'STAR'));
check('предупреждение о коррекции доехало', oral.warnings.some((w) => w.code === 'UNKNOWN_GT10'));

const r2 = run(mixture([methanol(25), naoh(5), water(70, true)]));
const oral2 = of(r2, 'ACUTE_TOX_ORAL')!;
check('вода объявлена «данные есть, не классифицирован» → Σ C(unknown) 5 % → Category 4',
  oral2.categoryCode === '4' && oral2.provisional === false && oral2.ruleKey === '3.1.3.6.2.3-UNKNOWN-LE10',
  `${oral2.categoryCode} ${oral2.ruleKey}`);
check('вода вышла из формулы по 3.1.3.6.1(b)',
  (oral2.contributions.find((c) => c.componentId === 'water')?.provenance ?? '').includes('3.1.3.6.1(b)'));
check('dermal и inhalation тоже поехали на 4',
  of(r2, 'ACUTE_TOX_DERMAL')?.categoryCode === '4' && of(r2, 'ACUTE_TOX_INHAL')?.categoryCode === '4');

const r3 = run(mixture([water(100, true)]));
check('только неопасный компонент → not_classified по 3.1.3.6.1(b), а не «нет данных»',
  of(r3, 'ACUTE_TOX_ORAL')?.status === 'not_classified' && of(r3, 'ACUTE_TOX_ORAL')?.ruleKey === '3.1.3.6.1b-NONHAZARD');

const r4 = run(mixture([]));
check('пустой состав → insufficient_data с причиной, а не пустая строка',
  of(r4, 'ACUTE_TOX_ORAL')?.status === 'insufficient_data' && !!of(r4, 'ACUTE_TOX_ORAL')?.reason);

/* ── 6. пары для этикетки и общие предупреждения ────────────────────────── */
console.log('\n6. Выход в конвейер этикетки');

check('labelPairs — только классифицированные строки',
  r1.labelPairs.length === r1.decisions.filter((d) => d.status === 'classified').length);
check('пара несёт H-код, пиктограмму и сигнальное слово',
  r1.labelPairs.every((p) => p.hCode && p.categoryCode));
check('пар острой токсичности три (oral, dermal, inhalation)',
  r1.labelPairs.filter((p) => p.classCode.startsWith('ACUTE_TOX')).length === 3);

const rRem = run(mixture([methanol(25)]));
check('остаток до 100 % — предупреждение, а не тишина',
  rRem.warnings.some((w) => w.code === 'REMAINDER' && w.message.includes('75.0')),
  JSON.stringify(rRem.warnings.map((w) => w.code)));
const rOver = run(mixture([methanol(60), naoh(60)]));
check('сумма больше 100 % — критическое предупреждение',
  rOver.warnings.some((w) => w.code === 'SUM_OVER_100' && w.level === 'critical'));
check('worst case из диапазона — предупреждение',
  run(mixture([rangeComp])).warnings.some((w) => w.code === 'WORST_CASE'));

console.log(`\n${failed ? `✗ ПРОВАЛЕНО: ${failed} из ${total}` : `✓ каркас зелёный — ${total} проверок`}`);
process.exit(failed ? 1 : 0);
