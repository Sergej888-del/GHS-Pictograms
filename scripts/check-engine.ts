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

  /* ── правила модуля A4 (session 82) ────────────────────────────────────────
     ⚠ Ключи, пороги и дословный текст СПИСАНЫ ИЗ ЖИВОЙ БАЗЫ (замер s82,
     `clp_generic_limits`). Если строка в базе изменится, а здесь останется
     старой, покраснеет не эта фикстура, а сверка `check:dist`/прод — поэтому
     менять числа тут «на глаз» нельзя: они цитата, а не настройка. */
  rule({ ruleKey: 'T3.5.2-1A', kind: 'GCL', classCode: 'MUTAGEN', marker: 'M4', sourceRef: 'Table 3.5.2',
    operator: '>=', limitLow: 0.1, unit: '% (w/w; v/v gases)', raw: 'Category 1A mutagen | ≥ 0,1 % | — | —' }),
  rule({ ruleKey: 'T3.5.2-1B', kind: 'GCL', classCode: 'MUTAGEN', marker: 'M4', sourceRef: 'Table 3.5.2',
    operator: '>=', limitLow: 0.1, unit: '% (w/w; v/v gases)', raw: 'Category 1B mutagen | — | ≥ 0,1 % | —' }),
  rule({ ruleKey: 'T3.5.2-2', kind: 'GCL', classCode: 'MUTAGEN', marker: 'M4', sourceRef: 'Table 3.5.2',
    operator: '>=', limitLow: 1.0, unit: '% (w/w; v/v gases)', raw: 'Category 2 mutagen | — | — | ≥ 1,0 %' }),
  rule({ ruleKey: 'T3.6.2-1A', kind: 'GCL', classCode: 'CARCINOGEN', marker: 'M4', sourceRef: 'Table 3.6.2',
    operator: '>=', limitLow: 0.1, unit: '% (w/w; v/v gases)', raw: 'Category 1A carcinogen | ≥ 0,1 % | — | —' }),
  rule({ ruleKey: 'T3.6.2-1B', kind: 'GCL', classCode: 'CARCINOGEN', marker: 'M4', sourceRef: 'Table 3.6.2',
    operator: '>=', limitLow: 0.1, unit: '% (w/w; v/v gases)', raw: 'Category 1B carcinogen | — | ≥ 0,1 % | —' }),
  rule({ ruleKey: 'T3.6.2-2', kind: 'GCL', classCode: 'CARCINOGEN', marker: 'M4', sourceRef: 'Table 3.6.2',
    operator: '>=', limitLow: 1.0, unit: '% (w/w; v/v gases)', raw: 'Category 2 carcinogen | — | — | ≥ 1,0 % [Note 1]' }),
  rule({ ruleKey: 'T3.6.2-2-SDS', kind: 'SDS_TRIGGER', classCode: 'CARCINOGEN', marker: 'B', sourceRef: 'Table 3.6.2 Note 1',
    operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'If a Category 2 carcinogen is present in the mixture as an ingredient at a concentration ≥ 0,1 % a SDS shall be available for the mixture upon request.' }),
  rule({ ruleKey: 'T3.7.2-1A', kind: 'GCL', classCode: 'REPRO_TOX', marker: 'M4', sourceRef: 'Table 3.7.2',
    operator: '>=', limitLow: 0.3, unit: '% (w/w; v/v gases)', raw: 'Category 1A reproductive toxicant | ≥ 0,3 % [Note 1] | | |' }),
  rule({ ruleKey: 'T3.7.2-1B', kind: 'GCL', classCode: 'REPRO_TOX', marker: 'M4', sourceRef: 'Table 3.7.2',
    operator: '>=', limitLow: 0.3, unit: '% (w/w; v/v gases)', raw: 'Category 1B reproductive toxicant | | ≥ 0,3 % [Note 1] | |' }),
  rule({ ruleKey: 'T3.7.2-2', kind: 'GCL', classCode: 'REPRO_TOX', marker: 'M4', sourceRef: 'Table 3.7.2',
    operator: '>=', limitLow: 3.0, unit: '% (w/w; v/v gases)', raw: 'Category 2 reproductive toxicant | | | ≥ 3,0 % [Note 1] |' }),
  rule({ ruleKey: 'T3.7.2-LACT', kind: 'GCL', classCode: 'REPRO_TOX', marker: 'M4', sourceRef: 'Table 3.7.2',
    operator: '>=', limitLow: 0.3, unit: '% (w/w; v/v gases)',
    raw: 'Additional category for effects on or via lactation | | | | ≥ 0,3 % [Note 1]' }),
  rule({ ruleKey: 'T3.7.2-SDS', kind: 'SDS_TRIGGER', classCode: 'REPRO_TOX', marker: 'M4', sourceRef: 'Table 3.7.2 Note 1',
    operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'Note 1: If a Category 1 or Category 2 reproductive toxicant or a substance classified for effects on or via lactation is present in the mixture as an ingredient at a concentration at or above 0,1 %, a SDS shall be available for the mixture upon request.' }),
  rule({ ruleKey: 'T3.11.2-1', kind: 'GCL', classCode: 'ED_HH', marker: 'M32', sourceRef: 'Table 3.11.2',
    operator: '>=', limitLow: 0.1, unit: '% (w/w; v/v gases)', raw: 'Category 1 endocrine disruptor for human health | ≥ 0,1 % |' }),
  rule({ ruleKey: 'T3.11.2-2', kind: 'GCL', classCode: 'ED_HH', marker: 'M32', sourceRef: 'Table 3.11.2',
    operator: '>=', limitLow: 1, unit: '% (w/w; v/v gases)', raw: 'Category 2 endocrine disruptor for human health | | ≥ 1 % [Note 1]' }),
  rule({ ruleKey: 'T3.11.2-2-SDS', kind: 'SDS_TRIGGER', classCode: 'ED_HH', marker: 'M32', sourceRef: 'Table 3.11.2 Note 1',
    operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'Note 1: If a Category 2 endocrine disruptor for human health is present in the mixture as an ingredient at a concentration ≥ 0,1 % a SDS shall be available for the mixture upon request.' }),
  rule({ ruleKey: 'T4.2.2-1', kind: 'GCL', classCode: 'ED_ENV', marker: 'M32', sourceRef: 'Table 4.2.2',
    operator: '>=', limitLow: 0.1, unit: '% (w/w; v/v gases)', raw: 'Category 1 endocrine disruptor for the environment | ≥ 0,1 % |' }),
  rule({ ruleKey: 'T4.2.2-2', kind: 'GCL', classCode: 'ED_ENV', marker: 'M32', sourceRef: 'Table 4.2.2',
    operator: '>=', limitLow: 1, unit: '% (w/w; v/v gases)', raw: 'Category 2 endocrine disruptor for the environment | | ≥ 1 % [Note 1 ]' }),
  rule({ ruleKey: 'T4.2.2-2-SDS', kind: 'SDS_TRIGGER', classCode: 'ED_ENV', marker: 'M32', sourceRef: 'Table 4.2.2 Note 1',
    operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'Note 1: If a Category 2 endocrine disruptor for the environment is present in the mixture as an ingredient at a concentration ≥ 0,1 % a SDS shall be available for the mixture upon request.' }),
  rule({ ruleKey: '4.3.3.1-PBT', kind: 'GCL', classCode: 'PBT_VPVB', marker: 'M32', sourceRef: '4.3.3.1',
    operator: '>=', limitLow: 0.1, unit: '% w/w',
    raw: 'A mixture shall be classified respectively as a PBT or vPvB when at least one component contained in the mixture has been classified respectively as a PBT or vPvB and is present at or above 0,1 % (weight/weight).' }),
  rule({ ruleKey: '4.3.3.1-VPVB', kind: 'GCL', classCode: 'PBT_VPVB', marker: 'M32', sourceRef: '4.3.3.1',
    operator: '>=', limitLow: 0.1, unit: '% w/w',
    raw: 'A mixture shall be classified respectively as a PBT or vPvB when at least one component contained in the mixture has been classified respectively as a PBT or vPvB and is present at or above 0,1 % (weight/weight).' }),
  rule({ ruleKey: '4.4.3.1-PMT', kind: 'GCL', classCode: 'PMT_VPVM', marker: 'M32', sourceRef: '4.4.3.1',
    operator: '>=', limitLow: 0.1, unit: '% w/w',
    raw: 'A mixture shall be classified as a PMT or vPvM where at least one of its components has been classified as a PMT or vPvM and is present at or above 0,1 % (weight/weight).' }),
  rule({ ruleKey: '4.4.3.1-VPVM', kind: 'GCL', classCode: 'PMT_VPVM', marker: 'M32', sourceRef: '4.4.3.1',
    operator: '>=', limitLow: 0.1, unit: '% w/w',
    raw: 'A mixture shall be classified as a PMT or vPvM where at least one of its components has been classified as a PMT or vPvM and is present at or above 0,1 % (weight/weight).' }),
  rule({ ruleKey: 'T5.1-OZONE', kind: 'GCL', classCode: 'OZONE', marker: 'M2', sourceRef: 'Table 5.1',
    operator: '>=', limitLow: 0.1, unit: '%', raw: 'Hazardous to the ozone layer (Category 1) | C ≥ 0,1 %' }),
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
  // ── классы модуля A4 (session 82), дословно из `hazard_category_mapping` ──
  MUTAGEN: [['1A', 'H340', 'GHS08', 'Danger'], ['1B', 'H340', 'GHS08', 'Danger'], ['2', 'H341', 'GHS08', 'Warning']],
  CARCINOGEN: [['1A', 'H350', 'GHS08', 'Danger'], ['1B', 'H350', 'GHS08', 'Danger'], ['2', 'H351', 'GHS08', 'Warning']],
  // ⚠ «Lactation» — H362 без пиктограммы и без сигнального слова: так в реестре,
  // и именно поэтому её нельзя «слить» с Repr. 1A/1B/2 в одну строку.
  REPRO_TOX: [['1A', 'H360', 'GHS08', 'Danger'], ['1B', 'H360', 'GHS08', 'Danger'], ['2', 'H361', 'GHS08', 'Warning'], ['Lactation', 'H362', null, null]],
  ED_HH: [['1', 'EUH380', null, 'Danger'], ['2', 'EUH381', null, 'Warning']],
  ED_ENV: [['1', 'EUH430', null, 'Danger'], ['2', 'EUH431', null, 'Warning']],
  PBT_VPVB: [['PBT', 'EUH440', null, 'Danger'], ['vPvB', 'EUH441', null, 'Danger']],
  PMT_VPVM: [['PMT', 'EUH450', null, 'Danger'], ['vPvM', 'EUH451', null, 'Danger']],
  OZONE: [['1', 'H420', 'GHS07', 'Warning']],
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

