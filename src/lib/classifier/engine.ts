// src/lib/classifier/engine.ts
// Каркас движка (design-doc §5.1): нормализация входа → прогон модулей →
// слияние по классам → строки `not_computed` для классов без модуля.
//
// ⭐⭐⭐ ОДИН КЛАСС — ОДИН МОДУЛЬ. Движок НЕ примиряет две категории одного
// класса от разных модулей: «худшая из двух» требовала бы таблицы старшинства
// категорий на все 121 строку реестра, а она нигде не записана в законе (что
// хуже — Skin Corr. «1» или «1A»? это не про строгость, а про точность).
// Поэтому пересечение классов между модулями — ДЕФЕКТ КАРКАСА: первая строка
// остаётся, вторая уходит в предупреждение `MODULE_CONFLICT`, а статическая
// проверка `check-engine.ts` не даёт такому доехать до прода.
//
// ⛔ Строки для человека — по-английски (урок s68).

import { RuleIndex, Registry, decide, labelPairs } from './data.ts';
import { A0_PARSER_VERSION, ENGINE_VERSION } from './version.ts';
import type {
  Audience, ClassifierData, ClassifierModule, ClassifierResult, CompositionSummary,
  DataRelease, Decision, InhalForm, MixtureInput, ModuleContext, NormalizedComponent,
  NormalizedInput, PhysicalState, RegistryLookup, ReportInput, RuleLookup, Supplemental,
  Warning,
} from './types.ts';

/**
 * Версия движка — печатается в ответе и в PDF (design-doc §3.3).
 * ⚠ Объявлена в `version.ts` вместе с версией парсера A0: три копии одной
 * строки (движок, парсер, база) разошлись молча — см. №110 и комментарий там.
 */
export { ENGINE_VERSION };

/** Форма ингаляции по умолчанию — из агрегатного состояния смеси. */
export function defaultInhalForm(state: PhysicalState): InhalForm {
  return state === 'gas' ? 'gas' : state === 'solid' ? 'dust_mist' : 'vapour';
}

/* ── нормализация ────────────────────────────────────────────────────────── */

/**
 * Эффективная концентрация: при диапазоне «min – max» считаем ПО ВЕРХУ
 * (решение Сергея s77 §10.3). Иного метода из состава нет; пользователь видит
 * флаг `WORST_CASE`, а не молчаливый выбор.
 */
export function normalize(input: MixtureInput): NormalizedInput {
  const physicalState = input.properties.physicalState;
  const inhalForm = input.properties.inhalForm ?? defaultInhalForm(physicalState);
  const audience: Audience = input.audience ?? 'professional';

  const components: NormalizedComponent[] = input.components.map((c, i) => {
    const min = Number.isFinite(c.conc) ? c.conc : 0;
    const max = c.concMax != null && Number.isFinite(c.concMax) ? c.concMax : null;
    const worstCase = max != null && max > min;
    const hCodes = c.hCodes && c.hCodes.length
      ? [...c.hCodes]
      : c.classifications.map((p) => p.hCode).filter((h): h is string => !!h);
    return {
      input: c,
      id: c.id || `c${i + 1}`,
      name: c.name,
      conc: worstCase ? (max as number) : min,
      concMin: min,
      concMax: max,
      worstCase,
      classifications: c.classifications,
      hCodes,
    };
  });

  const sumConc = components.reduce((s, c) => s + (c.conc > 0 ? c.conc : 0), 0);
  const composition: CompositionSummary = {
    componentCount: components.length,
    sumConc,
    remainder: 100 - sumConc,
    remainderStatedNonhazard: !!input.remainderStatedNonhazard,
    worstCase: components.some((c) => c.worstCase),
  };

  return { components, properties: input.properties, physicalState, inhalForm, audience, composition };
}

/* ── прогон ──────────────────────────────────────────────────────────────── */

function compositionWarnings(n: NormalizedInput): Warning[] {
  const w: Warning[] = [];
  const { sumConc, remainder } = n.composition;
  if (sumConc > 100.0001) {
    w.push({
      code: 'SUM_OVER_100', level: 'critical',
      message: `The entered ingredients add up to ${sumConc.toFixed(1)} %. Check the composition — every threshold below is compared against these numbers as they are.`,
    });
  } else if (remainder > 0.0001) {
    w.push({
      code: 'REMAINDER', level: n.composition.remainderStatedNonhazard ? 'info' : 'caution',
      message: n.composition.remainderStatedNonhazard
        ? `${remainder.toFixed(1)} % of the mixture is the remainder you stated as non-hazardous. It is shown, not silently ignored.`
        : `${remainder.toFixed(1)} % of the mixture is unaccounted for. It is treated as an unclassified remainder — state it as non-hazardous or add the missing ingredients.`,
    });
  }
  if (n.composition.worstCase) {
    w.push({
      code: 'WORST_CASE', level: 'caution',
      message: 'At least one ingredient was entered as a range. The upper bound is used — this is the worst case, and it is the only method available from the composition alone.',
    });
  }
  return w;
}

