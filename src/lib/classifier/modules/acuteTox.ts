// src/lib/classifier/modules/acuteTox.ts
// Модуль A1 — острая токсичность. Обёртка над `src/lib/ate.ts` (аудит №100,
// session 79): движок расчёта НЕ дублируется, здесь только перевод входа
// классификатора в `CompInput` и упаковка результата в `Decision` с провенансом.
//
// ⭐⭐⭐ ПОЧЕМУ ОБЁРТКА, А НЕ ВТОРАЯ РЕАЛИЗАЦИЯ. `ate.ts` уже стоит на проде под
// ATE-калькулятором и покрыт 54 проверками `check:ate`. Второй расчёт того же
// по тем же таблицам — это второй источник истины, который разъедется на первом
// же ATP (урок «один бридж, не два», s76).
//
// ⛔ Строки для человека — по-английски.

import {
  resolveRoute, computeRoute, isRelevant, tableKey, UNITS, RULE_KEYS,
  type Route, type InhalForm, type CompInput, type Resolved, type RouteResult,
} from '../../ate.ts';
import { decide } from '../data.ts';
import type {
  ClassifierData, ClassifierModule, Contribution, Decision, ModuleContext, ModuleOutput,
  NormalizedComponent, NormalizedInput, Warning,
} from '../types.ts';

/** Класс реестра, отвечающий за путь. */
export const ROUTE_CLASS: Record<Route, string> = {
  oral: 'ACUTE_TOX_ORAL',
  dermal: 'ACUTE_TOX_DERMAL',
  inhalation: 'ACUTE_TOX_INHAL',
};

/**
 * `3.1.3.6.1(b)` — «ignore ingredients that are presumed not acutely toxic
 * (e.g., water, sugar)». Основание статуса `nonhazard` и ответа
 * «not classified», когда считать нечего, а неизвестных нет.
 */
export const RULE_NONHAZARD = '3.1.3.6.1b-NONHAZARD';

const ROUTES: Route[] = ['oral', 'dermal', 'inhalation'];

/** Пары Acute Tox. из классификаций компонента → вход `ate.ts`. */
function acutePairs(c: NormalizedComponent): CompInput['annex6'] {
  const out: NonNullable<CompInput['annex6']> = [];
  for (const p of c.classifications) {
    const route = (Object.keys(ROUTE_CLASS) as Route[]).find((r) => ROUTE_CLASS[r] === p.classCode);
    if (!route) continue;
    if (p.categoryCode == null || !/^[1-5]$/.test(p.categoryCode)) continue;
    out.push({ route, cat: Number(p.categoryCode), star: !!p.star });
  }
  return out.length ? out : null;
}

function toCompInput(c: NormalizedComponent): CompInput {
  return {
    concentration: c.conc,
    hCodes: c.hCodes.length ? c.hCodes : null,
    dbAteOral: null, // ⚠ ветка `db` выключена в ate.ts (session 38) — см. её шапку
    manual: c.input.manualAte ?? {},
    annex6: acutePairs(c),
    annex6Ate: c.input.ate ?? null,
    knownNonhazard: !!c.input.knownNonhazard,
  };
}

/** Человеческий текст предупреждений `ate.ts` (⛔ по-английски). */
const WARNING_TEXT: Record<string, { level: Warning['level']; message: string; rule?: string }> = {
  UNKNOWN_GT10: {
    level: 'caution', rule: RULE_KEYS.formulaCorrected,
    message: 'Ingredients with unknown acute toxicity exceed 10 % of the mixture, so the numerator of the additivity formula was reduced. The result is provisional until those ingredients get data or are stated not acutely toxic.',
  },
  CAT1_3_BELOW_1PCT: {
    level: 'info', rule: RULE_KEYS.cutoffCat13,
    message: 'An ingredient below 1 % was taken into account: Table 1.1 counts Category 1–3 acute toxicity from 0,1 %.',
  },
  STAR: {
    level: 'caution',
    message: 'At least one contributing ingredient carries “*” in Annex VI — a minimum classification. The harmonised category is a floor; a supplier holding test data may have to classify it stricter (Annex VI 1.2.1).',
  },
  FORM_MISMATCH: {
    level: 'caution',
    message: 'Annex VI prints an inhalation ATE for a different physical form than the one selected for this mixture, so that value was not used. Check the inhalation form.',
  },
  EDGE_POINT_ESTIMATE: {
    level: 'info',
    message: 'ATEmix landed exactly on a category boundary because a converted point estimate sits on the lower edge of its own range (Table 3.1.2). The true value is strictly higher, so the mixture keeps the ingredients’ own category.',
  },
};

function warningsOf(r: RouteResult): Warning[] {
  return r.warnings.map((code) => {
    const t = WARNING_TEXT[code];
    return t
      ? { code, level: t.level, message: t.message, ruleKey: t.rule }
      : { code, level: 'info' as const, message: code };
  });
}

