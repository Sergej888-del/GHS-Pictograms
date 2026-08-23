// src/lib/classifier/modules/cutoff.ts
// Модуль A4 — классы, которые считаются по концентрационным пределам
// (design-doc §5.4, шаг 6 §9). Заход 1 — session 82 (восемь классов по отсечке),
// заход 2 — session 83 (сенсибилизация, STOT SE, STOT RE, аспирация).
//
// ⭐⭐⭐ ТРИ ВИДА АРИФМЕТИКИ, И ИХ НЕЛЬЗЯ ПУТАТЬ:
//   • `component` — порог сравнивается С ОДНИМ КОМПОНЕНТОМ. Table 3.5.2 / 3.6.2 /
//     3.7.2 / 3.11.2 / 4.2.2 / 5.1 / 3.4.5 и разделы 4.3.3.1 / 4.4.3.1 говорят
//     «at least one ingredient … present at or above the … concentration limit».
//     Складывать здесь два канцерогена по 0,06 % было бы не «строже», а неверно;
//   • `band` — ПОЛОСА `low ≤ C < high`. Table 3.8.3 и 3.9.4: компонент категории 1
//     в полосе от 1,0 % до 10 % даёт смеси категорию 2, а не 1. Верхняя граница
//     тоже приходит из базы (`limit_high`), в файле её нет;
//   • `sum` — СУММА по релевантным компонентам. STOT SE 3 (3.8.3.4.5) и аспирация
//     (3.10.3.3.1.2). Релевантность — своя строка правил, а не «на глаз».
//
// ⭐⭐⭐ SCL СТАРШЕ ОБЩЕГО ПРЕДЕЛА, И КОМПОНЕНТ СО СВОИМ SCL В ОБЩИЙ ПУТЬ НЕ
// ВХОДИТ (`classifier-scaffold-s80.md` §5) — в том числе НЕ ВХОДИТ В СУММУ.
// Специальный предел Annex VI не «уточняет» общий, он его ЗАМЕНЯЕТ для этого
// вещества. Общий предел при этом не прячется: он уходит в `candidates` с
// пометкой «checked and outranked» — это провенанс, а не украшение.
//
// ⚠⚠ 20 % У STOT SE 3 — НЕ ЖЁСТКИЙ ПОРОГ. Источник (3.8.3.4.5) говорит
// «appropriate … expert judgement shall be exercised» и прямо предупреждает, что
// наркотическое действие может проявиться и ниже. Строка обязана это сказать:
// молчаливое «not classified» здесь было бы ложной точностью.
//
// ⛔ Строки для человека — по-английски (урок s68: литералы лежат в бандле).
// ⛔ Ни одного числа: пороги, полосы, релевантность и предельная вязкость
//    читаются из `clp_generic_limits`. Разойдётся база с планом модуля —
//    покраснеет `RULE_MISSING`/`RULE_INCOMPLETE`, а не тихо посчитается.

import { tokenizeClassCat } from '../annex6Abbrev.ts';
import { decide, type AdditionalInput } from '../data.ts';
import type {
  Aggregate, ClassCat, ClassifierData, ClassifierModule, Candidate, Contribution, Decision,
  GenericLimitRow, ModuleContext, ModuleOutput, NormalizedComponent, NormalizedInput,
  PhysicalState, SclRow, Supplemental, Warning,
} from '../types.ts';

/* ── план класса ─────────────────────────────────────────────────────────── */

/** Как ступень сравнивает состав с порогом. */
type StepMode = 'component' | 'band' | 'sum';

/** Одна ступень: правило Annex I, категории КОМПОНЕНТА, категория СМЕСИ. */
interface Step {
  /** `clp_generic_limits.rule_key`; порог берётся из этой же строки, не отсюда. */
  ruleKey: string;
  /** Категории компонента на языке реестра, которые считает эта ступень. */
  ingredient: string[];
  /** Категория смеси на языке реестра. */
  result: string;
  /** По умолчанию `component`. */
  mode?: StepMode;
  /**
   * ⚠ Ключ дополняется агрегатным состоянием СМЕСИ: `-SL` | `-GAS`. Table 3.4.5
   * даёт респираторному сенсибилизатору ДВА разных предела — для твёрдых и
   * жидких смесей и для газовых, — и в базе они разведены двумя строками.
   */
  byState?: boolean;
  /** `sum`: строка правил, задающая порог участия компонента в сумме. */
  relevanceRuleKey?: string;
  /** `sum`: общая отсечка Table 1.1; берётся МЕНЬШИЙ из двух порогов. */
  cutoffRuleKey?: string;
  /** `sum`: свойство смеси, которое решает наравне с суммой. */
  gate?: 'viscosity';
}

/**
 * Дорожка — ступени ОДНОГО ряда строгости, от строгой к мягкой. Внутри дорожки
 * выигрывает первая сработавшая; дорожек больше одной там, где категории класса
 * не сравниваются как степени, а сосуществуют (см. `AdditionalCategory`).
 */
type Track = Step[];

/** Ступень элиситации (Table 3.4.6) — она не классифицирует, а даёт EUH208. */
interface ElicitationStep {
  ruleKey: string;
  ingredient: string[];
  byState?: boolean;
}

interface ClassPlan {
  classCode: string;
  tracks: Track[];
  /** Пороги «SDS по запросу» из примечаний к таблицам — идут в `supplemental`. */
  sdsTriggers?: { ruleKey: string; ingredient: string[] }[];
  /** Table 3.4.6: пределы элиситации → EUH208 (Annex II 2.8). */
  elicitation?: ElicitationStep[];
  /** ⛔ По-английски: уезжает в браузер. «skin sensitiser» / «respiratory sensitiser». */
  elicitationLabel?: string;
  /** 3.10.3.3.1.3: смесь, расслаивающаяся на слои, судится ПО СЛОЯМ. */
  layersRuleKey?: string;
  /** Правило, чей порог источник называет «appropriate», а не абсолютным. */
  softLimitRuleKey?: string;
}

/**
 * ⚠ Ключи правил и категории — из живой базы (замеры s82 и s83). Ни одного
 * числа: порог читается из той строки `clp_generic_limits`, чей ключ здесь
 * назван.
 */