/* ── фикстура состава для A4 (session 82) ────────────────────────────────────
   Все три вещества и все их пределы — РЕАЛЬНЫЕ строки Annex VI, снятые из базы
   в s82. Выдуманный пример здесь был бы проверкой нашего представления о
   регламенте, а не регламента. */

/**
 * ⭐⭐⭐ 2-(2-methoxyethoxy)ethanol (DEGME), 603-107-00-6 — ГЛАВНЫЙ ПРИМЕР ЗАХОДА.
 * Annex VI даёт ему `Repr. 1B` и СВОЙ предел «C ≥ 3 %», тогда как общий предел
 * Table 3.7.2 для 1B — 0,3 %. Если бы компонент со своим SCL заодно судился по
 * общему порогу, смесь с 1 % этого растворителя уехала бы в Repr. 1B — то есть
 * была бы классифицирована ВДЕСЯТЕРО раньше, чем предписывает Annex VI.
 * Это тот же отказ, о котором предупреждает §5 `classifier-scaffold-s80.md`
 * на примере метанола, только здесь он бьёт в другую сторону — в лишнюю строгость.
 */
function degme(conc: number): ComponentInput {
  return {
    id: 'degme', source: 'annex6', indexNumber: '603-107-00-6', casPrimary: '111-77-3',
    name: '2-(2-methoxyethoxy)ethanol', conc,
    classifications: [{ classCode: 'REPRO_TOX', categoryCode: '1B', hCode: 'H360', raw: 'Repr. 1B' }],
    scl: [{
      raw: 'Repr. 1B; H360D: C ≥ 3 %', classCat: 'Repr. 1B', hCode: 'H360D',
      limitLow: 3, limitHigh: null, conditionText: 'C ≥ 3 %', needsReview: false,
    }],
  };
}

