// src/lib/classifier/modules/cutoff.ts
// Модуль A4 — классы «по отсечке» (design-doc §5.4, шаг 6 §9). Session 82.
//
// ⭐⭐⭐ ЗАХОД ПЕРВЫЙ: ВОСЕМЬ КЛАССОВ, А НЕ ТРИНАДЦАТЬ (решение Сергея s82).
// Считаются те классы, где правило — один порог на один компонент: CMR
// (Carc./Muta./Repr.), ED HH, ED ENV, PBT/vPvB, PMT/vPvM, озон. Остальные пять
// (сенсибилизация, STOT SE, STOT RE, аспирация) остаются за этим же модулем,
// но выдают `not_computed` С ПРИЧИНОЙ, называющей, чего именно не хватает: у
// каждого из них своя ловушка (газ против твёрдого, сумма ≥ 20 %, вязкость), и
// правило сессии — не писать вторую половину, не посмотрев на первую живьём.
//
// ⭐⭐⭐ ПОРОГ НЕ СРАВНИВАЕТСЯ С СУММОЙ. Table 3.5.2 / 3.6.2 / 3.7.2 / 3.11.2 /
// 4.2.2 / 5.1 и разделы 4.3.3.1 / 4.4.3.1 говорят «at least one ingredient …
// present at or above the … concentration limit»: это предел НА КОМПОНЕНТ, а не
// сумма по составу. Суммирование в CLP появляется у STOT SE 3 (Σ ≥ 20 %),
// аспирации (Σ Cat 1 ≥ 10 %) и водной среды — то есть в следующих заходах.
// Складывать здесь два канцерогена по 0,06 % было бы не «строже», а неверно.
//
// ⭐⭐⭐ SCL СТАРШЕ ОБЩЕГО ПРЕДЕЛА, И КОМПОНЕНТ СО СВОИМ SCL В ОБЩИЙ ПУТЬ НЕ
// ВХОДИТ (`classifier-scaffold-s80.md` §5). Специальный предел Annex VI не
// «уточняет» общий, он его ЗАМЕНЯЕТ для этого вещества. Если бы компонент со
// своим SCL заодно проверялся по Table 3.6.2, вещество с SCL «C ≥ 0,1 %»
// классифицировало бы смесь уже при 0,01 % — по общему порогу, который для него
// не действует. Общий предел при этом не прячется: он уходит в `candidates`
// с пометкой «checked and outranked» — это провенанс, а не украшение.
//
// ⛔ Строки для человека — по-английски (урок s68: литералы лежат в бандле).

import { tokenizeClassCat } from '../annex6Abbrev.ts';
import { decide, type AdditionalInput } from '../data.ts';
import type {
  ClassCat, ClassifierData, ClassifierModule, Candidate, Contribution, Decision,
  ModuleContext, ModuleOutput, NormalizedComponent, NormalizedInput, SclRow,
  Supplemental, Warning,
} from '../types.ts';

/* ── план класса ─────────────────────────────────────────────────────────── */

/** Одна ступень: правило Annex I, категории КОМПОНЕНТА, категория СМЕСИ. */
interface Step {
  /** `clp_generic_limits.rule_key`; порог берётся из этой же строки, не отсюда. */
  ruleKey: string;
  /** Категории компонента на языке реестра, которые считает эта ступень. */
  ingredient: string[];
  /** Категория смеси на языке реестра. */
  result: string;
}

/**
 * Дорожка — ступени ОДНОГО ряда строгости, от строгой к мягкой. Внутри дорожки
 * выигрывает первая сработавшая; дорожек больше одной там, где категории класса
 * не сравниваются как степени, а сосуществуют (см. `AdditionalCategory`).
 */
type Track = Step[];

interface ClassPlan {
  classCode: string;
  tracks: Track[];
  /** Пороги «SDS по запросу» из примечаний к таблицам — идут в `supplemental`. */
  sdsTriggers?: { ruleKey: string; ingredient: string[] }[];
}

/**
 * ⚠ Ключи правил и категории — из живой базы (замер s82). Ни одного числа:
 * порог читается из `clp_generic_limits.limit_low` той строки, чей ключ здесь
 * назван. Разойдётся база с этим файлом — покраснеет `RULE_MISSING`, а не
 * тихо посчитается по устаревшему порогу.
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
];

/**
 * Классы A4, до которых этот заход не дошёл. ⛔ Текст причины уезжает в браузер
 * и обязан говорить, ЧЕГО не хватает, — «not computed» без причины читается как
 * «неопасно» (урок s76).
 */