/**
 * ⭐⭐⭐ ШТАМП ВЕРСИИ НЕ ВЫБИРАЕТ МЕЖДУ ДВУМЯ ОТВЕТАМИ (№110, s84). Строка версии
 * лежит и в коде, и в строке релиза базы. Если они разошлись, отчёт обязан
 * напечатать ОБЕ и сказать об этом: молчаливый выбор одной из них — это и есть
 * тот дефект, ради которого №110 заведена (в базе стоял `a0-parser 1.0`, в коде
 * `1.1`, и заметить это было нечем).
 *
 * ⚠ Уровень `caution`, не `critical`: расчёт от расхождения штампов не портится,
 * а вот аудиторский след — да.
 */
function stampWarnings(release: DataRelease | null): Warning[] {
  if (!release) {
    return [{
      code: 'DATA_STAMP_MISSING', level: 'caution',
      message: 'This result carries no data-release stamp, so the report cannot say which copy of the regulation produced it. Treat it as a draft, not as an audit record.',
    }];
  }
  const out: Warning[] = [];
  if (release.engineVersion && release.engineVersion !== ENGINE_VERSION) {
    out.push({
      code: 'ENGINE_STAMP_DRIFT', level: 'caution',
      message: `The data release names engine “${release.engineVersion}”, and this result was computed by “${ENGINE_VERSION}”. Both are printed in the report; neither is silently preferred.`,
    });
  }
  if (release.parserVersion && release.parserVersion !== A0_PARSER_VERSION) {
    out.push({
      code: 'PARSER_STAMP_DRIFT', level: 'caution',
      message: `The harmonised classifications in the database are stamped “${release.parserVersion}”, while this engine reads them with “${A0_PARSER_VERSION}”. Both are printed in the report.`,
    });
  }
  return out;
}

/**
 * `not_computed` для каждого класса реестра, за который в этой версии никто не
 * отвечает. ⛔ Пустая строка запрещена (урок s76: пустая ячейка читается как
 * «неопасно»), поэтому у каждой такой строки есть причина И подсказка, кто из
 * компонентов этот класс несёт.
 */
function notComputed(
  n: NormalizedInput,
  registry: RegistryLookup,
  rules: RuleLookup,
  owners: Map<string, ClassifierModule>,
  covered: Set<string>,
): Decision[] {
  const out: Decision[] = [];
  for (const classCode of registry.classes()) {
    if (covered.has(classCode)) continue;
    const owner = owners.get(classCode) ?? null;
    const carriers = n.components.filter(
      (c) => c.conc > 0 && c.classifications.some((p) => p.classCode === classCode),
    );
    // ⚠ Согласование в числе: на проде печаталось «1 ingredient in this mixture
    // CARRY it» (найдено чтением отчёта в s84). Мелочь ровно до того момента,
    // пока строку не читает инспектор — а именно ему отчёт и адресован.
    const who = carriers.length
      ? ` ${carriers.length} ingredient${carriers.length > 1 ? 's' : ''} in this mixture carr${carriers.length > 1 ? 'y' : 'ies'} it: ${carriers.map((c) => c.name).join(', ')}.`
      : ' No ingredient in this mixture carries it.';
    out.push(decide({
      module: owner ? owner.key : '—',
      classCode,
      categoryCode: null,
      status: 'not_computed',
      reason: (owner
        ? `Not computed in this version — module ${owner.key} (${owner.title}) covers this class and is not built yet.`
        : 'Not computed in this version — no module covers this class yet.') + who,
      // ⭐⭐ Носители класса — ВКЛАДАМИ, а не только фразой в причине (s84).
      // Отчёт решает по ним, печатать ли класс полной карточкой: класс, который
      // в этой смеси несёт хоть кто-то, — настоящий пробел, а класс, которого
      // не несёт никто, — общая оговорка, и ей хватает одной строки. Разбирать
      // ради этого текст причины было бы гаданием по собственной прозе.
      contributions: carriers.map((c) => ({
        componentId: c.id,
        name: c.name,
        conc: c.conc,
        value: null,
        limit: null,
        limitSource: 'NONE' as const,
        provenance: `carries ${c.classifications.filter((p) => p.classCode === classCode).map((p) => p.raw || `${p.classCode} ${p.categoryCode ?? ''}`.trim()).join(', ')} — not evaluated in this version`,
        counted: false,
      })),
    }, rules, registry));
  }
  return out;
}