/**
 * ⭐⭐ Теллур, 052-001-00-0 — две категории ОДНОГО класса, которые сосуществуют:
 * `Repr. 1B` (H360) и `Lact.` (H362). Своих пределов у него нет, обе считаются
 * по Table 3.7.2 (0,3 %). Проверяет `Decision.additional[]`.
 */
function tellurium(conc: number): ComponentInput {
  return {
    id: 'tellurium', source: 'annex6', indexNumber: '052-001-00-0', casPrimary: '13494-80-9',
    name: 'tellurium', conc,
    classifications: [
      { classCode: 'REPRO_TOX', categoryCode: '1B', hCode: 'H360', raw: 'Repr. 1B' },
      { classCode: 'REPRO_TOX', categoryCode: 'Lactation', hCode: 'H362', raw: 'Lact.' },
    ],
  };
}

/**
 * ⭐⭐ Фенолфталеин, 604-076-00-1 — три класса сразу (`Carc. 1B`, `Muta. 2`,
 * `Repr. 2`) и СВОЙ предел только у одного из них: «Carc. 1B; H350: C ≥1 %»
 * против общего 0,1 %. Проверяет, что приоритет SCL действует ПОКЛАССНО:
 * канцерогенность судится по своему пределу, мутагенность — по общему.
 */
