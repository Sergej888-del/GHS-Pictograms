// src/lib/classifier/data.ts
// Снимок данных движка: указатели по `clp_generic_limits` и реестру + сборка
// решения ИЗ ПРАВИЛА. Ни одного обращения к базе — снимок приходит готовым
// (Pages Function собирает его service-ключом, скрипт-проверка — из фикстуры).
//
// ⭐⭐⭐ ЗАЧЕМ ЗДЕСЬ `decide()`, А НЕ ЛИТЕРАЛ `Decision` В КАЖДОМ МОДУЛЕ.
// Контракт design-doc §5.2: у строки со статусом `classified`/`not_classified`
// ОБЯЗАНЫ быть `rule_key` и дословный `raw`. Если каждый модуль собирает объект
// руками, первое же «ну здесь и так понятно» пробивает контракт молча. Поэтому
// решение строится единственной функцией, которая САМА достаёт `raw` из снимка
// и падает в `RULE_MISSING`, когда ключа в таблице нет.
//
// ⛔ Строки для человека — по-английски (урок s68: литералы лежат в бандле).

import type {
  AdditionalCategory, ClassifierData, Decision, DecisionStatus, GenericLimitRow, RegistryEntry,
  Contribution, Aggregate, Candidate, Warning, LabelPair, RuleLookup, RegistryLookup,
} from './types.ts';

/* ── указатель по правилам ───────────────────────────────────────────────── */

export class RuleIndex implements RuleLookup {
  private readonly byKey = new Map<string, GenericLimitRow>();
  private readonly byKind = new Map<string, GenericLimitRow[]>();
  private readonly byClass = new Map<string, GenericLimitRow[]>();

  constructor(rows: ReadonlyArray<GenericLimitRow>) {
    for (const r of rows) {
      // ⚠ Первый выигрывает: дубль `rule_key` — дефект данных, его ловит
      // `check-engine.ts`, а движок обязан остаться детерминированным.
      if (!this.byKey.has(r.ruleKey)) this.byKey.set(r.ruleKey, r);
      push(this.byKind, r.kind, r);
      if (r.classCode) push(this.byClass, r.classCode, r);
    }
  }

  get(ruleKey: string): GenericLimitRow | null { return this.byKey.get(ruleKey) ?? null; }
  has(ruleKey: string): boolean { return this.byKey.has(ruleKey); }
  ofKind(kind: string): GenericLimitRow[] { return this.byKind.get(kind) ?? []; }
  ofClass(classCode: string): GenericLimitRow[] { return this.byClass.get(classCode) ?? []; }
  keys(): string[] { return [...this.byKey.keys()]; }
}

function push<T>(m: Map<string, T[]>, k: string, v: T): void {
  const a = m.get(k);
  if (a) a.push(v); else m.set(k, [v]);
}

/* ── указатель по реестру ────────────────────────────────────────────────── */

export class Registry implements RegistryLookup {
  private readonly byPair = new Map<string, RegistryEntry>();
  private readonly byClass = new Map<string, RegistryEntry[]>();
  private readonly order: string[] = [];

  constructor(entries: ReadonlyArray<RegistryEntry>) {
    for (const e of entries) {
      const k = `${e.classCode}|${e.categoryCode}`;
      // ⚠ Дубли есть в самой базе (SELF_REACTIVE «Type B» дважды) — берём первый.
      if (!this.byPair.has(k)) this.byPair.set(k, e);
      if (!this.byClass.has(e.classCode)) { this.byClass.set(e.classCode, []); this.order.push(e.classCode); }
      const arr = this.byClass.get(e.classCode)!;
      if (!arr.some((x) => x.categoryCode === e.categoryCode)) arr.push(e);
    }
    // Порядок классов — `hazard_class_catalog.display_order`, как на страницах сайта.
    this.order.sort((a, b) => (this.byClass.get(a)![0]!.displayOrder) - (this.byClass.get(b)![0]!.displayOrder));
  }