export const CUTOFF_PLANS: ClassPlan[] = [
  {
    classCode: 'CARCINOGEN',
    tracks: [[
      { ruleKey: 'T3.6.2-1A', ingredient: ['1A'], result: '1A' },
      { ruleKey: 'T3.6.2-1B', ingredient: ['1B'], result: '1B' },
      { ruleKey: 'T3.6.2-2', ingredient: ['2'], result: '2' },
    ]],
    sdsTriggers: [{ ruleKey: 'T3.6.2-2-SDS', ingredient: ['2'] }],
  },
  {
    classCode: 'MUTAGEN',
    tracks: [[
      { ruleKey: 'T3.5.2-1A', ingredient: ['1A'], result: '1A' },
      { ruleKey: 'T3.5.2-1B', ingredient: ['1B'], result: '1B' },
      { ruleKey: 'T3.5.2-2', ingredient: ['2'], result: '2' },
    ]],
  },
  {
    // ⚠⚠ ДВЕ ДОРОЖКИ. «Lact.» — последняя колонка Table 3.7.2, названная в
    // источнике «Additional category for effects on or via lactation»: она не
    // конкурирует с Repr. 1A/1B/2, а прибавляется к ним. Худшая-из-двух здесь
    // потеряла бы H362 (решение Сергея s82).
    classCode: 'REPRO_TOX',
    tracks: [
      [
        { ruleKey: 'T3.7.2-1A', ingredient: ['1A'], result: '1A' },
        { ruleKey: 'T3.7.2-1B', ingredient: ['1B'], result: '1B' },
        { ruleKey: 'T3.7.2-2', ingredient: ['2'], result: '2' },
      ],
      [{ ruleKey: 'T3.7.2-LACT', ingredient: ['Lactation'], result: 'Lactation' }],
    ],
    sdsTriggers: [{ ruleKey: 'T3.7.2-SDS', ingredient: ['1A', '1B', '2', 'Lactation'] }],
  },
  {
    classCode: 'ED_HH',
    tracks: [[
      { ruleKey: 'T3.11.2-1', ingredient: ['1'], result: '1' },
      { ruleKey: 'T3.11.2-2', ingredient: ['2'], result: '2' },
    ]],
    sdsTriggers: [{ ruleKey: 'T3.11.2-2-SDS', ingredient: ['2'] }],
  },
  {
    classCode: 'ED_ENV',
    tracks: [[
      { ruleKey: 'T4.2.2-1', ingredient: ['1'], result: '1' },
      { ruleKey: 'T4.2.2-2', ingredient: ['2'], result: '2' },
    ]],
    sdsTriggers: [{ ruleKey: 'T4.2.2-2-SDS', ingredient: ['2'] }],
  },
  {
    // ⚠ PBT и vPvB — разные свойства, а не степени одного: 4.3.3.1 переносит на
    // смесь каждое из них порознь. Состав может нести оба (разными компонентами),
    // и тогда на этикетке обязаны стоять и EUH440, и EUH441.
    classCode: 'PBT_VPVB',
    tracks: [
      [{ ruleKey: '4.3.3.1-PBT', ingredient: ['PBT'], result: 'PBT' }],
      [{ ruleKey: '4.3.3.1-VPVB', ingredient: ['vPvB'], result: 'vPvB' }],
    ],
  },
  {
    classCode: 'PMT_VPVM',
    tracks: [
      [{ ruleKey: '4.4.3.1-PMT', ingredient: ['PMT'], result: 'PMT' }],
      [{ ruleKey: '4.4.3.1-VPVM', ingredient: ['vPvM'], result: 'vPvM' }],
    ],
  },
  {
    classCode: 'OZONE',
    tracks: [[{ ruleKey: 'T5.1-OZONE', ingredient: ['1'], result: '1' }]],
  },

  /* ── заход 2 (session 83) ────────────────────────────────────────────────── */

  {
    // ⚠ Результат Table 3.4.5 — «Skin sensitiser Category 1» ДЛЯ ВСЕХ ТРЁХ строк
    // (так в колонке результата в базе): подкатегория 1A/1B — это категория
    // КОМПОНЕНТА, у неё свой предел, но смеси она даёт «1». Подкатегорию смеси
    // может назначить только собственный предел вещества (см. `findStep`).
    classCode: 'SKIN_SENS',
    tracks: [[
      { ruleKey: 'T3.4.5-SKIN1A', ingredient: ['1A'], result: '1' },
      { ruleKey: 'T3.4.5-SKIN1B', ingredient: ['1B'], result: '1' },
      { ruleKey: 'T3.4.5-SKIN1', ingredient: ['1'], result: '1' },
    ]],
    elicitation: [
      { ruleKey: 'T3.4.6-SKIN1A', ingredient: ['1A'] },
      { ruleKey: 'T3.4.6-SKIN1B', ingredient: ['1B'] },
      { ruleKey: 'T3.4.6-SKIN1', ingredient: ['1'] },
    ],
    elicitationLabel: 'skin sensitiser',
  },
  {
    // ⚠⚠ ДВА РАЗНЫХ ПРЕДЕЛА ПО АГРЕГАТНОМУ СОСТОЯНИЮ СМЕСИ. Table 3.4.5 даёт
    // респираторному сенсибилизатору категории 1 предел ≥ 1,0 % для твёрдой и
    // жидкой смеси и ≥ 0,2 % для газовой; в базе это строки `-SL` и `-GAS`.
    // Взять не ту колонку — тихая ошибка в пять раз.
    classCode: 'RESP_SENS',
    tracks: [[
      { ruleKey: 'T3.4.5-RESP1A', ingredient: ['1A'], result: '1', byState: true },
      { ruleKey: 'T3.4.5-RESP1B', ingredient: ['1B'], result: '1', byState: true },
      { ruleKey: 'T3.4.5-RESP1', ingredient: ['1'], result: '1', byState: true },
    ]],
    elicitation: [
      { ruleKey: 'T3.4.6-RESP1A', ingredient: ['1A'], byState: true },
      { ruleKey: 'T3.4.6-RESP1B', ingredient: ['1B'], byState: true },
      { ruleKey: 'T3.4.6-RESP1', ingredient: ['1'], byState: true },
    ],
    elicitationLabel: 'respiratory sensitiser',
  },
  {
    // ⚠⚠⚠ ТРИ ДОРОЖКИ, И ВСЕ ТРИ МОГУТ СРАБОТАТЬ РАЗОМ.
    //   • системная (категории 1 и 2) — отсечка и полоса Table 3.8.3;
    //   • «3» (H335, раздражение дыхательных путей) — СУММА ≥ порога;
    //   • «3 narcotic» (H336, наркотическое действие) — ОТДЕЛЬНАЯ СУММА.
    // Источник (3.8.3.4.5) прямо требует: «Respiratory tract irritation and
    // narcotic effects are to be evaluated separately». Одна сумма на две
    // дорожки классифицировала бы смесь по эффекту, которого в ней нет.
    classCode: 'STOT_SE',
    tracks: [
      [
        { ruleKey: 'T3.8.3-1-GE10', ingredient: ['1'], result: '1' },
        { ruleKey: 'T3.8.3-1-1-10', ingredient: ['1'], result: '2', mode: 'band' },
        { ruleKey: 'T3.8.3-2-GE10', ingredient: ['2'], result: '2' },
      ],
      [{
        ruleKey: '3.8.3.4.5-CAT3-GCL20', ingredient: ['3'], result: '3', mode: 'sum',
        relevanceRuleKey: '3.8.3.4.6-CAT3-RELEVANT', cutoffRuleKey: 'T1.1-STOT_SE-CAT3',
      }],
      [{
        ruleKey: '3.8.3.4.5-CAT3-GCL20', ingredient: ['3 narcotic'], result: '3 narcotic', mode: 'sum',
        relevanceRuleKey: '3.8.3.4.6-CAT3-RELEVANT', cutoffRuleKey: 'T1.1-STOT_SE-CAT3',
      }],
    ],
    sdsTriggers: [{ ruleKey: 'T3.8.3-2-SDS', ingredient: ['2'] }],
    softLimitRuleKey: '3.8.3.4.5-CAT3-GCL20',
  },
  {
    // Та же арифметика полос, что у Table 3.8.3, но без категории 3.
    classCode: 'STOT_RE',
    tracks: [[
      { ruleKey: 'T3.9.4-1-GE10', ingredient: ['1'], result: '1' },
      { ruleKey: 'T3.9.4-1-1-10', ingredient: ['1'], result: '2', mode: 'band' },
      { ruleKey: 'T3.9.4-2-GE10', ingredient: ['2'], result: '2' },
    ]],
    sdsTriggers: [{ ruleKey: 'T3.9.4-2-SDS', ingredient: ['2'] }],
  },
  {
    // ⚠⚠ ДВА УСЛОВИЯ СРАЗУ: сумма категории 1 И кинематическая вязкость смеси.
    // Без вязкости ответа НЕТ — и строка обязана сказать «данных не хватает» и
    // назвать недостающее число, а не «не классифицировано» (решение Сергея s83).
    classCode: 'ASPIRATION',
    tracks: [[{
      ruleKey: '3.10.3.3.1.2-CAT1', ingredient: ['1'], result: '1', mode: 'sum',
      relevanceRuleKey: '3.10.3.3.1.1-RELEVANT', cutoffRuleKey: 'T1.1-ASPIRATION',
      gate: 'viscosity',
    }]],
    layersRuleKey: '3.10.3.3.1.3-LAYERS',
  },
];