function phenolphthalein(conc: number): ComponentInput {
  return {
    id: 'phenolphthalein', source: 'annex6', indexNumber: '604-076-00-1', casPrimary: '77-09-8',
    name: 'phenolphthalein', conc,
    classifications: [
      { classCode: 'CARCINOGEN', categoryCode: '1B', hCode: 'H350', raw: 'Carc. 1B' },
      { classCode: 'MUTAGEN', categoryCode: '2', hCode: 'H341', raw: 'Muta. 2' },
      { classCode: 'REPRO_TOX', categoryCode: '2', hCode: 'H361', raw: 'Repr. 2' },
    ],
    scl: [{
      raw: 'Carc. 1B; H350: C ≥1 %', classCat: 'Carc. 1B', hCode: 'H350',
      limitLow: 1, limitHigh: null, conditionText: 'C ≥1 %', needsReview: false,
    }],
  };
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

check('реализованы A1 и A4', DEFAULT_MODULES.filter((m) => m.implemented).map((m) => m.key).join(',') === 'A1,A4',
  DEFAULT_MODULES.filter((m) => m.implemented).map((m) => m.key).join(','));

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

const CRITICAL = ['RULE_MISSING', 'REASON_MISSING', 'REGISTRY_GAP', 'MODULE_CONFLICT', 'MODULE_OVERLAP',
  'RULE_INCOMPLETE', 'ADDITIONAL_DUPLICATE', 'SCL_CATEGORY_UNPLACED'];
/** Критические предупреждения ответа, включая сопутствующие категории (s82). */
const criticalOf = (r: ClassifierResult): string[] => r.decisions
  .flatMap((d) => [
    ...d.warnings.filter((w) => CRITICAL.includes(w.code)).map((w) => `${d.classCode}:${w.code}`),
    ...(d.additional ?? []).flatMap((a) => a.warnings.filter((w) => CRITICAL.includes(w.code))
      .map((w) => `${d.classCode}/${a.categoryCode}:${w.code}`)),
  ])
  .concat(r.warnings.filter((w) => CRITICAL.includes(w.code)).map((w) => w.code));
const crit = criticalOf(r1);
check('ни одного критического предупреждения каркаса', crit.length === 0, crit.join(', '));

check('у not_computed назван модуль-владелец',
  r1.decisions.filter((d) => d.status === 'not_computed').every((d) => /[Mm]odule A[1-6]/.test(d.reason ?? '')));
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

/* ── 7. A4: классы по отсечке ───────────────────────────────────────────── */
console.log('\n7. A4 — классы по отсечке (session 82)');

// 7.1 ⭐⭐⭐ SCL не «уточняет» общий предел, а ЗАМЕНЯЕТ его.
const a1 = run(mixture([degme(1), water(99, true)]));
const repro1 = of(a1, 'REPRO_TOX')!;
check('DEGME 1 % → НЕ Repr. 1B: у вещества свой предел 3 %, общий 0,3 % к нему не применяется',
  repro1.status === 'not_classified' && repro1.categoryCode === null,
  `${repro1.status} ${repro1.categoryCode}`);
check('общий предел показан кандидатом с пометкой «checked and outranked»',
  (repro1.candidates ?? []).some((c) => c.ruleKey === 'T3.7.2-1B' && !c.passed && (c.note ?? '').includes('outranked')),
  JSON.stringify((repro1.candidates ?? []).map((c) => `${c.ruleKey}:${c.passed}`)));
check('SCL тоже показан кандидатом и не сработал',
  (repro1.candidates ?? []).some((c) => c.ruleKey === 'SCL:603-107-00-6:1' && !c.passed));
check('строка «не классифицировано» несёт правило и дословный текст',
  !!repro1.ruleKey && !!repro1.raw && !!repro1.reason, `${repro1.ruleKey} / ${repro1.raw}`);
check('вклад компонента помечен источником предела SCL',
  repro1.contributions.some((c) => c.componentId === 'degme' && c.limitSource === 'SCL' && c.limit === 3 && !c.counted));

// 7.2 Тот же компонент выше своего предела — классифицирован, и цитата — SCL.
const a2 = run(mixture([degme(5), water(95, true)]));
const repro2 = of(a2, 'REPRO_TOX')!;
check('DEGME 5 % → Repr. 1B по СВОЕМУ пределу',
  repro2.status === 'classified' && repro2.categoryCode === '1B' && repro2.ruleKey === 'SCL:603-107-00-6:1',
  `${repro2.status} ${repro2.categoryCode} ${repro2.ruleKey}`);
check('в строке стоит дословный текст SCL, а не общего предела',
  repro2.raw === 'Repr. 1B; H360D: C ≥ 3 %', String(repro2.raw));
check('H-код и пиктограмма пришли из реестра', repro2.hCode === 'H360' && repro2.pictogramCode === 'GHS08');

// 7.3 ⭐⭐⭐ Две категории одного класса, которые сосуществуют (решение Сергея s82).
const a3 = run(mixture([tellurium(0.5), water(99.5, true)]));
const repro3 = of(a3, 'REPRO_TOX')!;
check('теллур 0,5 % → Repr. 1B по Table 3.7.2',
  repro3.status === 'classified' && repro3.categoryCode === '1B' && repro3.ruleKey === 'T3.7.2-1B',
  `${repro3.status} ${repro3.categoryCode} ${repro3.ruleKey}`);
check('«Lact.» пришла отдельной сопутствующей категорией, а не потерялась',
  (repro3.additional ?? []).length === 1 && repro3.additional![0]!.categoryCode === 'Lactation',
  JSON.stringify((repro3.additional ?? []).map((x) => x.categoryCode)));
check('у сопутствующей категории своё правило и свой дословный текст',
  repro3.additional![0]!.ruleKey === 'T3.7.2-LACT' && !!repro3.additional![0]!.raw,
  `${repro3.additional![0]!.ruleKey} / ${repro3.additional![0]!.raw}`);
check('H362 доехал до этикетки наравне с H360',
  a3.labelPairs.some((p) => p.classCode === 'REPRO_TOX' && p.hCode === 'H360')
  && a3.labelPairs.some((p) => p.classCode === 'REPRO_TOX' && p.hCode === 'H362'),
  JSON.stringify(a3.labelPairs.filter((p) => p.classCode === 'REPRO_TOX')));
check('пар в этикетке столько же, сколько строк-категорий',
  a3.labelPairs.length === a3.decisions.filter((d) => d.status === 'classified').length
    + a3.decisions.reduce((n, d) => n + (d.additional?.length ?? 0), 0));

const a4 = run(mixture([tellurium(0.2), water(99.8, true)]));
const repro4 = of(a4, 'REPRO_TOX')!;
check('теллур 0,2 % → не классифицировано, и причина называет компонент',
  repro4.status === 'not_classified' && (repro4.reason ?? '').includes('tellurium'), repro4.reason ?? '');

// 7.4 Приоритет SCL действует ПОКЛАССНО, а не на весь компонент целиком.
const a5 = run(mixture([phenolphthalein(2), water(98, true)]));
check('фенолфталеин 2 % → Carc. 1B по своему пределу «C ≥1 %»',
  of(a5, 'CARCINOGEN')?.categoryCode === '1B' && of(a5, 'CARCINOGEN')?.ruleKey === 'SCL:604-076-00-1:1',
  `${of(a5, 'CARCINOGEN')?.categoryCode} ${of(a5, 'CARCINOGEN')?.ruleKey}`);
check('мутагенность того же компонента считается по ОБЩЕМУ пределу Table 3.5.2',
  of(a5, 'MUTAGEN')?.categoryCode === '2' && of(a5, 'MUTAGEN')?.ruleKey === 'T3.5.2-2',
  `${of(a5, 'MUTAGEN')?.categoryCode} ${of(a5, 'MUTAGEN')?.ruleKey}`);
check('репротоксичность 2 % < 3,0 % → не классифицировано',
  of(a5, 'REPRO_TOX')?.status === 'not_classified');
check('триггер SDS по Table 3.7.2 Note 1 уехал в supplemental, а не в классификацию',
  a5.supplemental.some((s) => s.kind === 'SDS_TRIGGER' && s.ruleKey === 'T3.7.2-SDS' && !!s.raw),
  JSON.stringify(a5.supplemental.map((s) => s.ruleKey)));

const a6 = run(mixture([phenolphthalein(0.5), water(99.5, true)]));
check('фенолфталеин 0,5 % → НЕ канцероген: общий 0,1 % заменён его пределом 1 %',
  of(a6, 'CARCINOGEN')?.status === 'not_classified',
  `${of(a6, 'CARCINOGEN')?.status} ${of(a6, 'CARCINOGEN')?.categoryCode}`);
check('и это видно в кандидатах: T3.6.2-1B проверен и уступил',
  (of(a6, 'CARCINOGEN')?.candidates ?? []).some((c) => c.ruleKey === 'T3.6.2-1B' && (c.note ?? '').includes('outranked')));

// 7.5 Пять отложенных классов A4 — честная строка с причиной, а не «неопасно».
const a7 = run(mixture([methanol(25), water(75, true)]));
const stotSe = of(a7, 'STOT_SE')!;
check('STOT SE — not_computed от модуля A4 с конкретной причиной',
  stotSe.status === 'not_computed' && stotSe.module === 'A4' && (stotSe.reason ?? '').includes('3.8.3.4.5'),
  `${stotSe.module} ${stotSe.status}`);
check('причина называет компонент, который несёт класс',
  (stotSe.reason ?? '').includes('methanol'), stotSe.reason ?? '');
check('все пять отложенных классов на месте и все от A4',
  ['SKIN_SENS', 'RESP_SENS', 'STOT_SE', 'STOT_RE', 'ASPIRATION']
    .every((cls) => of(a7, cls)?.status === 'not_computed' && of(a7, cls)?.module === 'A4'));

// 7.6 Контракт выдачи на составе, где работают оба модуля.
const a8 = run(mixture([phenolphthalein(2), degme(5), tellurium(0.5), water(92.5, true)]));
const a8NoRule = a8.decisions.filter((d) => (d.status === 'classified' || d.status === 'not_classified') && (!d.ruleKey || !d.raw));
check('у каждой строки A4 есть rule_key И дословный raw', a8NoRule.length === 0,
  a8NoRule.map((d) => `${d.classCode}:${d.ruleKey}`).join(', '));
const a8Unknown = a8.decisions
  .flatMap((d) => [d.ruleKey, ...(d.additional ?? []).map((x) => x.ruleKey)])
  .filter((k): k is string => !!k && !k.startsWith('SCL:') && !rules.has(k));
check('каждый rule_key из базы существует в таблице правил (SCL — свой формат)',
  a8Unknown.length === 0, a8Unknown.join(', '));
const a8Crit = criticalOf(a8);
check('ни одного критического предупреждения на смешанном составе', a8Crit.length === 0, a8Crit.join(', '));
check('строк по-прежнему ровно по числу классов реестра',
  a8.decisions.length === registry.classes().length, `${a8.decisions.length}`);

console.log(`\n${failed ? `✗ ПРОВАЛЕНО: ${failed} из ${total}` : `✓ каркас зелёный — ${total} проверок`}`);
process.exit(failed ? 1 : 0);