  classes(): string[] { return [...this.order]; }
  hasClass(classCode: string): boolean { return this.byClass.has(classCode); }
  categories(classCode: string): RegistryEntry[] { return this.byClass.get(classCode) ?? []; }
  entry(classCode: string, categoryCode: string | null): RegistryEntry | null {
    if (categoryCode == null) return null;
    return this.byPair.get(`${classCode}|${categoryCode}`) ?? null;
  }
  className(classCode: string): string {
    return this.byClass.get(classCode)?.[0]?.className ?? classCode;
  }
  displayOrder(classCode: string): number {
    return this.byClass.get(classCode)?.[0]?.displayOrder ?? 9999;
  }
}

/* ── сборка решения ──────────────────────────────────────────────────────── */

export interface DecideInput {
  module: string;
  classCode: string;
  categoryCode: string | null;
  status: DecisionStatus;
  /** Ключ правила. Обязателен у `classified`/`not_classified`. */
  ruleKey?: string | null;
  /** Причина. Обязательна у `insufficient_data`/`not_computed`. */
  reason?: string | null;
  contributions?: Contribution[];
  aggregate?: Aggregate | null;
  candidates?: Candidate[];
  warnings?: Warning[];
  provisional?: boolean;
  /**
   * Дословный текст, когда правило живёт НЕ в `clp_generic_limits`
   * (SCL строки Annex VI, гармонизированный ATE) — тогда `ruleKey` вида
   * `SCL:<index>:<seq>` и `raw` приходит с компонента.
   */
  raw?: string | null;
  sourceRef?: string | null;
  marker?: string | null;
  /**
   * Категории того же класса, сосуществующие с основной (Lact., «3 narcotic»).
   * Каждая проходит тот же разбор правила, что и основная строка.
   */
  additional?: AdditionalInput[];
}

/** Вход сопутствующей категории — тот же контракт провенанса, что у основной. */
export interface AdditionalInput {
  categoryCode: string;
  ruleKey?: string | null;
  raw?: string | null;
  sourceRef?: string | null;
  marker?: string | null;
  contributions?: Contribution[];
  aggregate?: Aggregate | null;
  warnings?: Warning[];
}

/** Текст правила из снимка + предупреждения разбора. Общий для основной и сопутствующих строк. */
function resolveRule(
  p: { ruleKey?: string | null; raw?: string | null; sourceRef?: string | null; marker?: string | null },
  rules: RuleLookup,
): { raw: string | null; sourceRef: string | null; marker: string | null; warnings: Warning[] } {
  const warnings: Warning[] = [];
  let raw = p.raw ?? null;
  let sourceRef = p.sourceRef ?? null;
  let marker = p.marker ?? null;

  if (p.ruleKey && raw == null) {
    const row = rules.get(p.ruleKey);
    if (row) {
      raw = row.raw;
      sourceRef = row.sourceRef;
      marker = row.marker;
      if (row.needsReview) {
        warnings.push({
          code: 'LIMIT_NEEDS_REVIEW', level: 'caution', ruleKey: p.ruleKey,
          message: 'The limit behind this line is flagged for review in our database — the wording of the source is ambiguous.',
        });
      }
    } else {
      warnings.push({
        code: 'RULE_MISSING', level: 'critical', ruleKey: p.ruleKey,
        message: 'The rule this line rests on is not in the rule table — report this result.',
      });
    }
  }
  return { raw, sourceRef, marker, warnings };
}

/**
 * Единственный конструктор `Decision`. Достаёт `raw`/`source_ref`/`marker` из
 * снимка по `ruleKey`; если ключа в таблице нет и текст не передан явно —
 * строка получает предупреждение `RULE_MISSING`, а не тихо остаётся без цитаты.
 */