/**
 * Классы A4, до которых модуль не дошёл. ⭐ После захода 2 (s83) таких нет:
 * все тринадцать классов модуля считаются. Массив оставлен потому, что механика
 * честной строки `not_computed` С ПРИЧИНОЙ — часть контракта модуля, а не
 * временный костыль: следующий класс, который попадёт сюда, обязан объяснить,
 * чего именно не хватает (урок s76 — пустая ячейка читается как «неопасно»).
 */
export const DEFERRED_CLASSES: { classCode: string; reason: string }[] = [];

/** Все классы, за которые модуль отвечает: посчитанные плюс отложенные. */
export const A4_CLASSES: string[] = [
  ...CUTOFF_PLANS.map((p) => p.classCode),
  ...DEFERRED_CLASSES.map((d) => d.classCode),
];

/* ── SCL компонента ──────────────────────────────────────────────────────── */

/** Специальный предел компонента, разобранный до категории реестра. */
interface SclEntry {
  row: SclRow;
  /** `SCL:<index|id>:<seq>` — как в контракте провенанса (design-doc §5.2). */
  ruleKey: string;
  classCode: string;
  categoryCode: string;
}

interface SclSplit {
  usable: SclEntry[];
  unusable: { row: SclRow; why: string }[];
}

/**
 * Разбор строк SCL компонента для одного класса.
 *
 * ⚠⚠ НЕРАЗОБРАННАЯ ИЛИ БЕСЧИСЛЕННАЯ СТРОКА SCL НЕ ВЫКЛЮЧАЕТ КОМПОНЕНТ ИЗ ОБЩЕГО
 * ПУТИ. Соблазн сказать «у него есть свой предел, значит общий не наш» тут
 * опасен в одну сторону: 36 строк SCL помечены `needs_review` и чисел не несут
 * («Carc. 1B; H350: C ≥ 0,01 % * oral»), и молчаливое исключение занизило бы
 * классификацию. Поэтому такие строки дают предупреждение, а компонент считается
 * по общему пределу.
 */
function sclFor(c: NormalizedComponent, classCode: string): SclSplit {
  const usable: SclEntry[] = [];
  const unusable: { row: SclRow; why: string }[] = [];
  const rows = c.input.scl ?? [];
  const key = c.input.indexNumber ?? c.id;

  rows.forEach((row, i) => {
    if (!row.classCat) return;
    const parsed = tokenizeClassCat([row.classCat]);
    const token = parsed.tokens.find((t) => t.classCode === classCode);
    if (!token) {
      // Строка про другой класс — молчим. Про ЭТОТ класс, но неразобранная —
      // говорим: иначе предел исчезнет без следа.
      if (parsed.tokens.length === 0 && parsed.unparsed.length) {
        unusable.push({ row, why: `the class and category of this specific limit could not be read ("${row.classCat}")` });
      }
      return;
    }
    if (token.categoryCode == null) {
      unusable.push({ row, why: `this specific limit names the class but not the category ("${row.classCat}")` });
      return;
    }
    if (row.limitLow == null && row.limitHigh == null) {
      unusable.push({ row, why: 'this specific limit carries no number our database could read' });
      return;
    }
    usable.push({
      row,
      ruleKey: `SCL:${key}:${i + 1}`,
      classCode,
      categoryCode: token.categoryCode,
    });
  });

  return { usable, unusable };
}

/** Попадает ли концентрация в полосу SCL: `low ≤ C` и `C < high`. */
function inBand(conc: number, row: SclRow): boolean {
  if (row.limitLow != null && conc < row.limitLow) return false;
  if (row.limitHigh != null && conc >= row.limitHigh) return false;
  return true;
}

/* ── вспомогательное ─────────────────────────────────────────────────────── */

function pairsOf(c: NormalizedComponent, classCode: string): ClassCat[] {
  return c.classifications.filter((p) => p.classCode === classCode);
}

function fmtPct(n: number): string {
  return n >= 1 ? n.toFixed(1) : Number(n.toPrecision(3)).toString();
}

function fmtNum(n: number): string {
  return Number(n.toPrecision(4)).toString();
}

/**
 * Единица числа-шлюза без пояснения в скобках.
 *
 * ⚠⚠ `clp_generic_limits.value_unit` — это ОПИСАНИЕ КОЛОНКИ, а не единица:
 * «mm2/s at 40 °C (kinematic viscosity, ≤)». Подставленное в предложение
 * целиком, оно повторяет то, что уже сказано словами, и порождает вложенные
 * скобки. Берём часть до первой скобки; нет скобки — берём как есть.
 */