function contributionsOf(
  comps: { c: NormalizedComponent; resolved: Resolved }[],
  route: Route,
  form: InhalForm,
): Contribution[] {
  const key = tableKey(route, form);
  return comps.map(({ c, resolved }) => {
    // ⭐ Релевантность берём у самого `ate.ts` (`isRelevant`), а не считаем
    // заново: копия правила разъехалась бы на первой же правке Table 1.1.
    const counted = resolved.state === 'known' && isRelevant(c.conc, resolved);
    return {
      componentId: c.id,
      name: c.name,
      conc: c.conc,
      value: resolved.ate,
      limitSource: resolved.state === 'known' ? 'ATE' : 'NONE',
      provenance: resolved.state === 'nonhazard'
        ? 'data available, not classified (stated) — 3.1.3.6.1(b)'
        : resolved.state === 'unknown'
          ? (c.conc >= 1 ? 'no acute-toxicity data — counted in Σ C(unknown)' : 'no acute-toxicity data — below 1 %, not relevant')
          : `${resolved.provenance} (${UNITS[key]})`,
      counted,
    };
  });
}

function fmt(n: number): string {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 1) return n.toFixed(1);
  return Number(n.toPrecision(3)).toString();
}

export const acuteToxModule: ClassifierModule = {
  key: 'A1',
  title: 'Acute toxicity',
  classes: [ROUTE_CLASS.oral, ROUTE_CLASS.dermal, ROUTE_CLASS.inhalation],
  implemented: true,

  run(input: NormalizedInput, _data: ClassifierData, ctx: ModuleContext): ModuleOutput {
    const { rules, registry } = ctx;
    const decisions: Decision[] = [];
    const live = input.components.filter((c) => c.conc > 0);

    for (const route of ROUTES) {
      const cls = ROUTE_CLASS[route];

      if (!live.length) {
        decisions.push(decide({
          module: 'A1', classCode: cls, categoryCode: null, status: 'insufficient_data',
          reason: 'No ingredients entered.',
        }, rules, registry));
        continue;
      }

      const resolvedComps = live.map((c) => ({ c, resolved: resolveRoute(toCompInput(c), route, input.inhalForm) }));
      const r = computeRoute(resolvedComps.map(({ c, resolved }) => ({ conc: c.conc, resolved })), route, tableKey(route, input.inhalForm));
      const contributions = contributionsOf(resolvedComps, route, input.inhalForm);
      const warnings = warningsOf(r);
      const unit = UNITS[r.key];

      if (r.category != null) {
        decisions.push(decide({
          module: 'A1', classCode: cls, categoryCode: String(r.category), status: 'classified',
          ruleKey: r.ruleKey, contributions, warnings, provisional: r.corrected,
          aggregate: {
            expr: r.corrected
              ? `(100 − ${fmt(r.unknownConc)}) / ATEmix = Σ (Ci / ATEi) → ATEmix = ${fmt(r.ateMix as number)} ${unit}`
              : `100 / ATEmix = Σ (Ci / ATEi) → ATEmix = ${fmt(r.ateMix as number)} ${unit}`,
            value: r.ateMix as number,
            threshold: null,
            operator: '<=',
            unit,
          },
        }, rules, registry));
        continue;
      }

      if (r.knownCount > 0) {
        // ATEmix посчитан, но выше потолка категории 4 — это ОТВЕТ, а не пробел.
        decisions.push(decide({
          module: 'A1', classCode: cls, categoryCode: null, status: 'not_classified',
          ruleKey: r.ruleKey, contributions, warnings,
          reason: r.ateMix != null
            ? `ATEmix ${fmt(r.ateMix)} ${unit} is above the Category 4 ceiling for this route.`
            : 'No ingredient contributed a usable acute toxicity estimate.',
          aggregate: r.ateMix != null
            ? { expr: `ATEmix = ${fmt(r.ateMix)} ${unit}`, value: r.ateMix, threshold: null, operator: '>', unit }
            : null,
        }, rules, registry));
        continue;
      }

      if (r.unknownConc > 0) {
        decisions.push(decide({
          module: 'A1', classCode: cls, categoryCode: null, status: 'insufficient_data',
          ruleKey: RULE_KEYS.relevant, contributions, warnings,
          reason: `No relevant ingredient carries acute toxicity data on this route, and ${fmt(r.unknownConc)} % of the mixture has none.`,
        }, rules, registry));
        continue;
      }

      decisions.push(decide({
        module: 'A1', classCode: cls, categoryCode: null, status: 'not_classified',
        ruleKey: RULE_NONHAZARD, contributions, warnings,
        reason: 'Every ingredient on this route is either below the cut-off or stated as not acutely toxic.',
      }, rules, registry));
    }

    return { decisions };
  },
};