export const DEFERRED_CLASSES: { classCode: string; reason: string }[] = [
  {
    classCode: 'SKIN_SENS',
    reason: 'Not computed in this version — skin sensitisation needs Table 3.4.5 together with the elicitation limits of Table 3.4.6, which also decide whether the mixture carries EUH208. Module A4 covers it in the next release.',
  },
  {
    classCode: 'RESP_SENS',
    reason: 'Not computed in this version — respiratory sensitisation has two different limits in Table 3.4.5 depending on whether the mixture is a gas or a solid/liquid, and the elicitation limits of Table 3.4.6 on top. Module A4 covers it in the next release.',
  },
  {
    classCode: 'STOT_SE',
    reason: 'Not computed in this version — Table 3.8.3 is a cut-off for Categories 1 and 2, but Category 3 is a summation across ingredients (3.8.3.4.5), and the registry keeps respiratory irritation and narcotic effects as separate categories. Module A4 covers it in the next release.',
  },
  {
    classCode: 'STOT_RE',
    reason: 'Not computed in this version — Table 3.9.4 needs the same band arithmetic as Table 3.8.3 (Category 1 ingredient between 1 % and 10 % makes the mixture Category 2). Module A4 covers it in the next release.',
  },
  {
    classCode: 'ASPIRATION',
    reason: 'Not computed in this version — 3.10.3.3.1.2 needs both the sum of Category 1 ingredients and the kinematic viscosity of the mixture at 40 °C, and a mixture that separates into layers is judged layer by layer (3.10.3.3.1.3). Module A4 covers it in the next release.',
  },
];

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
function sclFor(c: NormalizedComponent, classCode: string): {
  usable: SclEntry[];
  unusable: { row: SclRow; why: string }[];
} {
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

/** Человеческое имя категории компонента для строки провенанса. */
function pairLabel(p: ClassCat): string {
  return p.raw && p.raw.trim() ? p.raw.trim() : `${p.classCode} ${p.categoryCode ?? ''}`.trim();
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
  componentId: string;
  componentName: string;
  conc: number;
  limit: number | null;
}

function classDecision(
  plan: ClassPlan,
  input: NormalizedInput,
  ctx: ModuleContext,
): { decision: Decision; supplemental: Supplemental[] } {
  const { rules, registry } = ctx;
  const live = input.components.filter((c) => c.conc > 0);
  const carriers = live.filter((c) => pairsOf(c, plan.classCode).length > 0);

  const contributions: Contribution[] = [];
  const candidates: Candidate[] = [];
  const warnings: Warning[] = [];
  const hits: Hit[] = [];
  const supplemental: Supplemental[] = [];
  /** `rule_key` общего предела → компоненты, для которых его заменил SCL. */
  const outranked = new Map<string, string[]>();

  // ⚠ Порог берётся из снимка, а не из этого файла (design-doc §5.4).
  const limitOf = (ruleKey: string): number | null => {
    const row = rules.get(ruleKey);
    if (!row) {
      warnings.push({
        code: 'RULE_MISSING', level: 'critical', ruleKey,
        message: 'A generic concentration limit this class rests on is not in the rule table — report this result.',
      });
      return null;
    }
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
    const { usable, unusable } = sclFor(c, plan.classCode);

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
      for (const track of plan.tracks) {
        for (const step of track) {
          if (!pairs.some((p) => p.categoryCode != null && step.ingredient.includes(p.categoryCode))) continue;
          const names = outranked.get(step.ruleKey) ?? [];
          names.push(c.name);
          outranked.set(step.ruleKey, names);
        }
      }

      let matched = false;
      for (const e of usable) {
        const band = inBand(c.conc, e.row);
        const place = findStep(plan, e.categoryCode);
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
        const limit = limitOf(step.ruleKey);
        if (shownLimit == null) shownLimit = limit;
        if (limit == null) return;
        const passed = c.conc >= limit;
        if (passed) {
          counted = true;
          hits.push({
            trackIndex, stepIndex,
            categoryCode: step.result,
            ruleKey: step.ruleKey,
            source: 'GCL',
            componentId: c.id,
            componentName: c.name,
            conc: c.conc,
            limit,
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

  // Общие пределы, которые проверялись, — в кандидаты (в т.ч. уступившие SCL).
  for (const [trackIndex, track] of plan.tracks.entries()) {
    for (const [stepIndex, step] of track.entries()) {
      const won = hits.some((h) => h.trackIndex === trackIndex && h.stepIndex === stepIndex && h.source === 'GCL');
      const anyCarrier = carriers.some((c) => pairsOf(c, plan.classCode)
        .some((p) => p.categoryCode != null && step.ingredient.includes(p.categoryCode)));
      const replaced = outranked.get(step.ruleKey);
      if (!anyCarrier && !replaced) continue;
      candidates.push({
        categoryCode: step.result,
        ruleKey: step.ruleKey,
        passed: won,
        note: replaced
          ? `generic limit — checked and outranked for ${replaced.join(', ')} by the specific concentration limit of that ingredient in Annex VI`
          : undefined,
      });
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

  // ── слияние: по дорожке — самая строгая сработавшая ступень ─────────────
  const perTrack = plan.tracks.map((_, trackIndex) => hits
    .filter((h) => h.trackIndex === trackIndex)
    .sort((a, b) => a.stepIndex - b.stepIndex)[0] ?? null);

  const winners = perTrack.filter((h): h is Hit => h != null);

  if (!winners.length) {
    // Ничего не сработало. Цитируем САМОЕ МЯГКОЕ правило класса: «не достигнут
    // даже самый низкий предел» — это ответ, а не пробел.
    const softest = plan.tracks[0]![plan.tracks[0]!.length - 1]!;
    const reason = carriers.length
      ? `${carriers.length} ingredient${carriers.length > 1 ? 's' : ''} carry this class, but none reaches its concentration limit: ${carriers.map((c) => `${c.name} ${fmtPct(c.conc)} %`).join(', ')}.`
      : 'No ingredient in this mixture carries a harmonised classification in this class.';
    return {
      decision: decide({
        module: 'A4',
        classCode: plan.classCode,
        categoryCode: null,
        status: 'not_classified',
        ruleKey: softest.ruleKey,
        reason,
        contributions,
        candidates,
        warnings,
      }, rules, registry),
      supplemental,
    };
  }

  const main = winners[0]!;
  const extra: AdditionalInput[] = winners.slice(1).map((h) => ({
    categoryCode: h.categoryCode,
    ruleKey: h.ruleKey,
    raw: h.raw ?? null,
    contributions: [contributionOf(h)],
    aggregate: aggregateOf(h),
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
      aggregate: aggregateOf(main),
      additional: extra.length ? extra : undefined,
    }, rules, registry),
    supplemental,
  };
}

function contributionOf(h: Hit): Contribution {
  return {
    componentId: h.componentId,
    name: h.componentName,
    conc: h.conc,
    value: h.conc,
    limit: h.limit,
    limitSource: h.source,
    provenance: h.source === 'SCL'
      ? 'specific concentration limit (Annex VI)'
      : 'generic concentration limit (Annex I)',
    counted: true,
  };
}

function aggregateOf(h: Hit): { expr: string; value: number; threshold: number | null; operator: string; unit: string } {
  return {
    expr: `${h.componentName} at ${fmtPct(h.conc)} % ${h.limit == null ? '' : `>= ${fmtPct(h.limit)} %`}`.trim(),
    value: h.conc,
    threshold: h.limit,
    operator: '>=',
    unit: '%',
  };
}

function findStep(plan: ClassPlan, categoryCode: string): { trackIndex: number; stepIndex: number } | null {
  for (const [trackIndex, track] of plan.tracks.entries()) {
    for (const [stepIndex, step] of track.entries()) {
      if (step.result === categoryCode) return { trackIndex, stepIndex };
    }
  }
  return null;
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
  title: 'Cut-off classes',
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

    // ⛔ Отложенные классы печатает САМ модуль, а не каркас: каркас сказал бы
    // «module A4 … is not built yet», что теперь неправда и звучит как отговорка.
    // Причина обязана называть конкретное препятствие и того, кто класс несёт.
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

    return { decisions, supplemental };
  },
};