function unitOf(row: GenericLimitRow | null): string {
  const u = row?.valueUnit ?? '';
  const at = u.indexOf(' (');
  return (at >= 0 ? u.slice(0, at) : u).trim();
}

/** Человеческое имя категории компонента для строки провенанса. */
function pairLabel(p: ClassCat): string {
  return p.raw && p.raw.trim() ? p.raw.trim() : `${p.classCode} ${p.categoryCode ?? ''}`.trim();
}

/**
 * Ключ правила с учётом агрегатного состояния СМЕСИ (Table 3.4.5 / 3.4.6).
 * ⚠ Состояние смеси, а не компонента: колонку таблицы выбирает то, чем является
 * смесь, — так написано в шапке таблицы.
 */
function keyOf(step: { ruleKey: string; byState?: boolean }, state: PhysicalState): string {
  if (!step.byState) return step.ruleKey;
  return `${step.ruleKey}${state === 'gas' ? '-GAS' : '-SL'}`;
}

function modeOf(step: Step): StepMode {
  return step.mode ?? 'component';
}

/* ── одно решение по классу ──────────────────────────────────────────────── */

interface Hit {
  trackIndex: number;
  stepIndex: number;
  categoryCode: string;
  ruleKey: string;
  /** Дословный текст, когда правило живёт не в `clp_generic_limits` (SCL). */
  raw?: string | null;
  source: 'SCL' | 'GCL';
  componentId?: string;
  componentName?: string;
  conc?: number;
  limit: number | null;
  /** Готовый агрегат — у суммарных ступеней он не про один компонент. */
  agg?: Aggregate;
  /** Вклады суммарной ступени. */
  contribs?: Contribution[];
}

/** Результат разбора суммарной ступени — нужен и решению, и причине, и кандидатам. */
interface SumEval {
  trackIndex: number;
  stepIndex: number;
  step: Step;
  ruleKey: string;
  limit: number | null;
  relevance: number | null;
  sum: number;
  members: NormalizedComponent[];
  below: NormalizedComponent[];
  /** Всего компонентов этой категории на общем пути (до отсева по релевантности). */
  candidatesCount: number;
  passed: boolean;
  /** `null` — шлюза нет или данных для него нет. */
  gatePassed: boolean | null;
  gateText: string | null;
}

/** Причина, по которой ответа НЕТ (в отличие от «порог не достигнут»). */
interface Blocker {
  ruleKey: string;
  reason: string;
}