export interface ClassifyOptions {
  modules?: ClassifierModule[];
  /**
   * Метка времени расчёта для отчёта (ISO-8601). ⚠ Приходит СНАРУЖИ: движок
   * времени не знает нарочно — иначе один и тот же состав давал бы разные
   * ответы и кэш по составу лгал бы (design-doc §3, кэш по `data_version`).
   */
  computedAt?: string | null;
}

/**
 * Эхо входа для отчёта. ⭐⭐⭐ Решение Сергея (s80): PDF и share-ссылка несут
 * ПОЛНЫЙ аудиторский отчёт, а печатается он без единого обращения к базе —
 * значит всё, что в нём будет, обязано лежать здесь.
 */
function reportInput(n: NormalizedInput): ReportInput {
  return {
    components: n.components.map((c) => ({
      id: c.id,
      name: c.name,
      source: c.input.source,
      indexNumber: c.input.indexNumber ?? null,
      casPrimary: c.input.casPrimary ?? null,
      ecPrimary: c.input.ecPrimary ?? null,
      concEntered: { min: c.concMin, max: c.concMax },
      concUsed: c.conc,
      worstCase: c.worstCase,
      classifications: c.classifications,
      scl: c.input.scl ?? [],
      mFactors: c.input.mFactors ?? [],
      ate: c.input.ate ?? [],
      knownNonhazard: !!c.input.knownNonhazard,
      notes: c.input.notes ?? [],
    })),
    properties: n.properties,
    audience: n.audience,
    remainderStatedNonhazard: n.composition.remainderStatedNonhazard,
  };
}

export function classifyMixture(
  input: MixtureInput,
  data: ClassifierData,
  options: ClassifyOptions = {},
): ClassifierResult {
  const modules = options.modules ?? DEFAULT_MODULES;
  const n = normalize(input);
  const rules = new RuleIndex(data.generic);
  const registry = new Registry(data.registry);
  const ctx: ModuleContext = { rules, registry };

  // Кто за какой класс отвечает — включая ненаписанные модули: их классы
  // получают честное «module A3 covers this class and is not built yet».
  const owners = new Map<string, ClassifierModule>();
  const overlaps: string[] = [];
  for (const m of modules) {
    for (const cls of m.classes) {
      if (owners.has(cls)) overlaps.push(`${cls} (${owners.get(cls)!.key} / ${m.key})`);
      else owners.set(cls, m);
    }
  }

  const warnings: Warning[] = [...compositionWarnings(n), ...stampWarnings(data.release)];
  if (overlaps.length) {
    warnings.push({
      code: 'MODULE_OVERLAP', level: 'critical',
      message: `Two modules claim the same hazard class: ${overlaps.join(', ')} — report this result.`,
    });
  }

  const supplemental: Supplemental[] = [];
  const byClass = new Map<string, Decision>();
  const computed: Decision[] = [];

  for (const m of modules) {
    if (!m.implemented) continue;
    const out = m.run(n, data, ctx);
    for (const d of out.decisions) {
      const prev = byClass.get(d.classCode);
      if (prev) {
        // Пересечение доехало до выдачи — оставляем первую строку и говорим об этом.
        prev.warnings.push({
          code: 'MODULE_CONFLICT', level: 'critical',
          message: `Module ${d.module} produced a second line for this class (${d.categoryCode ?? d.status}); the line from module ${prev.module} is shown. Report this result.`,
        });
        continue;
      }
      byClass.set(d.classCode, d);
      computed.push(d);
    }
    if (out.supplemental) supplemental.push(...out.supplemental);
    if (out.warnings) warnings.push(...out.warnings);
  }

  const covered = new Set(byClass.keys());
  const pending = notComputed(n, registry, rules, owners, covered);

  const order = (d: Decision) => registry.displayOrder(d.classCode);
  computed.sort((a, b) => order(a) - order(b));
  pending.sort((a, b) => order(a) - order(b));

  const decisions = [...computed, ...pending];

  return {
    engineVersion: ENGINE_VERSION,
    release: data.release,
    computedAt: options.computedAt ?? null,
    input: reportInput(n),
    audience: n.audience,
    physicalState: n.physicalState,
    inhalForm: n.inhalForm,
    composition: n.composition,
    decisions,
    supplemental,
    warnings,
    labelPairs: labelPairs(decisions),
    modules: modules.map((m) => ({ key: m.key, title: m.title, implemented: m.implemented, classes: m.classes })),
  };
}

// ⚠ Импорт реестра модулей идёт ПОСЛЕ объявлений: `modules/index.ts` тянет
// типы отсюда, и циклическая ссылка на значение развалила бы порядок
// инициализации. Здесь используется только внутри функции — это безопасно.
import { DEFAULT_MODULES } from './modules/index.ts';