export function decide(p: DecideInput, rules: RuleLookup, registry: RegistryLookup): Decision {
  const main = resolveRule(p, rules);
  const warnings = [...(p.warnings ?? []), ...main.warnings];
  const raw = main.raw;
  const sourceRef = main.sourceRef;
  const marker = main.marker;

  const entry = registry.entry(p.classCode, p.categoryCode);
  const needsRule = p.status === 'classified' || p.status === 'not_classified';
  if (needsRule && !p.ruleKey) {
    warnings.push({
      code: 'RULE_MISSING', level: 'critical',
      message: 'This line was produced without a rule reference — report this result.',
    });
  }
  if ((p.status === 'insufficient_data' || p.status === 'not_computed') && !p.reason) {
    warnings.push({
      code: 'REASON_MISSING', level: 'critical',
      message: 'This line was produced without a reason — report this result.',
    });
  }
  if (p.status === 'classified' && p.categoryCode != null && !entry) {
    warnings.push({
      code: 'REGISTRY_GAP', level: 'critical',
      message: `Category ${p.categoryCode} is not in our registry for this class — report this result.`,
    });
  }

  // ── сопутствующие категории того же класса ───────────────────────────────
  // ⚠ Проверяются ровно так же, как основная строка: правило, дословный текст,
  // наличие пары в реестре. Плюс одно правило сверх: сопутствующая не может
  // повторять основную категорию — это была бы вторая строка об одном и том же.
  let additional: AdditionalCategory[] | undefined;
  if (p.additional?.length) {
    additional = [];
    const seen = new Set<string>(p.categoryCode != null ? [p.categoryCode] : []);
    for (const a of p.additional) {
      const r = resolveRule(a, rules);
      const aWarn = [...(a.warnings ?? []), ...r.warnings];
      if (!a.ruleKey) {
        aWarn.push({
          code: 'RULE_MISSING', level: 'critical',
          message: 'An additional category was produced without a rule reference — report this result.',
        });
      }
      const aEntry = registry.entry(p.classCode, a.categoryCode);
      if (!aEntry) {
        aWarn.push({
          code: 'REGISTRY_GAP', level: 'critical',
          message: `Category ${a.categoryCode} is not in our registry for this class — report this result.`,
        });
      }
      if (seen.has(a.categoryCode)) {
        aWarn.push({
          code: 'ADDITIONAL_DUPLICATE', level: 'critical',
          message: `Category ${a.categoryCode} is already the category of this line — report this result.`,
        });
      }
      seen.add(a.categoryCode);
      additional.push({
        categoryCode: a.categoryCode,
        hCode: aEntry?.hCode ?? null,
        pictogramCode: aEntry?.pictogramCode ?? null,
        signalWord: aEntry?.signalWord ?? null,
        ruleKey: a.ruleKey ?? null,
        raw: r.raw,
        sourceRef: r.sourceRef,
        marker: r.marker,
        contributions: a.contributions ?? [],
        aggregate: a.aggregate ?? null,
        warnings: aWarn,
      });
    }
  }

  return {
    classCode: p.classCode,
    categoryCode: p.categoryCode,
    status: p.status,
    hCode: entry?.hCode ?? null,
    pictogramCode: entry?.pictogramCode ?? null,
    signalWord: entry?.signalWord ?? null,
    ruleKey: p.ruleKey ?? null,
    raw,
    sourceRef,
    marker,
    reason: p.reason ?? null,
    contributions: p.contributions ?? [],
    aggregate: p.aggregate ?? null,
    candidates: p.candidates,
    additional,
    warnings,
    module: p.module,
    provisional: p.provisional,
  };
}

/**
 * Пары для конвейера этикетки — только из классифицированных строк.
 * ⚠ Сопутствующие категории (Lact., «3 narcotic») едут ЗДЕСЬ ЖЕ: они не
 * украшение строки, а самостоятельная классификация со своим H-кодом, и на
 * этикетке им место наравне с основной (решение Сергея s82).
 */
export function labelPairs(decisions: ReadonlyArray<Decision>): LabelPair[] {
  const out: LabelPair[] = [];
  for (const d of decisions) {
    if (d.status !== 'classified' || d.categoryCode == null) continue;
    out.push({
      classCode: d.classCode,
      categoryCode: d.categoryCode,
      hCode: d.hCode,
      pictogramCode: d.pictogramCode,
      signalWord: d.signalWord,
    });
    for (const a of d.additional ?? []) {
      out.push({
        classCode: d.classCode,
        categoryCode: a.categoryCode,
        hCode: a.hCode,
        pictogramCode: a.pictogramCode,
        signalWord: a.signalWord,
      });
    }
  }
  return out;
}

/** Снимок из «сырых» строк RPC (camelCase уже сделан на стороне SQL). */
export function makeData(
  generic: GenericLimitRow[],
  registry: RegistryEntry[],
  release: ClassifierData['release'],
): ClassifierData {
  return { generic, registry, release };
}