function classDecision(
  plan: ClassPlan,
  input: NormalizedInput,
  ctx: ModuleContext,
): { decision: Decision; supplemental: Supplemental[] } {
  const { rules, registry } = ctx;
  const state = input.physicalState;
  const live = input.components.filter((c) => c.conc > 0);
  const carriers = live.filter((c) => pairsOf(c, plan.classCode).length > 0);

  const contributions: Contribution[] = [];
  const candidates: Candidate[] = [];
  const warnings: Warning[] = [];
  const hits: Hit[] = [];
  const supplemental: Supplemental[] = [];
  const blockers: Blocker[] = [];
  /** `<track>:<step>` → компоненты, для которых общий предел заменил SCL. */
  const outranked = new Map<string, string[]>();
  /** Компоненты общего пути, ждущие суммарной ступени: `<track>:<step>` → состав. */
  const sumMembers = new Map<string, NormalizedComponent[]>();
  /** Разбор SCL считается один раз на компонент: он нужен и расчёту, и элиситации. */
  const sclCache = new Map<string, SclSplit>();

  const posKey = (t: number, s: number): string => `${t}:${s}`;

  // ⚠ Порог берётся из снимка, а не из этого файла (design-doc §5.4).
  const rowOf = (ruleKey: string): GenericLimitRow | null => {
    const row = rules.get(ruleKey);
    if (!row) {
      warnings.push({
        code: 'RULE_MISSING', level: 'critical', ruleKey,
        message: 'A generic concentration limit this class rests on is not in the rule table — report this result.',
      });
      return null;
    }
    return row;
  };
  const limitOf = (ruleKey: string): number | null => {
    const row = rowOf(ruleKey);
    if (!row) return null;
    if (row.limitLow == null) {
      warnings.push({
        code: 'RULE_INCOMPLETE', level: 'critical', ruleKey,
        message: 'A generic concentration limit this class rests on carries no number in the rule table — report this result.',
      });
      return null;
    }
    return row.limitLow;
  };

  for (const c of carriers) {
    const pairs = pairsOf(c, plan.classCode);
    const split = sclFor(c, plan.classCode);
    sclCache.set(c.id, split);
    const { usable, unusable } = split;

    for (const u of unusable) {
      warnings.push({
        code: 'SCL_UNUSABLE', level: 'caution', componentId: c.id,
        message: `${c.name} carries a specific concentration limit for this class in Annex VI, but ${u.why}. The generic limit was used instead — check the Annex VI entry before relying on this line.`,
      });
    }

    if (usable.length) {
      // ── путь SCL: компонент судится ТОЛЬКО своими пределами ──────────────
      // ⭐ Отмечаем СРАЗУ, какие общие пределы этот компонент больше не
      // проходит. Пометка не зависит от того, сработал ли SCL: общий предел
      // заменён в любом случае, и именно это надо показать читателю, когда
      // строка вышла «not classified» при концентрации выше общего порога.
      // ⚠ Для суммарной ступени это же означает: компонент НЕ входит в сумму.
      plan.tracks.forEach((track, trackIndex) => {
        track.forEach((step, stepIndex) => {
          if (!pairs.some((p) => p.categoryCode != null && step.ingredient.includes(p.categoryCode))) return;
          const k = posKey(trackIndex, stepIndex);
          const names = outranked.get(k) ?? [];
          names.push(c.name);
          outranked.set(k, names);
        });
      });

      let matched = false;
      for (const e of usable) {
        const band = inBand(c.conc, e.row);
        const place = findStep(plan, e.categoryCode, registry.entry(plan.classCode, e.categoryCode) != null);
        candidates.push({
          categoryCode: e.categoryCode,
          ruleKey: e.ruleKey,
          passed: band && place != null,
          note: `specific concentration limit of ${c.name} — ${e.row.raw}`,
        });
        if (e.row.needsReview) {
          warnings.push({
            code: 'LIMIT_NEEDS_REVIEW', level: 'caution', componentId: c.id, ruleKey: e.ruleKey,
            message: `The specific concentration limit of ${c.name} is flagged for review in our database — the wording of the source is ambiguous.`,
          });
        }
        if (!band) continue;
        if (place == null) {
          warnings.push({
            code: 'SCL_CATEGORY_UNPLACED', level: 'critical', componentId: c.id, ruleKey: e.ruleKey,
            message: `The specific concentration limit of ${c.name} gives category ${e.categoryCode}, which this module does not know for this class — report this result.`,
          });
          continue;
        }
        matched = true;
        hits.push({
          trackIndex: place.trackIndex,
          stepIndex: place.stepIndex,
          categoryCode: e.categoryCode,
          ruleKey: e.ruleKey,
          raw: e.row.raw,
          source: 'SCL',
          componentId: c.id,
          componentName: c.name,
          conc: c.conc,
          limit: e.row.limitLow,
        });
      }

      contributions.push({
        componentId: c.id,
        name: c.name,
        conc: c.conc,
        value: c.conc,
        limit: usable[0]!.row.limitLow,
        limitSource: 'SCL',
        provenance: `${pairs.map(pairLabel).join(', ')} — specific concentration limit: ${usable.map((e) => e.row.raw).join(' | ')}`,
        counted: matched,
      });
      if (pairs.some((p) => p.star)) warnStar(warnings, c);
      continue;
    }

    // ── общий путь: ступень за ступенью по категориям компонента ───────────
    let counted = false;
    let shownLimit: number | null = null;
    plan.tracks.forEach((track, trackIndex) => {
      track.forEach((step, stepIndex) => {
        const mine = pairs.filter((p) => p.categoryCode != null && step.ingredient.includes(p.categoryCode));
        if (!mine.length) return;
        const ruleKey = keyOf(step, state);

        if (modeOf(step) === 'sum') {
          // Сумму нельзя посчитать по одному компоненту — откладываем до конца.
          const k = posKey(trackIndex, stepIndex);
          const arr = sumMembers.get(k) ?? [];
          arr.push(c);
          sumMembers.set(k, arr);
          if (shownLimit == null) shownLimit = limitOf(ruleKey);
          return;
        }

        const row = rowOf(ruleKey);
        if (!row) return;
        if (row.limitLow == null) {
          warnings.push({
            code: 'RULE_INCOMPLETE', level: 'critical', ruleKey,
            message: 'A generic concentration limit this class rests on carries no number in the rule table — report this result.',
          });
          return;
        }
        const low = row.limitLow;
        if (shownLimit == null) shownLimit = low;

        let passed: boolean;
        if (modeOf(step) === 'band') {
          if (row.limitHigh == null) {
            warnings.push({
              code: 'RULE_INCOMPLETE', level: 'critical', ruleKey,
              message: 'A concentration band this class rests on carries no upper bound in the rule table — report this result.',
            });
            return;
          }
          passed = c.conc >= low && c.conc < row.limitHigh;
        } else {
          passed = c.conc >= low;
        }

        if (passed) {
          counted = true;
          hits.push({
            trackIndex, stepIndex,
            categoryCode: step.result,
            ruleKey,
            source: 'GCL',
            componentId: c.id,
            componentName: c.name,
            conc: c.conc,
            limit: low,
          });
        }
      });
    });

    contributions.push({
      componentId: c.id,
      name: c.name,
      conc: c.conc,
      value: c.conc,
      limit: shownLimit,
      limitSource: 'GCL',
      provenance: c.input.source === 'supplier'
        ? `${pairs.map(pairLabel).join(', ')} — supplier data (entered by you)`
        : `${pairs.map(pairLabel).join(', ')} — Annex VI, generic concentration limit`,
      counted,
    });
    if (pairs.some((p) => p.star)) warnStar(warnings, c);
  }

  /* ── суммарные ступени ──────────────────────────────────────────────────── */

  const sums: SumEval[] = [];
  plan.tracks.forEach((track, trackIndex) => {
    track.forEach((step, stepIndex) => {
      if (modeOf(step) !== 'sum') return;
      const ruleKey = keyOf(step, state);
      const limit = limitOf(ruleKey);
      const mine = sumMembers.get(posKey(trackIndex, stepIndex)) ?? [];

      // ⚠ Релевантность: МЕНЬШИЙ из порога раздела и общей отсечки Table 1.1
      // (design-doc §5.2 «SCL → cut-off Table 1.1 → GCL»). Оба числа — из базы.
      const bounds: number[] = [];
      if (step.relevanceRuleKey) {
        const v = limitOf(step.relevanceRuleKey);
        if (v != null) bounds.push(v);
      }
      if (step.cutoffRuleKey) {
        const v = limitOf(step.cutoffRuleKey);
        if (v != null) bounds.push(v);
      }
      const relevance = bounds.length ? Math.min(...bounds) : null;

      const members = relevance == null ? mine : mine.filter((c) => c.conc >= relevance);
      const below = relevance == null ? [] : mine.filter((c) => c.conc < relevance);
      const sum = members.reduce((s, c) => s + c.conc, 0);
      const passed = limit != null && sum >= limit;

      // Шлюз: свойство смеси, которое решает наравне с суммой.
      let gatePassed: boolean | null = null;
      let gateText: string | null = null;
      let gateMax: number | null = null;
      let gateUnit = '';
      if (step.gate === 'viscosity') {
        const row = rowOf(ruleKey);
        gateMax = row?.value ?? null;
        // ⚠⚠ `value_unit` в базе — ОПИСАНИЕ КОЛОНКИ, а не единица:
        // «mm2/s at 40 °C (kinematic viscosity, ≤)». Вставленное в предложение
        // целиком, оно дало на проде (живая проба s83) неудобочитаемое
        // «its kinematic viscosity not entered (the limit is 20.5 mm2/s at
        // 40 °C (kinematic viscosity, ≤))» — пояснение в скобках повторяло то,
        // что уже сказано словами. Берём только единицу, до первой скобки.
        gateUnit = unitOf(row);
        const have = input.properties.viscosityMm2s40c ?? null;
        if (gateMax == null) {
          warnings.push({
            code: 'RULE_INCOMPLETE', level: 'critical', ruleKey,
            message: 'The viscosity condition this class rests on carries no number in the rule table — report this result.',
          });
        } else if (have == null) {
          gateText = `kinematic viscosity not entered; the rule caps it at ${fmtNum(gateMax)} ${gateUnit}`;
        } else {
          gatePassed = have <= gateMax;
          gateText = `the kinematic viscosity ${fmtNum(have)} ${gateUnit} is ${gatePassed ? 'at or below' : 'above'} the limit of ${fmtNum(gateMax)}`;
        }
      }

      const evaluated: SumEval = {
        trackIndex, stepIndex, step, ruleKey, limit, relevance, sum, members, below,
        candidatesCount: mine.length, passed, gatePassed, gateText,
      };
      sums.push(evaluated);

      if (below.length && relevance != null) {
        warnings.push({
          code: 'BELOW_RELEVANCE', level: 'caution', ruleKey: step.relevanceRuleKey ?? ruleKey,
          message: `${below.map((c) => `${c.name} (${fmtPct(c.conc)} %)`).join(', ')} carr${below.length > 1 ? 'y' : 'ies'} this category below the relevance limit of ${fmtPct(relevance)} % and ${below.length > 1 ? 'were' : 'was'} left out of the sum. CLP allows an ingredient below that limit to be counted where there is reason to suspect it is still relevant.`,
        });
      }

      if (!passed) return;

      if (step.gate == null) {
        hits.push(sumHit(evaluated, null));
        return;
      }
      if (gatePassed === true) {
        hits.push(sumHit(evaluated, gateText));
        return;
      }
      if (gatePassed === null) {
        // ⭐⭐⭐ Данных нет — и это НЕ «не классифицировано». Строка обязана
        // назвать недостающее число и попросить его (решение Сергея s83).
        blockers.push({
          ruleKey,
          // ⚠ Причина строится ЗДЕСЬ, а не из `gateText`: та фраза написана для
          // строки кандидата и внутри предложения повторяла бы саму себя.
          reason: `The ingredients that carry this class add up to ${fmtPct(sum)} %, at or above the limit of ${fmtPct(limit ?? 0)} %. This class also depends on the kinematic viscosity of the mixture, and that has not been entered: the rule classifies only at or below ${gateMax == null ? 'the limit it names' : `${fmtNum(gateMax)} ${gateUnit}`}. Enter it on the mixture properties tab and run the calculation again; until then this class is neither classified nor ruled out.`,
        });
      }
    });
  });

  // Общие пределы, которые проверялись, — в кандидаты (в т.ч. уступившие SCL).
  for (const [trackIndex, track] of plan.tracks.entries()) {
    for (const [stepIndex, step] of track.entries()) {
      const ruleKey = keyOf(step, state);
      const won = hits.some((h) => h.trackIndex === trackIndex && h.stepIndex === stepIndex && h.source === 'GCL');
      const anyCarrier = carriers.some((c) => pairsOf(c, plan.classCode)
        .some((p) => p.categoryCode != null && step.ingredient.includes(p.categoryCode)));
      const replaced = outranked.get(posKey(trackIndex, stepIndex));
      if (!anyCarrier && !replaced) continue;
      const sum = sums.find((s) => s.trackIndex === trackIndex && s.stepIndex === stepIndex);
      let note: string | undefined;
      if (replaced) {
        note = modeOf(step) === 'sum'
          ? `generic limit — checked and outranked for ${replaced.join(', ')} by the specific concentration limit of that ingredient in Annex VI, so it is not part of this sum`
          : `generic limit — checked and outranked for ${replaced.join(', ')} by the specific concentration limit of that ingredient in Annex VI`;
      } else if (sum) {
        note = `sum of the relevant ingredients ${fmtPct(sum.sum)} % against ${sum.limit == null ? 'the limit' : `${fmtPct(sum.limit)} %`}${sum.gateText ? `; ${sum.gateText}` : ''}`;
      }
      candidates.push({ categoryCode: step.result, ruleKey, passed: won, note });
    }
  }

  // Триггеры SDS — это не классификация, а обязанность по Annex II.
  for (const t of plan.sdsTriggers ?? []) {
    const limit = rules.get(t.ruleKey)?.limitLow ?? null;
    if (limit == null) continue;
    const who = carriers.filter((c) => c.conc >= limit
      && pairsOf(c, plan.classCode).some((p) => p.categoryCode != null && t.ingredient.includes(p.categoryCode)));
    if (!who.length) continue;
    supplemental.push({
      kind: 'SDS_TRIGGER',
      code: null,
      text: `A safety data sheet must be available for this mixture on request: ${who.map((c) => `${c.name} at ${fmtPct(c.conc)} %`).join(', ')} — at or above ${fmtPct(limit)} %.`,
      ruleKey: t.ruleKey,
      raw: rules.get(t.ruleKey)?.raw ?? null,
      componentIds: who.map((c) => c.id),
    });
  }

  // ⚠⚠ Порог, который источник называет «appropriate», а не абсолютным.
  if (plan.softLimitRuleKey && sums.some((s) => s.candidatesCount > 0)) {
    warnings.push({
      code: 'LIMIT_NOT_ABSOLUTE', level: 'caution', ruleKey: plan.softLimitRuleKey,
      message: 'CLP calls this concentration limit appropriate rather than absolute: the section quoted below requires expert judgement, warns that respiratory tract irritation may not occur below a certain concentration, and that narcotic effects may occur below the limit. Treat this line as a starting point, not a verdict.',
    });
  }

  // 3.10.3.3.1.3: расслаивающаяся смесь судится ПО СЛОЯМ, а состав слоя нам
  // неизвестен. Молчаливое «not classified» здесь было бы неправдой: слой может
  // концентрировать компонент выше порога.
  if (plan.layersRuleKey && input.properties.separatesIntoLayers && carriers.length
    && !hits.length && !blockers.length) {
    const row = rules.get(plan.layersRuleKey);
    if (row) {
      blockers.push({
        ruleKey: plan.layersRuleKey,
        reason: `This mixture was entered as one that separates into distinct layers, and CLP judges such a mixture layer by layer: the whole mixture is classified when ANY layer reaches the limit. The composition of the individual layers is not known to this tool, so the whole-mixture figure above cannot rule this class out. Classify each layer separately, or say the mixture does not separate.`,
      });
    }
  }

  /* ── слияние: по дорожке — самая строгая сработавшая ступень ────────────── */

  const perTrack = plan.tracks.map((_, trackIndex) => hits
    .filter((h) => h.trackIndex === trackIndex)
    .sort((a, b) => a.stepIndex - b.stepIndex)[0] ?? null);

  const winners = perTrack.filter((h): h is Hit => h != null);

  // ⚠ Категория, которую общая таблица дать не может (подкатегория смеси из
  // собственного предела вещества), встала перед общими ступенями. Если при этом
  // сработала и общая ступень с ДРУГОЙ категорией — движок не вправе решать, что
  // «хуже»: старшинства категорий в законе нет (правило каркаса §2.1).
  for (const [trackIndex, w] of perTrack.entries()) {
    if (!w || w.stepIndex >= 0) continue;
    const other = hits.find((h) => h.trackIndex === trackIndex && h.stepIndex >= 0 && h.categoryCode !== w.categoryCode);
    if (!other) continue;
    warnings.push({
      code: 'CATEGORY_NOT_RANKED', level: 'caution', ruleKey: w.ruleKey,
      message: `Two categories of this class were triggered by different rules: ${w.categoryCode} by the specific concentration limit of ${w.componentName ?? 'an ingredient'}, and ${other.categoryCode} by the generic limit. CLP does not rank a sub-category against the parent category, so this tool reports the specific limit — the rule written for that ingredient. Both carry the same label elements; check both before you print.`,
    });
  }

  // Классифицировали, но часть ответа всё равно под вопросом — говорим об этом.
  if (winners.length) {
    for (const b of blockers) {
      warnings.push({
        code: 'INPUT_INCOMPLETE', level: 'caution', ruleKey: b.ruleKey, message: b.reason,
      });
    }
  }

  // ⚠ Элиситация считается ДО сборки решения: её предупреждения обязаны попасть
  // в ту же строку, а `decide()` копирует массив предупреждений в момент вызова.
  const supp = [
    ...supplemental,
    ...elicitation(plan, carriers, input, ctx, sclCache, winners.length > 0, warnings),
  ];

  if (!winners.length) {
    if (blockers.length) {
      // ⭐⭐⭐ «Данных не хватает» — это ответ со своим правилом и своей причиной,
      // а не пробел: он называет ровно то число, которого не хватает.
      return {
        decision: decide({
          module: 'A4',
          classCode: plan.classCode,
          categoryCode: null,
          status: 'insufficient_data',
          ruleKey: blockers[0]!.ruleKey,
          reason: blockers[0]!.reason,
          contributions,
          candidates,
          warnings,
        }, rules, registry),
        supplemental: supp,
      };
    }

    // Ничего не сработало. Цитируем САМОЕ МЯГКОЕ правило класса: «не достигнут
    // даже самый низкий предел» — это ответ, а не пробел.
    const softest = plan.tracks[0]![plan.tracks[0]!.length - 1]!;
    return {
      decision: decide({
        module: 'A4',
        classCode: plan.classCode,
        categoryCode: null,
        status: 'not_classified',
        ruleKey: keyOf(softest, state),
        reason: notClassifiedReason(carriers, sums),
        contributions,
        candidates,
        warnings,
      }, rules, registry),
      supplemental: supp,
    };
  }

  const main = winners[0]!;
  const extra: AdditionalInput[] = winners.slice(1).map((h) => ({
    categoryCode: h.categoryCode,
    ruleKey: h.ruleKey,
    raw: h.raw ?? null,
    contributions: h.contribs ?? [contributionOf(h)],
    aggregate: h.agg ?? aggregateOf(h),
  }));

  return {
    decision: decide({
      module: 'A4',
      classCode: plan.classCode,
      categoryCode: main.categoryCode,
      status: 'classified',
      ruleKey: main.ruleKey,
      raw: main.raw ?? null,
      contributions,
      candidates,
      warnings,
      aggregate: main.agg ?? aggregateOf(main),
      additional: extra.length ? extra : undefined,
    }, rules, registry),
    supplemental: supp,
  };
}

