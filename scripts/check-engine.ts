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

import { readFileSync } from 'node:fs';
import { classifyMixture, normalize, ENGINE_VERSION } from '../src/lib/classifier/engine.ts';
import { DEFAULT_MODULES } from '../src/lib/classifier/modules/index.ts';
import { RuleIndex, Registry } from '../src/lib/classifier/data.ts';
import { buildReport, resultFingerprint } from '../src/lib/classifier/report.ts';
import { reportPdfHtml } from '../src/lib/classifier/reportHtml.ts';
import { A0_PARSER_VERSION } from '../src/lib/classifier/version.ts';
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

  /* ── правила захода 2 (session 83) ─────────────────────────────────────────
     ⚠ Тридцать три строки, снятые из `clp_generic_limits` в s83: ключи, пороги,
     ВЕРХНИЕ границы полос, предельная вязкость и дословный текст. Числа здесь —
     ЦИТАТА, а не настройка теста: если база скажет другое, расходиться должна
     покраснеть эта фикстура, а не молча посчитаться прод. */

  // Table 3.4.5 — сенсибилизация кожи. Колонка «All physical states».
  rule({ ruleKey: 'T3.4.5-SKIN1A', kind: 'GCL', classCode: 'SKIN_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.5', physicalState: 'all', operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'Skin sensitiser Sub-category 1A | | | ≥ 0,1 %' }),
  rule({ ruleKey: 'T3.4.5-SKIN1B', kind: 'GCL', classCode: 'SKIN_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.5', physicalState: 'all', operator: '>=', limitLow: 1.0, unit: '%',
    raw: 'Skin sensitiser Sub-category 1B | | | ≥ 1,0 %' }),
  rule({ ruleKey: 'T3.4.5-SKIN1', kind: 'GCL', classCode: 'SKIN_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.5', physicalState: 'all', operator: '>=', limitLow: 1.0, unit: '%',
    raw: 'Skin sensitiser Category 1 | | | ≥ 1,0 %' }),
  // Table 3.4.6 — пределы ЭЛИСИТАЦИИ: не классификация, а EUH208 (Annex II 2.8).
  rule({ ruleKey: 'T3.4.6-SKIN1A', kind: 'ELICITATION', classCode: 'SKIN_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.6', physicalState: 'all', operator: '>=', limitLow: 0.01, unit: '%',
    raw: 'Skin sensitiser Sub-category 1A | | | ≥ 0,01 % (Note 1)' }),
  rule({ ruleKey: 'T3.4.6-SKIN1B', kind: 'ELICITATION', classCode: 'SKIN_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.6', physicalState: 'all', operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'Skin sensitiser Sub-category 1B | | | ≥ 0,1 % (Note 1)' }),
  rule({ ruleKey: 'T3.4.6-SKIN1', kind: 'ELICITATION', classCode: 'SKIN_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.6', physicalState: 'all', operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'Skin sensitiser Category 1 | | | ≥ 0,1 % (Note 1)' }),

  // ⚠⚠ Table 3.4.5 — сенсибилизация дыхательных путей: ДВЕ КОЛОНКИ, и предел
  // категории 1 отличается впятеро между твёрдой/жидкой смесью и газовой.
  rule({ ruleKey: 'T3.4.5-RESP1A-SL', kind: 'GCL', classCode: 'RESP_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.5', physicalState: 'solid/liquid', operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'Respiratory sensitiser Sub-category 1A | ≥ 0,1 % | ≥ 0,1 % |' }),
  rule({ ruleKey: 'T3.4.5-RESP1A-GAS', kind: 'GCL', classCode: 'RESP_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.5', physicalState: 'gas', operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'Respiratory sensitiser Sub-category 1A | ≥ 0,1 % | ≥ 0,1 % |' }),
  rule({ ruleKey: 'T3.4.5-RESP1B-SL', kind: 'GCL', classCode: 'RESP_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.5', physicalState: 'solid/liquid', operator: '>=', limitLow: 1.0, unit: '%',
    raw: 'Respiratory sensitiser Sub-category 1B | ≥ 1,0 % | ≥ 0,2 % |' }),
  rule({ ruleKey: 'T3.4.5-RESP1B-GAS', kind: 'GCL', classCode: 'RESP_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.5', physicalState: 'gas', operator: '>=', limitLow: 0.2, unit: '%',
    raw: 'Respiratory sensitiser Sub-category 1B | ≥ 1,0 % | ≥ 0,2 % |' }),
  rule({ ruleKey: 'T3.4.5-RESP1-SL', kind: 'GCL', classCode: 'RESP_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.5', physicalState: 'solid/liquid', operator: '>=', limitLow: 1.0, unit: '%',
    raw: 'Respiratory sensitiser Category 1 | ≥ 1,0 % | ≥ 0,2 % |' }),
  rule({ ruleKey: 'T3.4.5-RESP1-GAS', kind: 'GCL', classCode: 'RESP_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.5', physicalState: 'gas', operator: '>=', limitLow: 0.2, unit: '%',
    raw: 'Respiratory sensitiser Category 1 | ≥ 1,0 % | ≥ 0,2 % |' }),
  rule({ ruleKey: 'T3.4.6-RESP1A-SL', kind: 'ELICITATION', classCode: 'RESP_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.6', physicalState: 'solid/liquid', operator: '>=', limitLow: 0.01, unit: '%',
    raw: 'Respiratory sensitiser Sub-category 1A | ≥ 0,01 % (Note 1) | ≥ 0,01 % (Note 1) |' }),
  rule({ ruleKey: 'T3.4.6-RESP1A-GAS', kind: 'ELICITATION', classCode: 'RESP_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.6', physicalState: 'gas', operator: '>=', limitLow: 0.01, unit: '%',
    raw: 'Respiratory sensitiser Sub-category 1A | ≥ 0,01 % (Note 1) | ≥ 0,01 % (Note 1) |' }),
  rule({ ruleKey: 'T3.4.6-RESP1B-SL', kind: 'ELICITATION', classCode: 'RESP_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.6', physicalState: 'solid/liquid', operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'Respiratory sensitiser Sub-category 1B | ≥ 0,1 % (Note 1) | ≥ 0,1 % (Note 1) |' }),
  rule({ ruleKey: 'T3.4.6-RESP1B-GAS', kind: 'ELICITATION', classCode: 'RESP_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.6', physicalState: 'gas', operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'Respiratory sensitiser Sub-category 1B | ≥ 0,1 % (Note 1) | ≥ 0,1 % (Note 1) |' }),
  rule({ ruleKey: 'T3.4.6-RESP1-SL', kind: 'ELICITATION', classCode: 'RESP_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.6', physicalState: 'solid/liquid', operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'Respiratory sensitiser Category 1 | ≥ 0,1 % (Note 1) | ≥ 0,1 % (Note 1) |' }),
  rule({ ruleKey: 'T3.4.6-RESP1-GAS', kind: 'ELICITATION', classCode: 'RESP_SENS', ghsChapter: '3.4', marker: 'M2',
    sourceRef: 'Table 3.4.6', physicalState: 'gas', operator: '>=', limitLow: 0.1, unit: '%',
    raw: 'Respiratory sensitiser Category 1 | ≥ 0,1 % (Note 1) | ≥ 0,1 % (Note 1) |' }),

  // Table 3.8.3 — STOT SE, категории 1 и 2. ⚠ Средняя строка — ПОЛОСА.
  rule({ ruleKey: 'T3.8.3-1-GE10', kind: 'GCL', classCode: 'STOT_SE', ghsChapter: '3.8', sourceRef: 'Table 3.8.3',
    operator: '>=', limitLow: 10, unit: '%',
    raw: 'Category 1 Specific Target Organ Toxicant | Concentration ≥ 10 % | 1,0 % ≤ concentration < 10 %' }),
  rule({ ruleKey: 'T3.8.3-1-1-10', kind: 'GCL', classCode: 'STOT_SE', ghsChapter: '3.8', sourceRef: 'Table 3.8.3',
    operator: '>=..<', limitLow: 1.0, limitHigh: 10, unit: '%',
    raw: 'Category 1 Specific Target Organ Toxicant | Concentration ≥ 10 % | 1,0 % ≤ concentration < 10 %' }),
  rule({ ruleKey: 'T3.8.3-2-GE10', kind: 'GCL', classCode: 'STOT_SE', ghsChapter: '3.8', sourceRef: 'Table 3.8.3',
    operator: '>=', limitLow: 10, unit: '%',
    raw: 'Category 2 Specific Target Organ Toxicant | | Concentration ≥ 10 % [(Note 1)]' }),
  rule({ ruleKey: 'T3.8.3-2-SDS', kind: 'SDS_TRIGGER', classCode: 'STOT_SE', ghsChapter: '3.8', sourceRef: 'Table 3.8.3 Note 1',
    operator: '>=', limitLow: 1.0, unit: '%',
    raw: 'If a Category 2 specific target organ toxicant is present in the mixture as an ingredient at a concentration ≥ 1,0 % a SDS shall be available for the mixture upon request.' }),
  // ⚠⚠ Категория 3 — СУММА, и источник сам называет её порог «appropriate».
  rule({ ruleKey: '3.8.3.4.5-CAT3-GCL20', kind: 'GCL', classCode: 'STOT_SE', ghsChapter: '3.8', sourceRef: '3.8.3.4.5',
    operator: '>=', limitLow: 20, unit: '%',
    raw: 'Care shall be exercised when extrapolating toxicity of a mixture that contains Category 3 ingredient(s). A generic concentration limit of 20 % is appropriate; however, it shall be recognised that this concentration limit may be higher or lower depending on the Category 3 ingredient(s) and that some effects such as respiratory tract irritation may not occur below a certain concentration while other effects such as narcotic effects may occur below this 20 % value. Expert judgement shall be exercised. Respiratory tract irritation and narcotic effects are to be evaluated separately in accordance with the criteria given in section 3.8.2.2. When conducting classifications for these hazards, the contribution of each component should be considered additive, unless there is evidence that the effects are not additive.' }),
  rule({ ruleKey: '3.8.3.4.6-CAT3-RELEVANT', kind: 'RELEVANT', classCode: 'STOT_SE', ghsChapter: '3.8', marker: 'M19', sourceRef: '3.8.3.4.6',
    operator: '>=', limitLow: 1, unit: '% (w/w solids, liquids, dusts, mists, vapours; v/v gases)',
    raw: 'In cases where the additivity approach is used for Category 3 ingredients, the ‘relevant ingredients’ of a mixture are those which are present in concentrations ≥ 1 % (w/w for solids, liquids, dusts, mists, and vapours and v/v for gases), unless there is a reason to suspect that an ingredient present at a concentration < 1 % is still relevant when classifying the mixture for respiratory tract irritation or narcotic effects.' }),
  rule({ ruleKey: 'T1.1-STOT_SE-CAT3', kind: 'CUTOFF', classCode: 'STOT_SE', ghsChapter: '1.1', marker: 'M19', sourceRef: 'Table 1.1',
    operator: '>=', limitLow: 1, unit: '%', raw: 'Specific target organ toxicity, single exposure, Category 3 | 1 % (3)' }),

  // Table 3.9.4 — STOT RE: та же арифметика полос, без категории 3.
  rule({ ruleKey: 'T3.9.4-1-GE10', kind: 'GCL', classCode: 'STOT_RE', ghsChapter: '3.9', sourceRef: 'Table 3.9.4',
    operator: '>=', limitLow: 10, unit: '%',
    raw: 'Category 1 Specific Target Organ Toxicant | Concentration ≥ 10 % | 1,0 % ≤ concentration < 10 %' }),
  rule({ ruleKey: 'T3.9.4-1-1-10', kind: 'GCL', classCode: 'STOT_RE', ghsChapter: '3.9', sourceRef: 'Table 3.9.4',
    operator: '>=..<', limitLow: 1.0, limitHigh: 10, unit: '%',
    raw: 'Category 1 Specific Target Organ Toxicant | Concentration ≥ 10 % | 1,0 % ≤ concentration < 10 %' }),
  rule({ ruleKey: 'T3.9.4-2-GE10', kind: 'GCL', classCode: 'STOT_RE', ghsChapter: '3.9', sourceRef: 'Table 3.9.4',
    operator: '>=', limitLow: 10, unit: '%',
    raw: 'Category 2 Specific Target Organ Toxicant | | Concentration ≥ 10 % [(Note 1)]' }),
  rule({ ruleKey: 'T3.9.4-2-SDS', kind: 'SDS_TRIGGER', classCode: 'STOT_RE', ghsChapter: '3.9', sourceRef: 'Table 3.9.4 Note 1',
    operator: '>=', limitLow: 1.0, unit: '%',
    raw: 'If a Category 2 specific target organ toxicant is present in the mixture as an ingredient at a concentration ≥ 1,0 % a SDS shall be available for the mixture upon request.' }),

  // ⚠⚠ Аспирация — ДВА условия: сумма категории 1 И вязкость. Предельная
  // вязкость лежит в колонке `value` той же строки, а не в коде модуля.
  rule({ ruleKey: '3.10.3.3.1.2-CAT1', kind: 'GCL', classCode: 'ASPIRATION', ghsChapter: '3.10', marker: 'M19',
    sourceRef: '3.10.3.3.1.2', operator: '>=', limitLow: 10, unit: '%',
    value: 20.5, valueUnit: 'mm2/s at 40 °C (kinematic viscosity, ≤)', formulaRaw: 'Sum of Category 1 ingredients',
    raw: 'A mixture is classified as Category 1 when the sum of the concentrations of Category 1 ingredients is ≥ 10 % and the mixture has a kinematic viscosity ≤ 20,5 mm2/s, measured at 40 °C.' }),
  rule({ ruleKey: '3.10.3.3.1.3-LAYERS', kind: 'GCL', classCode: 'ASPIRATION', ghsChapter: '3.10', marker: 'M19',
    sourceRef: '3.10.3.3.1.3', operator: '>=', limitLow: 10, unit: '%',
    value: 20.5, valueUnit: 'mm2/s at 40 °C (kinematic viscosity, ≤)',
    formulaRaw: 'Sum of Category 1 ingredients in any distinct layer',
    raw: 'In the case of a mixture which separates into two or more distinct layers, the entire mixture is classified as Category 1 if in any distinct layer the sum of the concentrations of Category 1 ingredients is ≥ 10 %, and it has a kinematic viscosity ≤ 20,5 mm2/s, measured at 40 °C.' }),
  rule({ ruleKey: '3.10.3.3.1.1-RELEVANT', kind: 'RELEVANT', classCode: 'ASPIRATION', ghsChapter: '3.10', marker: 'M19',
    sourceRef: '3.10.3.3.1.1', operator: '>=', limitLow: 1, unit: '%',
    raw: 'The ‘relevant ingredients’ of a mixture are those which are present in concentrations ≥ 1 %.' }),
  rule({ ruleKey: 'T1.1-ASPIRATION', kind: 'CUTOFF', classCode: 'ASPIRATION', ghsChapter: '1.1', marker: 'M19',
    sourceRef: 'Table 1.1', operator: '>=', limitLow: 1, unit: '%', raw: 'Aspiration toxicity | 1 %' }),
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
  // ── классы захода 2 (session 83), дословно из `hazard_category_mapping` ──
  // ⚠ У обеих сенсибилизаций подкатегории 1A и 1B несут ТОТ ЖЕ H-код, что и «1»:
  // разница между ними — точность, а не строгость, и старшинства между ними
  // движок не выдумывает (правило каркаса §2.1).
  RESP_SENS: [['1', 'H334', 'GHS08', 'Danger'], ['1A', 'H334', 'GHS08', 'Danger'], ['1B', 'H334', 'GHS08', 'Danger']],
  SKIN_SENS: [['1', 'H317', 'GHS07', 'Warning'], ['1A', 'H317', 'GHS07', 'Warning'], ['1B', 'H317', 'GHS07', 'Warning']],
  STOT_RE: [['1', 'H372', 'GHS08', 'Danger'], ['2', 'H373', 'GHS08', 'Warning']],
  // ⚠ Категория 2 аспирации (H305) есть в реестре, но EU CLP её не присваивает:
  // Annex I 3.10.3.3 даёт смеси только категорию 1. Модуль её и не считает.
  ASPIRATION: [['1', 'H304', 'GHS08', 'Danger'], ['2', 'H305', null, 'Warning']],
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
    engineVersion: ENGINE_VERSION, parserVersion: A0_PARSER_VERSION, gclMd5: null, limitsMd5: null,
    classificationMd5: null, releasedAt: '2026-08-22T00:00:00Z', note: 'check-engine fixture',
    // ⚠ Числа релиза (№116) — настоящие, снятые из `data_release` в s84: отчёт
    // печатает их как объём данных, на которых считали.
    annex6Rows: 4419, classificationPairs: 13512, registryCategories: 121,
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
    // ⭐⭐⭐ НАСТОЯЩИЕ пределы метанола из Annex VI (сняты из базы в s83) —
    // эталонный регрессионный набор §16.4 CLAUDE.md: 25 % → STOT SE 1,
    // 5 % → STOT SE 2 (ПОЛОСА 3–10 %), 2 % → не классифицировано, потому что
    // общий порог Table 3.8.3 (1,0 %) к нему НЕ ПРИМЕНЯЕТСЯ.
    scl: [
      {
        raw: 'STOT SE 1; H370: C≥10 %', classCat: 'STOT SE 1', hCode: 'H370',
        limitLow: 10, limitHigh: null, conditionText: 'C≥10 %', needsReview: false,
      },
      {
        raw: 'STOT SE 2; H371: 3 % ≤ C<10 %', classCat: 'STOT SE 2', hCode: 'H371',
        limitLow: 3, limitHigh: 10, conditionText: '3 % ≤ C<10 %', needsReview: false,
      },
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

/* ── фикстура состава для A4 захода 2 (session 83) ───────────────────────────
   Четыре вещества, и все четыре — реальные строки Annex VI, снятые из базы в
   s83 вместе с их пределами. Выдуманный пример проверял бы наше представление
   о регламенте, а не регламент. */

/**
 * ⭐⭐⭐ Толуол, 601-021-00-3 — три класса захода 2 в одном веществе и НИ ОДНОГО
 * собственного предела: `Asp. Tox. 1` (сумма + вязкость), `STOT RE 2` со
 * звёздочкой (отсечка Table 3.9.4) и `STOT SE 3` В НАРКОТИЧЕСКОЙ ветке — H336,
 * не H335. Именно на нём видно, что две суммы категории 3 считаются порознь.
 */
function toluene(conc: number): ComponentInput {
  return {
    id: 'toluene', source: 'annex6', indexNumber: '601-021-00-3', casPrimary: '108-88-3',
    name: 'toluene', conc,
    classifications: [
      { classCode: 'FLAM_LIQ', categoryCode: '2', hCode: 'H225', raw: 'Flam. Liq. 2' },
      { classCode: 'REPRO_TOX', categoryCode: '2', hCode: 'H361', raw: 'Repr. 2' },
      { classCode: 'ASPIRATION', categoryCode: '1', hCode: 'H304', raw: 'Asp. Tox. 1' },
      { classCode: 'STOT_RE', categoryCode: '2', hCode: 'H373', star: true, raw: 'STOT RE 2' },
      { classCode: 'SKIN_CORR_IRRIT', categoryCode: '2', hCode: 'H315', raw: 'Skin Irrit. 2' },
      { classCode: 'STOT_SE', categoryCode: '3 narcotic', hCode: 'H336', raw: 'STOT SE 3' },
    ],
  };
}

/**
 * ⭐⭐ n-гексан, 601-037-00-0 — `STOT RE 1` без собственного предела: на нём
 * проверяется ПОЛОСА Table 3.9.4 (компонент категории 1 между 1,0 % и 10 %
 * делает смесь категорией 2, а не 1). Плюс вторая половина суммы аспирации и
 * второй наркотический компонент.
 */
function hexane(conc: number): ComponentInput {
  return {
    id: 'hexane', source: 'annex6', indexNumber: '601-037-00-0', casPrimary: '110-54-3',
    name: 'n-hexane', conc,
    classifications: [
      { classCode: 'FLAM_LIQ', categoryCode: '2', hCode: 'H225', raw: 'Flam. Liq. 2' },
      { classCode: 'REPRO_TOX', categoryCode: '2', hCode: 'H361', raw: 'Repr. 2' },
      { classCode: 'ASPIRATION', categoryCode: '1', hCode: 'H304', raw: 'Asp. Tox. 1' },
      { classCode: 'STOT_SE', categoryCode: '3 narcotic', hCode: 'H336', raw: 'STOT SE 3' },
      { classCode: 'STOT_RE', categoryCode: '1', hCode: 'H372', raw: 'STOT RE 1' },
      { classCode: 'SKIN_CORR_IRRIT', categoryCode: '2', hCode: 'H315', raw: 'Skin Irrit. 2' },
      { classCode: 'AQUATIC_CHRONIC', categoryCode: '2', hCode: 'H411', raw: 'Aquatic Chronic 2' },
    ],
  };
}

/**
 * ⭐⭐⭐ MDI, 615-005-00-9 — обе сенсибилизации разом, и собственный предел
 * только у одной. `Resp. Sens. 1; H334: C ≥ 0,1 %` СТРОЖЕ общего (1,0 % для
 * жидкой смеси) — зеркало случая DEGME, где свой предел был мягче общего.
 * `Skin Sens. 1` своего предела не имеет и судится по Table 3.4.5, а между
 * пределом элиситации и пределом классификации даёт EUH208. Третий предел —
 * `STOT SE 3; H335: C ≥ 5 %` — проверяет, что компонент со своим пределом НЕ
 * входит в сумму 3.8.3.4.5.
 */
function mdi(conc: number): ComponentInput {
  return {
    id: 'mdi', source: 'annex6', indexNumber: '615-005-00-9', casPrimary: '101-68-8',
    name: 'diphenylmethane-4,4-diisocyanate', conc,
    classifications: [
      { classCode: 'CARCINOGEN', categoryCode: '2', hCode: 'H351', raw: 'Carc. 2' },
      { classCode: 'ACUTE_TOX_INHAL', categoryCode: '4', hCode: 'H332', star: true, raw: 'Acute Tox. 4' },
      { classCode: 'STOT_RE', categoryCode: '2', hCode: 'H373', star: true, raw: 'STOT RE 2' },
      { classCode: 'EYE_DAMAGE_IRRIT', categoryCode: '2A', hCode: 'H319', raw: 'Eye Irrit. 2' },
      { classCode: 'STOT_SE', categoryCode: '3', hCode: 'H335', raw: 'STOT SE 3' },
      { classCode: 'SKIN_CORR_IRRIT', categoryCode: '2', hCode: 'H315', raw: 'Skin Irrit. 2' },
      { classCode: 'RESP_SENS', categoryCode: '1', hCode: 'H334', raw: 'Resp. Sens. 1' },
      { classCode: 'SKIN_SENS', categoryCode: '1', hCode: 'H317', raw: 'Skin Sens. 1' },
    ],
    // ⚠ Порядок строк — как в Annex VI: `SCL:615-005-00-9:3` — респираторная
    // сенсибилизация, `:4` — STOT SE 3. Номер в ключе провенанса и есть seq.
    scl: [
      { raw: 'Eye Irrit. 2; H319: C ≥ 5 %', classCat: 'Eye Irrit. 2', hCode: 'H319', limitLow: 5, limitHigh: null, conditionText: 'C ≥ 5 %', needsReview: false },
      { raw: 'Skin Irrit. 2; H315: C ≥ 5 %', classCat: 'Skin Irrit. 2', hCode: 'H315', limitLow: 5, limitHigh: null, conditionText: 'C ≥ 5 %', needsReview: false },
      { raw: 'Resp. Sens. 1; H334: C ≥ 0,1 %', classCat: 'Resp. Sens. 1', hCode: 'H334', limitLow: 0.1, limitHigh: null, conditionText: 'C ≥ 0,1 %', needsReview: false },
      { raw: 'STOT SE 3; H335: C ≥ 5 %', classCat: 'STOT SE 3', hCode: 'H335', limitLow: 5, limitHigh: null, conditionText: 'C ≥ 5 %', needsReview: false },
    ],
  };
}

/**
 * ⭐⭐ Фталевый ангидрид, 607-009-00-4 — `Resp. Sens. 1` и `Skin Sens. 1` БЕЗ
 * собственных пределов (проверяет обе колонки Table 3.4.5 и элиситацию Table
 * 3.4.6), плюс `STOT SE 3` в ветке H335 — раздражение дыхательных путей.
 */
function phthalicAnhydride(conc: number): ComponentInput {
  return {
    id: 'phthalic', source: 'annex6', indexNumber: '607-009-00-4', casPrimary: '85-44-9',
    name: 'phthalic anhydride', conc,
    classifications: [
      { classCode: 'ACUTE_TOX_ORAL', categoryCode: '4', hCode: 'H302', star: true, raw: 'Acute Tox. 4' },
      { classCode: 'STOT_SE', categoryCode: '3', hCode: 'H335', raw: 'STOT SE 3' },
      { classCode: 'SKIN_CORR_IRRIT', categoryCode: '2', hCode: 'H315', raw: 'Skin Irrit. 2' },
      { classCode: 'EYE_DAMAGE_IRRIT', categoryCode: '1', hCode: 'H318', raw: 'Eye Dam. 1' },
      { classCode: 'RESP_SENS', categoryCode: '1', hCode: 'H334', raw: 'Resp. Sens. 1' },
      { classCode: 'SKIN_SENS', categoryCode: '1', hCode: 'H317', raw: 'Skin Sens. 1' },
    ],
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

// ⚠ `SCL:<index>:<seq>` живёт не в таблице правил, а в строке Annex VI самого
// вещества, и дословный текст приходит с компонента — у него свой формат ключа.
const unknownKey = r1.decisions.filter((d) => d.ruleKey && !d.ruleKey.startsWith('SCL:') && !rules.has(d.ruleKey));
check('каждый rule_key результата существует в таблице правил (SCL — свой формат)', unknownKey.length === 0,
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

// 7.5 ⭐ Отложенных классов у A4 не осталось (заход 2, s83): все пять теперь
// СЧИТАЮТСЯ, а не печатают «not computed». Проверка сторожит именно это — чтобы
// откат модуля к заглушкам не проехал зелёным.
const a7 = run(mixture([methanol(25), water(75, true)]));
check('ни один класс A4 больше не выдаёт not_computed',
  ['SKIN_SENS', 'RESP_SENS', 'STOT_SE', 'STOT_RE', 'ASPIRATION',
    'CARCINOGEN', 'MUTAGEN', 'REPRO_TOX', 'ED_HH', 'ED_ENV', 'PBT_VPVB', 'PMT_VPVM', 'OZONE']
    .every((cls) => of(a7, cls)?.module === 'A4' && of(a7, cls)?.status !== 'not_computed'),
  ['SKIN_SENS', 'RESP_SENS', 'STOT_SE', 'STOT_RE', 'ASPIRATION']
    .map((cls) => `${cls}:${of(a7, cls)?.status}`).join(', '));
check('not_computed остались только у объявленных заглушек A2/A3/A6',
  a7.decisions.filter((d) => d.status === 'not_computed').every((d) => ['A2', 'A3', 'A6'].includes(d.module)),
  a7.decisions.filter((d) => d.status === 'not_computed').map((d) => `${d.classCode}:${d.module}`).join(', '));

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

/* ── 8. A4 заход 2: полосы, суммы, колонки и элиситация ─────────────────── */
console.log('\n8. A4 заход 2 — сенсибилизация, STOT, аспирация (session 83)');

// 8.1 ⭐⭐⭐ Эталонный регрессионный набор §16.4 CLAUDE.md — настоящий метанол.
const m25 = of(run(mixture([methanol(25), water(75, true)])), 'STOT_SE')!;
check('метанол 25 % → STOT SE 1 по своему пределу «C≥10 %»',
  m25.status === 'classified' && m25.categoryCode === '1' && m25.ruleKey === 'SCL:603-001-00-X:1' && m25.hCode === 'H370',
  `${m25.status} ${m25.categoryCode} ${m25.ruleKey}`);
const m5 = of(run(mixture([methanol(5), water(95, true)])), 'STOT_SE')!;
check('метанол 5 % → STOT SE 2: ПОЛОСА «3 % ≤ C<10 %» своего предела',
  m5.status === 'classified' && m5.categoryCode === '2' && m5.ruleKey === 'SCL:603-001-00-X:2' && m5.hCode === 'H371',
  `${m5.status} ${m5.categoryCode} ${m5.ruleKey}`);
const m2 = of(run(mixture([methanol(2), water(98, true)])), 'STOT_SE')!;
check('метанол 2 % → НЕ классифицировано: общий порог Table 3.8.3 к нему не применяется',
  m2.status === 'not_classified' && !!m2.ruleKey && !!m2.raw,
  `${m2.status} ${m2.categoryCode} ${m2.ruleKey}`);
check('обе ступени Table 3.8.3 показаны как проверенные и уступившие',
  ['T3.8.3-1-GE10', 'T3.8.3-1-1-10']
    .every((k) => (m2.candidates ?? []).some((c) => c.ruleKey === k && (c.note ?? '').includes('outranked'))),
  JSON.stringify((m2.candidates ?? []).map((c) => `${c.ruleKey}:${c.passed}`)));

// 8.2 ⭐⭐ ПОЛОСА общего предела: Table 3.9.4, компонент категории 1.
const h15 = of(run(mixture([hexane(15), water(85, true)])), 'STOT_RE')!;
check('n-гексан 15 % (STOT RE 1) → смесь STOT RE 1',
  h15.categoryCode === '1' && h15.ruleKey === 'T3.9.4-1-GE10' && h15.hCode === 'H372',
  `${h15.categoryCode} ${h15.ruleKey}`);
const h5 = of(run(mixture([hexane(5), water(95, true)])), 'STOT_RE')!;
check('n-гексан 5 % → смесь STOT RE 2, а НЕ 1: полоса 1,0–10 %',
  h5.categoryCode === '2' && h5.ruleKey === 'T3.9.4-1-1-10' && h5.hCode === 'H373',
  `${h5.categoryCode} ${h5.ruleKey}`);
const h05 = of(run(mixture([hexane(0.5), water(99.5, true)])), 'STOT_RE')!;
check('n-гексан 0,5 % → ниже нижней границы полосы, не классифицировано',
  h05.status === 'not_classified', `${h05.status} ${h05.categoryCode}`);
const t12 = run(mixture([toluene(12), water(88, true)], { viscosityMm2s40c: 1.2 }));
check('толуол 12 % (STOT RE 2) → смесь STOT RE 2 по отсечке ≥ 10 %',
  of(t12, 'STOT_RE')?.ruleKey === 'T3.9.4-2-GE10' && of(t12, 'STOT_RE')?.categoryCode === '2',
  `${of(t12, 'STOT_RE')?.categoryCode} ${of(t12, 'STOT_RE')?.ruleKey}`);
check('триггер SDS Table 3.9.4 Note 1 уехал в supplemental',
  t12.supplemental.some((s) => s.kind === 'SDS_TRIGGER' && s.ruleKey === 'T3.9.4-2-SDS' && !!s.raw),
  JSON.stringify(t12.supplemental.map((s) => s.ruleKey)));

// 8.3 ⭐⭐⭐ ДВЕ СУММЫ КАТЕГОРИИ 3 СЧИТАЮТСЯ ПОРОЗНЬ (3.8.3.4.5).
const sep = of(run(mixture([phthalicAnhydride(15), hexane(15), water(70, true)])), 'STOT_SE')!;
check('H335 15 % и H336 15 % → НЕ классифицировано: суммы не складываются друг с другом',
  sep.status === 'not_classified', `${sep.status} ${sep.categoryCode}`);
check('причина называет обе суммы порознь',
  (sep.reason ?? '').includes('category 3 add up to 15.0 %') && (sep.reason ?? '').includes('category 3 narcotic add up to 15.0 %'),
  sep.reason ?? '');
const irr = of(run(mixture([phthalicAnhydride(25), water(75, true)])), 'STOT_SE')!;
check('фталевый ангидрид 25 % → STOT SE 3 (H335) по сумме 3.8.3.4.5',
  irr.categoryCode === '3' && irr.hCode === 'H335' && irr.ruleKey === '3.8.3.4.5-CAT3-GCL20',
  `${irr.categoryCode} ${irr.hCode} ${irr.ruleKey}`);
check('в агрегате видна сама сумма, а не только вердикт',
  (irr.aggregate?.expr ?? '').includes('25.0 %') && irr.aggregate?.threshold === 20,
  irr.aggregate?.expr ?? '');
check('⚠ сказано, что 20 % — не абсолютный порог (3.8.3.4.5 требует expert judgement)',
  irr.warnings.some((w) => w.code === 'LIMIT_NOT_ABSOLUTE'),
  JSON.stringify(irr.warnings.map((w) => w.code)));
const nar = of(run(mixture([phthalicAnhydride(12), hexane(12), toluene(12), water(64, true)])), 'STOT_SE')!;
check('12 % + 12 % наркотических → STOT SE 3 narcotic (H336), а раздражение — нет',
  nar.categoryCode === '3 narcotic' && nar.hCode === 'H336' && (nar.additional ?? []).length === 0,
  `${nar.categoryCode} ${nar.hCode} +${(nar.additional ?? []).length}`);
const both = run(mixture([phthalicAnhydride(25), hexane(25), water(50, true)], { viscosityMm2s40c: 1.2 }));
const bothSe = of(both, 'STOT_SE')!;
check('обе ветки категории 3 сработали → основная строка и сопутствующая',
  bothSe.categoryCode === '3' && (bothSe.additional ?? []).length === 1 && bothSe.additional![0]!.categoryCode === '3 narcotic',
  `${bothSe.categoryCode} + ${JSON.stringify((bothSe.additional ?? []).map((a) => a.categoryCode))}`);
check('H335 и H336 доехали до этикетки оба',
  both.labelPairs.some((p) => p.hCode === 'H335') && both.labelPairs.some((p) => p.hCode === 'H336'),
  JSON.stringify(both.labelPairs.filter((p) => p.classCode === 'STOT_SE')));
check('у сопутствующей категории свой агрегат с её собственной суммой',
  (bothSe.additional![0]!.aggregate?.expr ?? '').includes('25.0 %'),
  bothSe.additional![0]!.aggregate?.expr ?? '');

// 8.4 ⭐⭐⭐ Компонент со СВОИМ пределом в общую сумму НЕ входит.
const outSum = of(run(mixture([mdi(4), phthalicAnhydride(18), water(78, true)])), 'STOT_SE')!;
check('MDI 4 % (свой предел «C ≥ 5 %») не добавился к 18 % → 22 %: не классифицировано',
  outSum.status === 'not_classified', `${outSum.status} ${outSum.categoryCode}`);
check('и это сказано в кандидатах: предел заменён, компонент вне суммы',
  (outSum.candidates ?? []).some((c) => c.ruleKey === '3.8.3.4.5-CAT3-GCL20' && (c.note ?? '').includes('not part of this sum')),
  JSON.stringify((outSum.candidates ?? []).map((c) => c.note)));
const inScl = of(run(mixture([mdi(6), water(94, true)])), 'STOT_SE')!;
check('MDI 6 % → STOT SE 3 по СВОЕМУ пределу, цитата — строка Annex VI',
  inScl.categoryCode === '3' && inScl.ruleKey === 'SCL:615-005-00-9:4' && inScl.raw === 'STOT SE 3; H335: C ≥ 5 %',
  `${inScl.categoryCode} ${inScl.ruleKey} ${inScl.raw}`);

// 8.5 ⭐⭐⭐ ДВЕ КОЛОНКИ Table 3.4.5: один и тот же состав, разное состояние.
const pLiq = of(run(mixture([phthalicAnhydride(0.5), water(99.5, true)], { physicalState: 'liquid' })), 'RESP_SENS')!;
check('фталевый ангидрид 0,5 % в ЖИДКОЙ смеси → не классифицировано (колонка solid/liquid, 1,0 %)',
  pLiq.status === 'not_classified' && pLiq.ruleKey === 'T3.4.5-RESP1-SL',
  `${pLiq.status} ${pLiq.ruleKey}`);
const pGas = of(run(mixture([phthalicAnhydride(0.5), water(99.5, true)], { physicalState: 'gas', inhalForm: 'gas' })), 'RESP_SENS')!;
check('тот же 0,5 % в ГАЗОВОЙ смеси → Resp. Sens. 1 (колонка gas, 0,2 %)',
  pGas.status === 'classified' && pGas.categoryCode === '1' && pGas.ruleKey === 'T3.4.5-RESP1-GAS' && pGas.hCode === 'H334',
  `${pGas.status} ${pGas.categoryCode} ${pGas.ruleKey}`);

// 8.6 ⭐⭐⭐ Элиситация Table 3.4.6 → EUH208, и одна десятая своего предела.
const el = run(mixture([phthalicAnhydride(0.5), water(99.5, true)]));
check('кожная сенсибилизация 0,5 % < 1,0 % → не классифицировано',
  of(el, 'SKIN_SENS')?.status === 'not_classified');
const euh = el.supplemental.filter((s) => s.code === 'EUH208');
check('но EUH208 выставлен: 0,5 % выше предела элиситации 0,1 %',
  euh.length === 1 && euh[0]!.text.includes('phthalic anhydride') && euh[0]!.ruleKey === 'T3.4.6-SKIN1' && !!euh[0]!.raw,
  JSON.stringify(el.supplemental.map((s) => `${s.code}:${s.ruleKey}`)));
check('⚠ вещество-сенсибилизатор кожи И дыхательных путей даёт ОДНУ фразу, а не две',
  euh.length === 1 && euh[0]!.text.includes('T3.4.6-RESP1-SL'),
  euh[0]?.text ?? '');
check('респираторная сенсибилизация того же компонента тоже не классифицирована',
  of(el, 'RESP_SENS')?.status === 'not_classified', `${of(el, 'RESP_SENS')?.status}`);
const el2 = run(mixture([phthalicAnhydride(2), water(98, true)]));
check('при 2 % смесь классифицирована как сенсибилизатор — и EUH208 больше не нужен',
  of(el2, 'SKIN_SENS')?.categoryCode === '1' && !el2.supplemental.some((s) => s.code === 'EUH208'),
  `${of(el2, 'SKIN_SENS')?.categoryCode} / ${el2.supplemental.filter((s) => s.code === 'EUH208').length}`);
const mSens = of(run(mixture([mdi(0.5), water(99.5, true)])), 'RESP_SENS')!;
check('⭐ MDI 0,5 % → Resp. Sens. 1 по СВОЕМУ пределу 0,1 % — общий (1,0 %) не сработал бы',
  mSens.status === 'classified' && mSens.ruleKey === 'SCL:615-005-00-9:3',
  `${mSens.status} ${mSens.ruleKey}`);
const tenth = run(mixture([mdi(0.05), water(99.95, true)]));
check('MDI 0,05 % → не классифицировано, но EUH208 по 1/10 своего предела (Note 1)',
  of(tenth, 'RESP_SENS')?.status === 'not_classified'
  && tenth.supplemental.some((s) => s.code === 'EUH208' && s.text.includes('tenth')),
  JSON.stringify(tenth.supplemental.map((s) => `${s.code}:${s.ruleKey}`)));

// 8.7 ⭐⭐⭐ Аспирация: сумма И вязкость, а без вязкости — «данных не хватает».
const aspOk = of(run(mixture([toluene(6), hexane(6), water(88, true)], { viscosityMm2s40c: 1.2 })), 'ASPIRATION')!;
check('6 % + 6 % = 12 % при вязкости 1,2 → Asp. Tox. 1',
  aspOk.status === 'classified' && aspOk.categoryCode === '1' && aspOk.hCode === 'H304'
  && aspOk.ruleKey === '3.10.3.3.1.2-CAT1',
  `${aspOk.status} ${aspOk.categoryCode} ${aspOk.ruleKey}`);
check('в агрегате видны и сумма, и вязкость',
  (aspOk.aggregate?.expr ?? '').includes('12.0 %') && (aspOk.aggregate?.expr ?? '').includes('20.5'),
  aspOk.aggregate?.expr ?? '');
const aspNo = of(run(mixture([toluene(6), hexane(6), water(88, true)])), 'ASPIRATION')!;
check('⭐ та же смесь без вязкости → insufficient_data, а НЕ «не классифицировано»',
  aspNo.status === 'insufficient_data' && !!aspNo.raw && aspNo.ruleKey === '3.10.3.3.1.2-CAT1',
  `${aspNo.status} ${aspNo.ruleKey}`);
check('причина называет ровно то число, которого не хватает',
  (aspNo.reason ?? '').includes('kinematic viscosity') && (aspNo.reason ?? '').includes('20.5'),
  aspNo.reason ?? '');
// ⚠⚠ НЕГАТИВНЫЕ МАРКЕРЫ, заведённые по живой пробе s83. Первая версия текста
// подставляла `value_unit` целиком — а это ОПИСАНИЕ КОЛОНКИ, а не единица, — и
// на проде вышло «its kinematic viscosity not entered (the limit is 20.5 mm2/s
// at 40 °C (kinematic viscosity, ≤))»: пояснение в скобках повторяло сказанное
// словами. Зелёная проверка этого не видела: она искала подстроки, а не
// читаемость. Теперь сторожатся сами признаки повтора.
check('в причине нет ни повтора «kinematic viscosity», ни вложенных скобок',
  ((aspNo.reason ?? '').match(/kinematic viscosity/g) ?? []).length === 1
  && !(aspNo.reason ?? '').includes('((') && !(aspNo.reason ?? '').includes(', ≤)'),
  aspNo.reason ?? '');
check('в агрегате стоит единица, а не подпись колонки базы',
  (aspOk.aggregate?.expr ?? '').includes('mm2/s at 40 °C')
  && !(aspOk.aggregate?.expr ?? '').includes('(kinematic viscosity'),
  aspOk.aggregate?.expr ?? '');
const aspThick = of(run(mixture([toluene(6), hexane(6), water(88, true)], { viscosityMm2s40c: 30 })), 'ASPIRATION')!;
check('вязкость 30 > 20,5 → не классифицировано, и причина говорит почему',
  aspThick.status === 'not_classified' && (aspThick.reason ?? '').includes('is above'),
  `${aspThick.status} — ${aspThick.reason}`);
const aspLow = of(run(mixture([toluene(0.5), water(99.5, true)], { viscosityMm2s40c: 1.2 })), 'ASPIRATION')!;
check('компонент ниже предела релевантности 1 % выпал из суммы — и об этом сказано',
  aspLow.status === 'not_classified' && aspLow.warnings.some((w) => w.code === 'BELOW_RELEVANCE'),
  JSON.stringify(aspLow.warnings.map((w) => w.code)));
const aspLayers = of(run(mixture([toluene(5), water(95, true)], { viscosityMm2s40c: 1.2, separatesIntoLayers: true })), 'ASPIRATION')!;
check('⭐ расслаивающаяся смесь ниже порога → insufficient_data по 3.10.3.3.1.3, а не «неопасно»',
  aspLayers.status === 'insufficient_data' && aspLayers.ruleKey === '3.10.3.3.1.3-LAYERS' && !!aspLayers.raw,
  `${aspLayers.status} ${aspLayers.ruleKey}`);

// 8.8 Контракт выдачи на составе, где работают все три вида арифметики.
const big = run(mixture(
  [methanol(5), toluene(12), hexane(8), mdi(4), phthalicAnhydride(3), water(68, true)],
  { viscosityMm2s40c: 2.0 },
));
const bigNoRule = big.decisions.filter((d) => (d.status === 'classified' || d.status === 'not_classified') && (!d.ruleKey || !d.raw));
check('у каждой строки есть rule_key И дословный raw', bigNoRule.length === 0,
  bigNoRule.map((d) => `${d.classCode}:${d.ruleKey}`).join(', '));
const bigNoReason = big.decisions.filter((d) => (d.status === 'insufficient_data' || d.status === 'not_computed') && !d.reason);
check('у каждой строки без ответа есть причина', bigNoReason.length === 0,
  bigNoReason.map((d) => d.classCode).join(', '));
const bigUnknown = big.decisions
  .flatMap((d) => [d.ruleKey, ...(d.additional ?? []).map((x) => x.ruleKey)])
  .filter((k): k is string => !!k && !k.startsWith('SCL:') && !rules.has(k));
check('каждый rule_key существует в таблице правил', bigUnknown.length === 0, bigUnknown.join(', '));
const bigCrit = criticalOf(big);
check('ни одного критического предупреждения на смешанном составе', bigCrit.length === 0, bigCrit.join(', '));
check('строк по-прежнему ровно по числу классов реестра',
  big.decisions.length === registry.classes().length, `${big.decisions.length}`);
check('смесь получила и полосу, и сумму, и отсечку разом',
  of(big, 'STOT_SE')?.categoryCode === '2'
  && (of(big, 'STOT_SE')?.additional ?? []).some((a) => a.categoryCode === '3 narcotic')
  && of(big, 'ASPIRATION')?.categoryCode === '1'
  && of(big, 'RESP_SENS')?.categoryCode === '1',
  `${of(big, 'STOT_SE')?.categoryCode} / ${of(big, 'ASPIRATION')?.categoryCode} / ${of(big, 'RESP_SENS')?.categoryCode}`);

/* ── 9. отчёт (№118, session 84) ────────────────────────────────────────── */
console.log('\n9. Печатный отчёт');

const className = (c: string): string => registry.className(c);
const rRep = run(mixture(
  [methanol(25), tellurium(0.5), toluene(6), hexane(6), water(62.5)],
  { viscosityMm2s40c: 1.2 },
));
const rep = buildReport(rRep, { className });

// 9.1 ⭐⭐⭐ Отчёт не может ТИХО не напечатать класс: строк в разделах ровно
// столько же, сколько решений в ответе. Именно так теряются целые классы —
// не ошибкой в правиле, а разделом, который «не подошёл».
const linesInReport = rep.sections.reduce((s, x) => s + x.lines.length, 0);
check('в отчёте столько же строк, сколько решений в ответе',
  linesInReport === rRep.decisions.length, `${linesInReport} vs ${rRep.decisions.length}`);
check('раздел «assigned» стоит всегда, даже когда он пуст',
  rep.sections.some((s) => s.key === 'classified'));
check('у каждого раздела есть фраза, объясняющая, чего он стоит',
  rep.sections.every((s) => s.lead.length > 40));

// 9.2 Контракт провенанса переехал в отчёт целиком.
const repNoRule = rep.sections
  .filter((s) => s.key === 'classified' || s.key === 'not_classified')
  .flatMap((s) => s.lines)
  .filter((l) => l.rule.ruleKey === 'no rule key' || !l.rule.raw);
check('у каждой печатаемой строки класса есть ключ правила и дословный текст',
  repNoRule.length === 0, repNoRule.map((l) => l.classCode).join(', '));
const repNoReason = rep.sections
  .filter((s) => s.key === 'insufficient_data' || s.key === 'not_computed')
  .flatMap((s) => s.lines)
  .filter((l) => !l.reason);
check('у каждой строки без ответа причина доехала до отчёта',
  repNoReason.length === 0, repNoReason.map((l) => l.classCode).join(', '));

// 9.3 Эхо входа: что ввели и что взяли в расчёт — ОБЕ величины.
check('в отчёте столько же ингредиентов, сколько ввели', rep.composition.lines.length === 5);
const repRange = buildReport(run(mixture([rangeComp])), { className }).composition.lines[0]!;
check('при диапазоне печатаются обе границы и то, чем считали',
  repRange.entered === '10 – 30 %' && repRange.used === '30 %' && repRange.worstCase,
  `${repRange.entered} → ${repRange.used}`);
check('свойства смеси печатаются ВСЕ, включая незаполненные',
  rep.composition.properties.some((p) => p.label === 'pH' && p.value === 'not entered'),
  JSON.stringify(rep.composition.properties.map((p) => p.label)));
check('пределы компонента доехали в эхо (SCL метанола)',
  (rep.composition.lines.find((l) => l.name === 'methanol')?.scl ?? []).some((s) => s.includes('C≥10 %')));

// 9.4 Сопутствующая категория печатается со своим правилом (s82 → отчёт).
const repRepro = rep.sections.flatMap((s) => s.lines).find((l) => l.classCode === 'REPRO_TOX')!;
check('сопутствующая категория в отчёте несёт СВОЁ правило и СВОЮ цитату',
  repRepro.additional.length === 1
  && repRepro.additional[0]!.rule.ruleKey === 'T3.7.2-LACT'
  && !!repRepro.additional[0]!.rule.raw,
  JSON.stringify(repRepro.additional.map((a) => a.rule.ruleKey)));

// 9.5 Штамп версии.
check('штамп несёт движок, релиз, консолидацию и версию парсера',
  ['Engine', 'Data release', 'Annex VI consolidation', 'Annex VI parser']
    .every((k) => rep.stamp.lines.some((l) => l.label === k)),
  JSON.stringify(rep.stamp.lines.map((l) => l.label)));
check('⭐ №116: объём данных релиза печатается из ответа, а не пишется руками',
  (rep.stamp.lines.find((l) => l.label === 'Data volume')?.value ?? '').includes('13512'),
  rep.stamp.lines.find((l) => l.label === 'Data volume')?.value ?? '');
check('совпадающие штампы молчат', rep.stamp.notes.length === 0, rep.stamp.notes.join(' | '));

// 9.6 ⭐⭐⭐ №110: РАСХОЖДЕНИЕ ШТАМПОВ ВИДНО, А НЕ ВЫБИРАЕТСЯ МОЛЧА. Ровно этот
// дефект жил в базе: там стояло `a0-parser 1.0`, в коде `1.1`, и заметить это
// было нечем — а печатается он в самом заметном месте аудиторского отчёта.
const DRIFT: ClassifierData = {
  ...DATA,
  release: { ...DATA.release!, engineVersion: 'classifier 0.9', parserVersion: 'a0-parser 1.0 (s78)' },
};
const rDrift = classifyMixture(mixture([methanol(25), water(75, true)]), DRIFT, { computedAt: '2026-08-22T00:00:00Z' });
const repDrift = buildReport(rDrift, { className });
check('расхождение версии движка и версии парсера — два отдельных предупреждения',
  rDrift.warnings.filter((w) => w.code === 'ENGINE_STAMP_DRIFT' || w.code === 'PARSER_STAMP_DRIFT').length === 2,
  JSON.stringify(rDrift.warnings.map((w) => w.code)));
check('в отчёте они стоят в подвале версии, а не в списке замечаний к смеси',
  repDrift.stamp.notes.length === 2
  && !repDrift.warnings.some((w) => w.code.endsWith('STAMP_DRIFT')),
  `${repDrift.stamp.notes.length} / ${repDrift.warnings.map((w) => w.code).join(',')}`);
check('обе строки версии напечатаны, ни одна не выброшена',
  repDrift.stamp.notes.join(' ').includes('classifier 0.9')
  && repDrift.stamp.notes.join(' ').includes(ENGINE_VERSION)
  && repDrift.stamp.notes.join(' ').includes('a0-parser 1.0 (s78)'));

// 9.7 Отпечаток результата: чем он обязан быть и чем НЕ обязан.
check('отпечаток детерминирован: тот же вход → тот же отпечаток',
  resultFingerprint(rRep) === resultFingerprint(run(mixture(
    [methanol(25), tellurium(0.5), toluene(6), hexane(6), water(62.5)], { viscosityMm2s40c: 1.2 }))));
check('⭐ метка времени в отпечаток НЕ входит — иначе каждая копия расчёта была бы «другим результатом»',
  resultFingerprint(rRep)
  === resultFingerprint(classifyMixture(
    mixture([methanol(25), tellurium(0.5), toluene(6), hexane(6), water(62.5)], { viscosityMm2s40c: 1.2 }),
    DATA, { computedAt: '2030-01-01T00:00:00Z' })));
check('смена ответа меняет отпечаток (DEGME 1 % против 5 %)',
  resultFingerprint(run(mixture([degme(1), water(99, true)])))
  !== resultFingerprint(run(mixture([degme(5), water(95, true)]))));
check('отпечаток — 16 hex-знаков', /^[0-9a-f]{16}$/.test(rep.fingerprint), rep.fingerprint);

// 9.8 ⚠⚠ НЕГАТИВНЫЕ МАРКЕРЫ ФОРМЫ ТЕКСТА — урок s83 («подстрока ≠ читаемость»).
// Отчёт собирается из десятков необязательных полей; первая же забытая проверка
// на `null` печатает читателю «undefined» вместо числа, и подстроковая проверка
// этого не увидит, потому что искала бы то, что есть, а не то, чего быть не должно.
const repText = JSON.stringify(rep);
const BAD = ['undefined', 'null', 'NaN', '[object Object]', ': ,', '  '];
const badFound = BAD.filter((b) => repText.includes(`"${b}`) || repText.includes(`${b}"`) || repText.includes(` ${b} `));
check('в напечатанном отчёте нет ни undefined, ни null, ни NaN, ни object Object',
  badFound.length === 0, badFound.join(', '));
check('прочерк там, где значения нет, а не пустая строка',
  rep.sections.flatMap((s) => s.lines).every((l) => l.category.length > 0 && l.hCode.length > 0));

// 9.9 ⭐⭐⭐ АГРЕГАТ И ТАБЛИЦА ВКЛАДОВ НЕ МОГУТ ПРОТИВОРЕЧИТЬ ДРУГ ДРУГУ.
// Дефект s84, найденный чтением отчёта: аспирация печатала «toluene 6.0 % +
// n-hexane 6.0 % = 12.0 % >= 10.0 %», а те же два компонента в таблице стояли
// как «not counted». Проверка общая, а не про аспирацию: если компонент назван
// в арифметике, он обязан быть помечен учтённым — в любом классе и любом модуле.
const contradictions = rRep.decisions.flatMap((d) => {
  const expr = d.aggregate?.expr ?? '';
  if (!expr) return [];
  return d.contributions
    .filter((c) => !c.counted && c.name && expr.includes(c.name))
    .map((c) => `${d.classCode}: ${c.name}`);
});
check('компонент, названный в арифметике, помечен учтённым', contradictions.length === 0,
  contradictions.join(', '));
const aspContrib = of(rRep, 'ASPIRATION')!.contributions.filter((c) => c.counted);
check('оба члена суммы аспирации учтены, и провенанс называет сумму',
  aspContrib.length === 2 && aspContrib.every((c) => c.provenance.includes('counted in the sum of this class')),
  aspContrib.map((c) => `${c.name}: ${c.provenance}`).join(' | '));
const aspBelow = of(run(mixture([toluene(0.5), water(99.5, true)], { viscosityMm2s40c: 1.2 })), 'ASPIRATION')!;
check('отсеянный по релевантности в сумму НЕ попал и учтённым не помечен',
  aspBelow.contributions.every((c) => !c.counted),
  aspBelow.contributions.map((c) => `${c.name}:${c.counted}`).join(', '));

// 9.10 Согласование в числе там, где число подставляется в предложение.
const oneCarrier = of(run(mixture([hexane(5), water(95, true)])), 'AQUATIC_CHRONIC')!;
check('«1 ingredient … carries it», а не «carry it»',
  (oneCarrier.reason ?? '').includes('1 ingredient in this mixture carries it')
  && !(oneCarrier.reason ?? '').includes('carry it'),
  oneCarrier.reason ?? '');
const twoCarriers = of(run(mixture([toluene(5), hexane(5), water(90, true)])), 'SKIN_CORR_IRRIT')!;
check('«2 ingredients … carry it» — множественное на месте',
  (twoCarriers.reason ?? '').includes('2 ingredients in this mixture carry it'),
  twoCarriers.reason ?? '');

// 9.11 PDF — та же модель строкой.
const html = reportPdfHtml(rep);
check('PDF-разметка несёт вердикт, эхо входа, разделы и штамп',
  ['CLP mixture classification report', 'What was entered', 'Data release and engine', 'Hazard classes assigned']
    .every((s) => html.includes(s)));
check('⭐ в PDF-разметке нет ни одного токена и ни одного oklch — html2canvas 1.4.1 их не разбирает (урок s79)',
  !html.includes('var(--') && !/oklch|oklab|color-mix/i.test(html));
check('данные ответа экранированы, а не вставлены как разметка',
  !buildAndRender('<script>alert(1)</script>').includes('<script>alert(1)</script>'));
// ⚠ Та же негативная проверка, но по ГОТОВОЙ разметке: в модели `null` законен
// (поля необязательные), а в напечатанном листе — нет.
check('в PDF-разметке нет ни undefined, ни NaN, ни [object Object]',
  !/undefined|NaN|\[object Object\]/.test(html));
check('строка отчёта и строка PDF говорят об одном и том же классе',
  html.includes(className('ASPIRATION')) && rep.sections.flatMap((s) => s.lines).some((l) => l.classCode === 'ASPIRATION'));

/**
 * Прогон с ингредиентом, чьё имя — разметка. ⛔ Имя приходит из базы (№125), но
 * `supplier`-строку человек печатает сам, и она попадает и в отчёт, и в PDF.
 */
function buildAndRender(name: string): string {
  const evil: ComponentInput = { id: 'evil', source: 'supplier', name, conc: 5, classifications: [], knownNonhazard: true };
  return reportPdfHtml(buildReport(run(mixture([evil, water(95, true)])), { className }));
}

// 9.12 ⭐⭐⭐ ПОЛЕ МОДЕЛИ, КОТОРОЕ НИКТО НЕ ПЕЧАТАЕТ, — ЭТО МОЛЧАЛИВАЯ ПОТЕРЯ.
// Дефект s84, найденный Сергеем на проде, а не проверкой: модель несла вердикт
// целиком — сигнальное слово, пиктограммы, H-коды, — PDF его печатал, а экранный
// отчёт начинался сразу с эха ввода. Обе половины были «зелёными»: одна печатала
// то, что умеет, другая молчала о том, чего не умеет.
// ⚠ Проверка НЕ перечисляет, что должно быть напечатано (урок s82): список полей
// берётся из САМОЙ МОДЕЛИ, а исключения названы поимённо вместе с местом, где
// поле печатается вместо этого.
const SCREEN = readFileSync(new URL('../src/components/MixtureReport.tsx', import.meta.url), 'utf8');
const PDF = readFileSync(new URL('../src/lib/classifier/reportHtml.ts', import.meta.url), 'utf8');
/** Поля, которых на ЭКРАНЕ нет намеренно, и где они вместо этого стоят. */
const SCREEN_ELSEWHERE: Record<string, string> = {
  shareUrl: 'печатается строкой под кнопками острова',
  disclaimer: 'стоит на странице вне ветки результата (s81) — второй копии быть не должно',
  method: 'стоит в разделе «02 · Method» самой страницы',
};
const modelKeys = Object.keys(rep);
check('модель отчёта не пустая и её поля можно перечислить', modelKeys.length >= 10, String(modelKeys.length));
const pdfMissing = modelKeys.filter((k) => !PDF.includes(`m.${k}`));
check('PDF печатает КАЖДОЕ поле модели — он уезжает один, без страницы',
  pdfMissing.length === 0, pdfMissing.join(', '));
const screenMissing = modelKeys.filter((k) => !SCREEN.includes(`model.${k}`) && !(k in SCREEN_ELSEWHERE));
check('экранный отчёт печатает каждое поле модели, кроме названных исключений',
  screenMissing.length === 0, screenMissing.join(', '));
check('вердикт с пиктограммами и сигнальным словом есть В ОБОИХ отображениях',
  SCREEN.includes('model.verdict.pictograms') && SCREEN.includes('model.verdict.signalWord')
  && PDF.includes('m.verdict.pictograms') && PDF.includes('m.verdict.signalWord'));
check('пиктограмма в PDF нарисована ромбом, а не напечатана кодом в плашке',
  PDF.includes('<polygon points=') && html.includes('<polygon points='));
const vd = rep.verdict;
check('в вердикте примера есть и сигнальное слово, и пиктограммы, и H-коды',
  vd.signalWord === 'Danger' && vd.pictograms.length > 0 && vd.hCodes.length > 0,
  `${vd.signalWord} · ${vd.pictograms.join(',')} · ${vd.hCodes.length}`);

console.log(`\n${failed ? `✗ ПРОВАЛЕНО: ${failed} из ${total}` : `✓ каркас зелёный — ${total} проверок`}`);
process.exit(failed ? 1 : 0);