/* ── элиситация Table 3.4.6 → EUH208 (Annex II 2.8) ──────────────────────── */

/**
 * ⭐⭐ Предел элиситации — НЕ классификация. Смесь, не классифицированная как
 * сенсибилизатор, но содержащая сенсибилизатор в концентрации Table 3.4.6,
 * обязана нести EUH208 «Contains …. May produce an allergic reaction» (Annex II
 * 2.8) — это защита уже сенсибилизированных людей, и потерять её нельзя.
 *
 * ⚠ Note 1 к Table 3.4.6: у вещества со СВОИМ пределом предел элиситации равен
 * ОДНОЙ ДЕСЯТОЙ этого предела. Делитель — из текста ноты, он цитируется в `raw`
 * этой же строки; общий предел при этом не применяется.
 *
 * ⚠ Область действия. Annex II 2.8 говорит о смеси, «не классифицированной как
 * сенсибилизирующая». Мы применяем это ПОКЛАССНО: кожная и респираторная
 * сенсибилизация — разные конечные точки и разные таблицы, и молчать о кожном
 * аллергене потому, что смесь классифицирована как респираторный
 * сенсибилизатор, значило бы потерять предупреждение.
 */
function elicitation(
  plan: ClassPlan,
  carriers: NormalizedComponent[],
  input: NormalizedInput,
  ctx: ModuleContext,
  sclCache: Map<string, SclSplit>,
  classified: boolean,
  warnings: Warning[],
): Supplemental[] {
  if (!plan.elicitation || classified) return [];
  const { rules } = ctx;
  const state = input.physicalState;
  const out: Supplemental[] = [];

  for (const c of carriers) {
    const pairs = pairsOf(c, plan.classCode);
    const step = plan.elicitation.find((e) => pairs
      .some((p) => p.categoryCode != null && e.ingredient.includes(p.categoryCode)));
    if (!step) continue;
    const ruleKey = keyOf(step, state);
    const row = rules.get(ruleKey);
    if (!row || row.limitLow == null) {
      warnings.push({
        code: 'RULE_MISSING', level: 'critical', ruleKey,
        message: 'The elicitation limit that decides whether this mixture needs EUH208 is not in the rule table — report this result.',
      });
      continue;
    }

    let limit = row.limitLow;
    let basis = 'the elicitation limit of Table 3.4.6';
    const scl = (sclCache.get(c.id)?.usable ?? []).find((e) => e.row.limitLow != null);
    if (scl?.row.limitLow != null) {
      limit = scl.row.limitLow / 10;
      basis = `a tenth of the specific concentration limit of this ingredient in Annex VI (Note 1 to Table 3.4.6): ${scl.row.raw}`;
    }
    if (c.conc < limit) continue;

    out.push({
      kind: 'EUH',
      code: 'EUH208',
      text: `Contains ${c.name}. May produce an allergic reaction. — this mixture is not classified as a ${plan.elicitationLabel ?? 'sensitiser'}, but ${c.name} is present at ${fmtPct(c.conc)} %, at or above ${fmtPct(limit)} % — ${basis}. Annex II 2.8 requires this statement on the label, and Note 1 requires a safety data sheet for the mixture.`,
      ruleKey,
      raw: row.raw,
      componentIds: [c.id],
    });
  }
  return out;
}

/* ── сборка строк результата ─────────────────────────────────────────────── */

function notClassifiedReason(carriers: NormalizedComponent[], sums: SumEval[]): string {
  const withSum = sums.filter((s) => s.candidatesCount > 0);
  if (!carriers.length) {
    return 'No ingredient in this mixture carries a harmonised classification in this class.';
  }
  const many = carriers.length > 1;
  const list = carriers.map((c) => `${c.name} ${fmtPct(c.conc)} %`).join(', ');
  if (!withSum.length) {
    return `${carriers.length} ingredient${many ? 's' : ''} carr${many ? 'y' : 'ies'} this class, but none reaches its concentration limit: ${list}.`;
  }
  const parts = [`${carriers.length} ingredient${many ? 's' : ''} carr${many ? 'y' : 'ies'} this class: ${list}.`];
  for (const s of withSum) {
    const head = `The relevant ingredients for category ${s.step.result} add up to ${fmtPct(s.sum)} % against ${s.limit == null ? 'the limit of this rule' : `${fmtPct(s.limit)} %`}`;
    if (s.passed && s.gatePassed === false) {
      parts.push(`${head}, which is reached — but the second condition is not met: ${s.gateText}.`);
    } else {
      parts.push(`${head}.`);
    }
  }
  return parts.join(' ');
}

function sumHit(s: SumEval, gateText: string | null): Hit {
  const expr = `${s.members.map((c) => `${c.name} ${fmtPct(c.conc)} %`).join(' + ')} = ${fmtPct(s.sum)} % >= ${s.limit == null ? '?' : `${fmtPct(s.limit)} %`}${gateText ? `, and ${gateText}` : ''}`;
  return {
    trackIndex: s.trackIndex,
    stepIndex: s.stepIndex,
    categoryCode: s.step.result,
    ruleKey: s.ruleKey,
    source: 'GCL',
    limit: s.limit,
    agg: { expr, value: s.sum, threshold: s.limit, operator: '>=', unit: '%' },
    contribs: s.members.map((c) => ({
      componentId: c.id,
      name: c.name,
      conc: c.conc,
      value: c.conc,
      limit: s.limit,
      limitSource: 'GCL' as const,
      provenance: 'counted in the sum of this class (generic concentration limit, Annex I)',
      counted: true,
    })),
  };
}

function contributionOf(h: Hit): Contribution {
  return {
    componentId: h.componentId ?? '',
    name: h.componentName ?? '',
    conc: h.conc ?? 0,
    value: h.conc ?? 0,
    limit: h.limit,
    limitSource: h.source,
    provenance: h.source === 'SCL'
      ? 'specific concentration limit (Annex VI)'
      : 'generic concentration limit (Annex I)',
    counted: true,
  };
}

function aggregateOf(h: Hit): Aggregate {
  return {
    expr: `${h.componentName ?? 'ingredient'} at ${fmtPct(h.conc ?? 0)} % ${h.limit == null ? '' : `>= ${fmtPct(h.limit)} %`}`.trim(),
    value: h.conc ?? 0,
    threshold: h.limit,
    operator: '>=',
    unit: '%',
  };
}

/**
 * Место категории, которую назвал СВОЙ предел вещества, среди ступеней класса.
 *
 * ⚠ `class_cat` строки SCL — это категория СМЕСИ («STOT SE 1; H370: C ≥ 10 %»
 * значит «смесь с этим веществом от 10 % классифицируется STOT SE 1»), поэтому
 * ступень ищется по `result`, а не по категории компонента.
 *
 * ⚠⚠ Общая таблица иногда не может дать такой категории вовсе: Table 3.4.5
 * присваивает смеси «Category 1», а собственный предел вещества может дать
 * «Skin Sens. 1A» (15 таких строк в Annex VI). Тогда ступени нет, и категория
 * принимается, если она есть В РЕЕСТРЕ, а место — перед всеми общими ступенями:
 * специальный предел старше общего. Придумывать старшинство между «1» и «1A»
 * движок при этом не начинает — он поднимает `CATEGORY_NOT_RANKED`.
 */
function findStep(
  plan: ClassPlan,
  categoryCode: string,
  inRegistry: boolean,
): { trackIndex: number; stepIndex: number } | null {
  for (const [trackIndex, track] of plan.tracks.entries()) {
    for (const [stepIndex, step] of track.entries()) {
      if (step.result === categoryCode) return { trackIndex, stepIndex };
    }
  }
  if (!inRegistry) return null;
  return { trackIndex: 0, stepIndex: -1 };
}

function warnStar(warnings: Warning[], c: NormalizedComponent): void {
  warnings.push({
    code: 'STAR', level: 'caution', componentId: c.id,
    message: `${c.name} carries “*” in Annex VI — a minimum classification. The harmonised entry is a floor; a supplier holding test data may have to classify it stricter (Annex VI 1.2.1).`,
  });
}

/* ── модуль ──────────────────────────────────────────────────────────────── */

export const cutoffModule: ClassifierModule = {
  key: 'A4',
  title: 'Concentration-limit classes',
  classes: A4_CLASSES,
  implemented: true,

  run(input: NormalizedInput, _data: ClassifierData, ctx: ModuleContext): ModuleOutput {
    const { rules, registry } = ctx;
    const decisions: Decision[] = [];
    const supplemental: Supplemental[] = [];

    for (const plan of CUTOFF_PLANS) {
      const out = classDecision(plan, input, ctx);
      decisions.push(out.decision);
      supplemental.push(...out.supplemental);
    }

    // ⚠⚠ EUH208 — ОДНА строка на компонент, а не на класс. Вещество, которое
    // сенсибилизирует и кожу, и дыхательные пути, проходит порог элиситации
    // дважды, и модуль честно считает обе таблицы; но Annex II 2.8 даёт на такой
    // ингредиент ОДНУ фразу «Contains …. May produce an allergic reaction», и
    // две одинаковые строки на этикетке читались бы как дефект. Вторую не
    // выбрасываем молча: её правило дописывается к первой.
    const euhSeen = new Map<string, Supplemental>();
    const merged: Supplemental[] = [];
    for (const s of supplemental) {
      const id = s.code === 'EUH208' && s.componentIds.length === 1 ? s.componentIds[0]! : null;
      if (id == null) { merged.push(s); continue; }
      const first = euhSeen.get(id);
      if (!first) { euhSeen.set(id, s); merged.push(s); continue; }
      first.text += ` The same ingredient also reaches the elicitation limit of the other sensitisation endpoint (${s.ruleKey}); EUH208 is printed once per ingredient.`;
    }

    // ⛔ Отложенные классы печатает САМ модуль, а не каркас: каркас сказал бы
    // «module A4 … is not built yet», что звучит как отговорка. Причина обязана
    // называть конкретное препятствие и того, кто класс несёт.
    const live = input.components.filter((c) => c.conc > 0);
    for (const d of DEFERRED_CLASSES) {
      const who = live.filter((c) => pairsOf(c, d.classCode).length > 0);
      const tail = who.length
        ? ` ${who.length} ingredient${who.length > 1 ? 's' : ''} in this mixture carry it: ${who.map((c) => c.name).join(', ')}.`
        : ' No ingredient in this mixture carries it.';
      decisions.push(decide({
        module: 'A4',
        classCode: d.classCode,
        categoryCode: null,
        status: 'not_computed',
        reason: d.reason + tail,
      }, rules, registry));
    }

    return { decisions, supplemental: merged };
  },
};
