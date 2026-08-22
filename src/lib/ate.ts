// GHS/CLP acute-toxicity engine for the ATE Mixture Calculator (pro) — and
// module A1 of the mixture classifier (design-doc §5.4, audit №100 in s79).
// Pure, self-contained, unit-tested — the React island only renders what
// these functions return; `scripts/check-ate.ts` runs the fixtures without
// Astro and without the database. All numbers are the harmonised GHS/CLP values:
//   • Table 3.1.1  — classification cut-off ranges (upper bound per category)
//   • Table 3.1.2  — converted acute toxicity point estimates
//   • Table 1.1    — generic cut-off: Category 1–3 ingredients count from 0,1 %,
//                    Category 4 from 1 % (clp_generic_limits T1.1-ACUTE_TOX-*)
//   • 3.1.3.3      — relevant ingredients ≥ 1 % (3.1.3.3a-RELEVANT)
//   • 3.1.3.6.1    — additivity formula; 3.1.3.6.2.3 — correction when unknowns > 10 %
// Sources verified against CLP Annex I (consolidation 2026-05-01, the same
// text that fills `clp_generic_limits`), UN GHS Chapter 3.1, ECHA Guidance on
// the Application of the CLP Criteria.
//
// Inhalation is form-dependent (gas / vapour / dust-mist): the H-code (H330/
// H331/H332) does not encode the physical form, so the mixture carries ONE
// inhalation form and every inhalation conversion uses that form's column.
//
// ⭐⭐⭐ АУДИТ №100 (session 79) — что изменилось и почему:
//   1. Три состояния компонента на пути: `known` (есть число или категория),
//      `nonhazard` (данные есть, не классифицирован — утверждает пользователь)
//      и `unknown` (данных нет). Раньше вода считалась «unknown» и включала
//      коррекцию 3.1.3.6.2.3, завышая опасность. По умолчанию — `unknown`,
//      как и было (отсутствие H30x в Annex VI ≠ «известно, что безопасен»).
//   2. Точная категория из Annex VI (`annex6_classification`, A0) вместо
//      консервативного «cat 1» для H300/H310/H330: по замеру s79 дефолт «cat 1»
//      ошибался у 160 из 166 oral (96 %), 183 из 198 inhal (92 %) — point
//      estimate в 10 раз меньше, чем по закону. Без пар A0 движок ведёт себя
//      как раньше (cat 1, пометка «cat 1–2?») — обратная совместимость.
//   3. Гармонизированные ATE (`annex6_limits kind=ATE`, 183 у 116 веществ)
//      приоритетнее конверсии по категории; форма ингаляции должна совпасть.
//   4. Звёздочка «*» (минимальная классификация, Annex VI 1.2.1) — предупреждение.
//   5. Релевантность по Table 1.1: Category 1–3 — с 0,1 %, Category 4 и
//      неизвестные — с 1 %. Раньше порог был 1 % для всех, и 0,5 % вещества
//      категории 1 (ATE 0,5) молча выпадало — а по закону это категория 3.
//   6. Каждая строка результата несёт `ruleKey` — ключ `clp_generic_limits`.
//   7. Формула №91 сверена с текстом 3.1.3.6.2.3: (100 − ΣC_unknown)/ATEmix = Σ(Ci/ATEi).

export type Route = 'oral' | 'dermal' | 'inhalation'
export type InhalForm = 'gas' | 'vapour' | 'dust_mist'
/** The key a route resolves to in the GHS tables (inhalation splits by form). */
export type TableKey = 'oral' | 'dermal' | 'gas' | 'vapour' | 'dust_mist'

/**
 * Where the value of a component on a route came from.
 *   db          — numeric `substances.ate_oral` (⚠ branch disabled, see resolveRoute)
 *   annex6-ate  — harmonised ATE printed in Annex VI (annex6_limits kind=ATE)
 *   annex6-cat  — exact Annex VI category (annex6_classification) → Table 3.1.2
 *   converted   — category from the H-code only (H300/H310/H330 → conservative cat 1)
 *   manual      — numeric ATE entered by the user
 *   manual-cat  — category entered by the user → Table 3.1.2
 *   nonhazard   — user asserts data exist and the route is not classified
 *   unknown     — no data
 */
export type Source = 'db' | 'annex6-ate' | 'annex6-cat' | 'converted' | 'manual' | 'manual-cat' | 'nonhazard' | 'unknown'

/** Three states of a component on a route (design-doc §4.1, §6.1 item 1). */
export type AcuteToxState = 'known' | 'nonhazard' | 'unknown'

// ── Table 3.1.1 — classification cut-offs (upper bound, inclusive) ───────────
// A value ≤ max of the first matching row is that category.
export const CUTOFFS: Record<TableKey, { cat: number; max: number }[]> = {
  oral: [ { cat: 1, max: 5 }, { cat: 2, max: 50 }, { cat: 3, max: 300 }, { cat: 4, max: 2000 } ],
  dermal: [ { cat: 1, max: 50 }, { cat: 2, max: 200 }, { cat: 3, max: 1000 }, { cat: 4, max: 2000 } ],
  gas: [ { cat: 1, max: 100 }, { cat: 2, max: 500 }, { cat: 3, max: 2500 }, { cat: 4, max: 20000 } ],
  vapour: [ { cat: 1, max: 0.5 }, { cat: 2, max: 2.0 }, { cat: 3, max: 10.0 }, { cat: 4, max: 20.0 } ],
  dust_mist: [ { cat: 1, max: 0.05 }, { cat: 2, max: 0.5 }, { cat: 3, max: 1.0 }, { cat: 4, max: 5.0 } ],
}

// ── Table 3.1.2 — converted acute toxicity point estimates ───────────────────
export const POINT_ESTIMATE: Record<TableKey, Record<number, number>> = {
  oral: { 1: 0.5, 2: 5, 3: 100, 4: 500 },
  dermal: { 1: 5, 2: 50, 3: 300, 4: 1100 },
  gas: { 1: 10, 2: 100, 3: 700, 4: 4500 },
  vapour: { 1: 0.05, 2: 0.5, 3: 3, 4: 11 },
  dust_mist: { 1: 0.005, 2: 0.05, 3: 0.5, 4: 1.5 },
}

// Units per table key (display).
export const UNITS: Record<TableKey, string> = {
  oral: 'mg/kg bw',
  dermal: 'mg/kg bw',
  gas: 'ppmV',
  vapour: 'mg/L/4h',
  dust_mist: 'mg/L/4h',
}

// ── Table 1.1 / 3.1.3.3 — relevance thresholds (weight-%; v/v for gases) ─────
/** 3.1.3.3: ingredients ≥ 1 % are relevant (clp_generic_limits `3.1.3.3a-RELEVANT`). */
export const RELEVANCE_CUTOFF = 1
/** Table 1.1: an ingredient classified Category 1–3 is taken into account from 0,1 % (`T1.1-ACUTE_TOX-CAT1-3`). */
export const RELEVANCE_CUTOFF_CAT1_3 = 0.1
/** 3.1.3.6.2.3: unknowns are summed only when relevant (≥ 1 %) and corrected for only above this share. */
export const UNKNOWN_CORRECTION_THRESHOLD = 10

/** Rule keys printed in the result — they exist verbatim in `clp_generic_limits.rule_key`. */
export const RULE_KEYS = {
  formula: '3.1.3.6.1',
  formulaCorrected: '3.1.3.6.2.3-UNKNOWN-GT10',
  formulaUncorrected: '3.1.3.6.2.3-UNKNOWN-LE10',
  relevant: '3.1.3.3a-RELEVANT',
  cutoffCat13: 'T1.1-ACUTE_TOX-CAT1-3',
  cutoffCat4: 'T1.1-ACUTE_TOX-CAT4',
} as const

// ── Acute-tox hazard statement → route + category(ies) ───────────────────────
// H300/H310/H330 span categories 1 AND 2 (same statement) — the H-code alone
// cannot tell them apart, so `cats` lists both and the engine defaults to the
// conservative (lower-numbered, more toxic) category unless an Annex VI pair
// (annex6_classification) or the user says otherwise.
export const H_ACUTE: Record<string, { route: Route; cats: number[] }> = {
  H300: { route: 'oral', cats: [1, 2] },
  H301: { route: 'oral', cats: [3] },
  H302: { route: 'oral', cats: [4] },
  H310: { route: 'dermal', cats: [1, 2] },
  H311: { route: 'dermal', cats: [3] },
  H312: { route: 'dermal', cats: [4] },
  H330: { route: 'inhalation', cats: [1, 2] },
  H331: { route: 'inhalation', cats: [3] },
  H332: { route: 'inhalation', cats: [4] },
}

// Resulting H-code for a mixture, by route + category.
export const H_BY_ROUTE_CAT: Record<Route, Record<number, string>> = {
  oral: { 1: 'H300', 2: 'H300', 3: 'H301', 4: 'H302' },
  dermal: { 1: 'H310', 2: 'H310', 3: 'H311', 4: 'H312' },
  inhalation: { 1: 'H330', 2: 'H330', 3: 'H331', 4: 'H332' },
}

// Precautionary allocation for acute toxicity, by route + category (current
// CLP/GHS wording; combined codes kept joined). Text map below covers each.
export const P_BY_ROUTE_CAT: Record<Route, Record<number, string[]>> = {
  oral: {
    1: ['P264', 'P270', 'P301+P310', 'P321', 'P330', 'P405', 'P501'],
    2: ['P264', 'P270', 'P301+P310', 'P321', 'P330', 'P405', 'P501'],
    3: ['P264', 'P270', 'P301+P310', 'P321', 'P330', 'P405', 'P501'],
    4: ['P264', 'P270', 'P301+P312', 'P330', 'P501'],
  },
  dermal: {
    1: ['P262', 'P264', 'P270', 'P280', 'P302+P352', 'P310', 'P361+P364', 'P405', 'P501'],
    2: ['P262', 'P264', 'P270', 'P280', 'P302+P352', 'P310', 'P361+P364', 'P405', 'P501'],
    3: ['P280', 'P302+P352', 'P312', 'P361+P364', 'P405', 'P501'],
    4: ['P280', 'P302+P352', 'P312', 'P362+P364', 'P501'],
  },
  inhalation: {
    1: ['P260', 'P271', 'P284', 'P304+P340', 'P310', 'P320', 'P403+P233', 'P405', 'P501'],
    2: ['P260', 'P271', 'P284', 'P304+P340', 'P310', 'P320', 'P403+P233', 'P405', 'P501'],
    3: ['P261', 'P271', 'P304+P340', 'P311', 'P321', 'P403+P233', 'P405', 'P501'],
    4: ['P261', 'P271', 'P304+P340', 'P312'],
  },
}

// P-statement text (singles from DB wording + the combined codes the DB lacks).
export const P_TEXT: Record<string, string> = {
  P260: 'Do not breathe dust/fume/gas/mist/vapours/spray.',
  P261: 'Avoid breathing dust/fume/gas/mist/vapours/spray.',
  P262: 'Do not get in eyes, on skin, or on clothing.',
  P264: 'Wash hands thoroughly after handling.',
  P270: 'Do not eat, drink or smoke when using this product.',
  P271: 'Use only outdoors or in a well-ventilated area.',
  P280: 'Wear protective gloves/protective clothing/eye protection/face protection.',
  P284: 'Wear respiratory protection.',
  P310: 'Immediately call a POISON CENTER or doctor.',
  P311: 'Call a POISON CENTER or doctor.',
  P312: 'Call a POISON CENTER or doctor if you feel unwell.',
  P320: 'Specific treatment is urgent (see label).',
  P321: 'Specific treatment (see label).',
  P330: 'Rinse mouth.',
  P405: 'Store locked up.',
  P501: 'Dispose of contents/container in accordance with local regulations.',
  'P301+P310': 'IF SWALLOWED: Immediately call a POISON CENTER or doctor.',
  'P301+P312': 'IF SWALLOWED: Call a POISON CENTER or doctor if you feel unwell.',
  'P302+P352': 'IF ON SKIN: Wash with plenty of water.',
  'P304+P340': 'IF INHALED: Remove person to fresh air and keep comfortable for breathing.',
  'P361+P364': 'Take off immediately all contaminated clothing and wash it before reuse.',
  'P362+P364': 'Take off contaminated clothing and wash it before reuse.',
  'P403+P233': 'Store in a well-ventilated place. Keep container tightly closed.',
}

// ── Core helpers ─────────────────────────────────────────────────────────────

/** The GHS table column a route resolves to. */
export function tableKey(route: Route, form: InhalForm): TableKey {
  return route === 'inhalation' ? form : route
}

/** Category from an ATE value (Table 3.1.1). Returns null if > cat-4 ceiling. */
export function categoryFor(ate: number, key: TableKey): number | null {
  if (!(ate > 0)) return null
  for (const { cat, max } of CUTOFFS[key]) if (ate <= max) return cat
  return null
}

/**
 * ⚠ Особенность Table 3.1.2: point estimate категории 2 (oral 5, dermal 50,
 * gas 100, vapour 0,5, dust 0,05) и dusts/mists категории 3 (0,5) стоят РОВНО
 * на нижней границе своего диапазона Table 3.1.1 («5 < ATE ≤ 50»). Подстановка
 * такого значения в формулу даёт ATEmix ровно на границе категории выше
 * (100 % компонента cat 2 → ATEmix = 5 → «≤ 5» → cat 1) — смесь объявляется
 * опаснее собственного единственного компонента. Истинный ATE такого компонента
 * строго больше point estimate (он внутри диапазона, не на краю), значит и
 * истинный ATEmix строго больше вычисленного → категория k, а не k−1.
 * Это свойство диапазонов Table 3.1.1/3.1.2, не наша правка таблиц.
 */
export function isLowerEdgePointEstimate(key: TableKey, cat: number): boolean {
  const pe = POINT_ESTIMATE[key][cat]
  if (pe == null || cat < 2) return false
  return pe === CUTOFFS[key][cat - 2]!.max
}

/** Converted acute toxicity point estimate for a route/form + category. */
export function pointEstimate(key: TableKey, cat: number): number | null {
  return POINT_ESTIMATE[key][cat] ?? null
}

/** The acute-tox H-code a substance carries for a given route (first match). */
export function hCodeForRoute(hCodes: string[] | null | undefined, route: Route): string | null {
  for (const h of hCodes ?? []) {
    const e = H_ACUTE[h]
    if (e && e.route === route) return h
  }
  return null
}

/** True when the H-code maps to two categories (H300/H310/H330). */
export function isAmbiguousH(h: string): boolean {
  return (H_ACUTE[h]?.cats.length ?? 0) > 1
}

/**
 * Annex VI prints the inhalation form in six spellings («dusts or mists»,
 * «dusts and mists», «vapours», «vapour», «Vapours», «gases»). One place maps
 * them to the engine's form; anything else → null (the value is then not used).
 */
export function normalizeAteForm(form: string | null | undefined): InhalForm | null {
  const f = (form ?? '').trim().toLowerCase()
  if (!f) return null
  if (/^gas(es)?$/.test(f)) return 'gas'
  if (/^vapou?rs?$/.test(f)) return 'vapour'
  if (/^(dusts?|mists?)( (or|and|\/) (dusts?|mists?))?$/.test(f)) return 'dust_mist'
  return null
}

/** The unit Table 3.1.1 expects for a table column. */
function expectedUnit(key: TableKey): 'mg/kg bw' | 'ppmV' | 'mg/L' {
  return key === 'gas' ? 'ppmV' : key === 'oral' || key === 'dermal' ? 'mg/kg bw' : 'mg/L'
}

/** Unit strings as they appear in `annex6_limits.ate_unit`, normalised for comparison. */
function normalizeUnit(unit: string | null | undefined): 'mg/kg bw' | 'ppmV' | 'mg/L' | null {
  const u = (unit ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!u) return null
  if (u === 'ppmv' || u === 'ppm') return 'ppmV'
  if (u === 'mg/l' || u === 'mg/l/4h') return 'mg/L'
  if (u === 'mg/kg bw' || u === 'mg/kg' || u === 'mg/kg b.w.') return 'mg/kg bw'
  return null
}

// ── Per-component route resolution ───────────────────────────────────────────

export interface Manual {
  ate?: number | null // explicit numeric ATE
  cat?: number | null // explicit category (uses point estimate)
}

/** An acute-tox pair of `annex6_classification` (A0) — exact category + «*». */
export interface Annex6AcutePair {
  route: Route
  cat: number
  /** «*» — minimum classification (Annex VI 1.2.1). */
  star: boolean
}

/** A harmonised ATE of `annex6_limits` (kind=ATE), as stored. */
export interface Annex6Ate {
  route: Route
  value: number
  /** `mg/kg bw` | `mg/L` | `ppmV` | null (one Annex VI row prints no unit — inferred from the form). */
  unit: string | null
  /** Annex VI wording: `dusts or mists`, `vapours`, `gases`, … — also `anhydrate`/`tetrahydrate` for an oral pair of forms. */
  form: string | null
  /** Verbatim Annex VI text (provenance). */
  raw?: string
}

export interface CompInput {
  concentration: number
  hCodes: string[] | null
  /** raw substances.ate_oral (may be the 1.00 artifact) — ⚠ not used, see resolveRoute */
  dbAteOral: number | null
  manual: Partial<Record<Route, Manual>>
  /** Exact Annex VI categories (A0). Absent → H-code conversion as before. */
  annex6?: Annex6AcutePair[] | null
  /** Harmonised ATE values (annex6_limits). Absent → category conversion. */
  annex6Ate?: Annex6Ate[] | null
  /**
   * User asserts: data exist and the routes WITHOUT a value are not classified
   * (water, salt, a supplier SDS saying «not classified» with an LD50). Such
   * routes resolve to `nonhazard` — out of the formula AND out of the unknown
   * sum. Default false: no data ≠ no hazard (design-doc §6.1 item 1).
   */
  knownNonhazard?: boolean
}

export type CompWarning =
  /** «*» on the Annex VI pair — minimum classification, a supplier may hold data for a stricter category. */
  | 'STAR'
  /** Annex VI prints an inhalation ATE for another physical form than the mixture's — value not used. */
  | 'FORM_MISMATCH'
  /** Annex VI prints several ATE values for this route (e.g. anhydrate / tetrahydrate) — the lowest is used. */
  | 'MULTI_VALUE'
  /** Annex VI row prints no unit — unit taken from the form (gases → ppmV, else mg/L). */
  | 'UNIT_INFERRED'

export interface Resolved {
  ate: number | null
  cat: number | null
  source: Source
  state: AcuteToxState
  /** converted from an H300/H310/H330 that spans cat 1–2 → shown as a caveat. */
  ambiguous: boolean
  /** «*» on the Annex VI pair (minimum classification). */
  star: boolean
  warnings: CompWarning[]
  /** One line for the provenance badge / report («Annex VI ATE 300 mg/kg bw»). */
  provenance: string
}

function resolved(p: Omit<Resolved, 'state'>): Resolved {
  const state: AcuteToxState = p.source === 'nonhazard' ? 'nonhazard' : p.ate != null && p.ate > 0 ? 'known' : 'unknown'
  return { ...p, state }
}

/**
 * Resolve the effective ATE + category a component contributes on one route.
 * Priority: manual ATE → manual category → harmonised Annex VI ATE (same
 * form) → exact Annex VI category (A0) → converted point estimate from the
 * H-code (cat 1 when ambiguous) → `nonhazard` (if asserted) → unknown.
 *
 * ⚠⚠⚠ ВЕТКА `db` ВЫКЛЮЧЕНА (session 38, решение Сергея). Раньше здесь стояло
 * «доверенное числовое значение из базы (только oral)». Проверка показала, что
 * `substances.ate_oral` — НЕ ATE в мг/кг, и это видно по данным:
 *
 *   что говорит Annex VI                     веществ   ate_oral
 *   H302 — категория 4, ATE 300–2000 мг/кг      54      3–22, среднее 11.9
 *   H301 — категория 3, ATE 50–300              19      5–21, среднее 13.5
 *   H300 — категория 1–2, ATE ≤ 50               6      5–14, среднее 9.5
 *   острой оральной классификации НЕТ вовсе    181      3–22, среднее 14.0
 *
 * Распределение ОДИНАКОВОЕ во всех четырёх группах. У настоящих ATE разница
 * между H300 и H302 была бы в сотни раз. Плюс 181 вещество несёт число, хотя
 * острой оральной токсичности им Annex VI не присваивал вовсе, а во всём наборе
 * нет ни одного значения в диапазоне 300–2000 — потолок ровно на 22.
 *
 * ⚠ s79: настоящие гармонизированные ATE живут в `annex6_limits kind=ATE`
 * (183 значения у 116 веществ, каждое внутри своей категории A0) и приходят
 * сюда полем `annex6Ate` — это и есть «источник числа», которого не хватало.
 * `dbAteOral` остаётся в типе ради совместимости острова и не читается.
 */
export function resolveRoute(c: CompInput, route: Route, form: InhalForm): Resolved {
  const key = tableKey(route, form)
  const m = c.manual[route]
  const pair = (c.annex6 ?? []).find(p => p.route === route) ?? null
  const star = pair?.star ?? false
  const warnings: CompWarning[] = []
  if (star) warnings.push('STAR')

  if (m?.ate != null && m.ate > 0) {
    return resolved({ ate: m.ate, cat: categoryFor(m.ate, key), source: 'manual', ambiguous: false, star, warnings, provenance: `manual ATE ${m.ate} ${UNITS[key]}` })
  }
  if (m?.cat != null) {
    return resolved({ ate: pointEstimate(key, m.cat), cat: m.cat, source: 'manual-cat', ambiguous: false, star, warnings, provenance: `manual Category ${m.cat} → Table 3.1.2` })
  }

  // Harmonised ATE printed in Annex VI — only in the mixture's inhalation form.
  const printed = (c.annex6Ate ?? []).filter(a => a.route === route && a.value > 0)
  if (printed.length) {
    const usable = printed.filter(a => {
      if (route !== 'inhalation') return true
      if (normalizeAteForm(a.form) !== form) return false
      const u = normalizeUnit(a.unit)
      return u == null || u === expectedUnit(key)
    })
    if (usable.length) {
      const best = usable.reduce((a, b) => (b.value < a.value ? b : a))
      if (usable.length > 1) warnings.push('MULTI_VALUE')
      if (route === 'inhalation' && normalizeUnit(best.unit) == null) warnings.push('UNIT_INFERRED')
      return resolved({ ate: best.value, cat: categoryFor(best.value, key), source: 'annex6-ate', ambiguous: false, star, warnings, provenance: `Annex VI ATE ${best.value} ${UNITS[key]}${best.raw ? ` («${best.raw}»)` : ''}` })
    }
    warnings.push('FORM_MISMATCH')
  }

  // Exact category from the Annex VI row (A0 pair) → Table 3.1.2.
  if (pair) {
    return resolved({ ate: pointEstimate(key, pair.cat), cat: pair.cat, source: 'annex6-cat', ambiguous: false, star, warnings, provenance: `Annex VI Category ${pair.cat}${star ? ' *' : ''} → Table 3.1.2` })
  }

  // ⚠⚠⚠ ВЫКЛЮЧЕНО — разбор в шапке функции. Строка сохранена, а не удалена.
  // if (route === 'oral' && c.dbAteOral != null && c.dbAteOral > 0 && c.dbAteOral !== 1) {
  //   return resolved({ ate: c.dbAteOral, cat: categoryFor(c.dbAteOral, key), source: 'db', … })
  // }

  const h = hCodeForRoute(c.hCodes, route)
  if (h) {
    const cats = H_ACUTE[h]!.cats
    const cat = cats[0]! // conservative (lowest-numbered = most toxic) until an A0 pair says otherwise
    return resolved({ ate: pointEstimate(key, cat), cat, source: 'converted', ambiguous: cats.length > 1, star, warnings, provenance: `${h} → Category ${cat}${cats.length > 1 ? ' (1–2?)' : ''} → Table 3.1.2` })
  }
  if (c.knownNonhazard) {
    return resolved({ ate: null, cat: null, source: 'nonhazard', ambiguous: false, star, warnings, provenance: 'data available, not classified (stated by user)' })
  }
  return resolved({ ate: null, cat: null, source: 'unknown', ambiguous: false, star, warnings, provenance: 'no data' })
}

// ── Mixture ATE (additivity formula with the 10% unknown correction) ──────────

export type RouteWarning =
  /** unknowns > 10 % — the numerator was corrected (3.1.3.6.2.3); result is provisional. */
  | 'UNKNOWN_GT10'
  /** a Category 1–3 ingredient below 1 % was taken into account (Table 1.1, 0,1 %). */
  | 'CAT1_3_BELOW_1PCT'
  /** at least one contributing ingredient carries «*» (minimum classification). */
  | 'STAR'
  /** at least one ingredient has an Annex VI inhalation ATE for another form — converted value used instead. */
  | 'FORM_MISMATCH'
  /** ATEmix landed exactly on a category boundary from lower-edge point estimates (Table 3.1.2) — classified in the ingredients' own category, not the stricter one. */
  | 'EDGE_POINT_ESTIMATE'

export interface RouteResult {
  route: Route
  key: TableKey
  ateMix: number | null
  category: number | null
  hCode: string | null
  /** total conc. of relevant (≥ 1 %) ingredients with unknown ATE on this route */
  unknownConc: number
  /** total conc. of ingredients asserted non-hazardous on this route (informational) */
  nonhazardConc: number
  /** true when unknownConc > 10 and the numerator was corrected */
  corrected: boolean
  /** count of relevant ingredients that contributed a known ATE */
  knownCount: number
  /** `clp_generic_limits.rule_key` of the formula applied (null when nothing was computed) */
  ruleKey: string | null
  warnings: RouteWarning[]
}

/**
 * Relevance of one component on one route (Table 1.1 + 3.1.3.3):
 *   known, Category 1–3 → from 0,1 %;  known, Category 4 or beyond → from 1 %;
 *   unknown → counted in ΣC_unknown from 1 %;  nonhazard → never.
 */
export function isRelevant(conc: number, r: Resolved): boolean {
  if (r.state === 'nonhazard') return false
  if (r.state === 'unknown') return conc >= RELEVANCE_CUTOFF
  if (r.cat != null && r.cat <= 3) return conc >= RELEVANCE_CUTOFF_CAT1_3
  return conc >= RELEVANCE_CUTOFF
}

/**
 * ATEmix for one route from resolved components.
 *   100 / ATEmix = Σ (Ci / ATEi)                       (3.1.3.6.1, all ATE known)
 *   (100 − ΣCunknown) / ATEmix = Σ (Ci / ATEi)          (3.1.3.6.2.3, ΣCunknown > 10 %)
 * Cunknown is summed only over relevant (≥ 1 %) ingredients whose ATE is
 * unknown — not over ingredients asserted non-hazardous — and only subtracted
 * when it exceeds 10 %. Concentrations are weight-% (v/v for gases).
 */
export function computeRoute(
  comps: { conc: number; resolved: Resolved }[],
  route: Route,
  key: TableKey,
): RouteResult {
  const relevant = comps.filter(c => c.conc > 0 && isRelevant(c.conc, c.resolved))
  const known = relevant.filter(c => c.resolved.state === 'known')
  const unknownConc = relevant.filter(c => c.resolved.state === 'unknown').reduce((s, c) => s + c.conc, 0)
  const nonhazardConc = comps.filter(c => c.conc > 0 && c.resolved.state === 'nonhazard').reduce((s, c) => s + c.conc, 0)
  const warnings: RouteWarning[] = []
  if (known.some(c => c.conc < RELEVANCE_CUTOFF)) warnings.push('CAT1_3_BELOW_1PCT')
  if (known.some(c => c.resolved.star)) warnings.push('STAR')
  if (known.some(c => c.resolved.warnings.includes('FORM_MISMATCH'))) warnings.push('FORM_MISMATCH')

  const empty = (knownCount: number): RouteResult =>
    ({ route, key, ateMix: null, category: null, hCode: null, unknownConc, nonhazardConc, corrected: false, knownCount, ruleKey: null, warnings })
  if (known.length === 0) return empty(0)
  const sumRatio = known.reduce((s, c) => s + c.conc / (c.resolved.ate as number), 0)
  if (sumRatio <= 0) return empty(known.length)

  const corrected = unknownConc > UNKNOWN_CORRECTION_THRESHOLD
  const numerator = corrected ? 100 - unknownConc : 100
  if (corrected) warnings.push('UNKNOWN_GT10')
  const ruleKey = corrected ? RULE_KEYS.formulaCorrected : unknownConc > 0 ? RULE_KEYS.formulaUncorrected : RULE_KEYS.formula
  const ateMix = numerator / sumRatio
  let category = categoryFor(ateMix, key)
  // Граница категорий, достигнутая point estimate с нижнего края диапазона
  // (см. isLowerEdgePointEstimate): истинное значение строго больше → категория выше.
  const edge = known.some(c => c.resolved.cat != null && c.resolved.source !== 'manual' && c.resolved.source !== 'annex6-ate'
    && isLowerEdgePointEstimate(key, c.resolved.cat))
  if (edge && category != null) {
    const bound = CUTOFFS[key][category - 1]!.max
    if (Math.abs(ateMix - bound) <= bound * 1e-9) {
      category = category < 4 ? category + 1 : null
      warnings.push('EDGE_POINT_ESTIMATE')
    }
  }
  const hCode = category ? (H_BY_ROUTE_CAT[route][category] ?? null) : null
  return { route, key, ateMix, category, hCode, unknownConc, nonhazardConc, corrected, knownCount: known.length, ruleKey, warnings }
}

// ── Overall classification roll-up ───────────────────────────────────────────

export interface MixClassification {
  routes: RouteResult[]
  /** lowest (worst) category across classified routes, or null */
  worstCategory: number | null
  signalWord: 'Danger' | 'Warning' | null
  pictogram: 'GHS06' | 'GHS07' | null
  hCodes: string[]
  pCodes: string[]
  /** union of route warnings, in a fixed order */
  warnings: RouteWarning[]
  /** true when any route result rests on the unknown-ingredient correction (3.1.3.6.2.3) */
  provisional: boolean
}

const WARNING_ORDER: RouteWarning[] = ['UNKNOWN_GT10', 'EDGE_POINT_ESTIMATE', 'STAR', 'CAT1_3_BELOW_1PCT', 'FORM_MISMATCH']

export function rollUp(routes: RouteResult[]): MixClassification {
  const classified = routes.filter(r => r.category != null)
  const cats = classified.map(r => r.category as number)
  const worstCategory = cats.length ? Math.min(...cats) : null
  const signalWord = worstCategory == null ? null : worstCategory <= 3 ? 'Danger' : 'Warning'
  const pictogram = worstCategory == null ? null : worstCategory <= 3 ? 'GHS06' : 'GHS07'

  const hCodes = Array.from(new Set(classified.map(r => r.hCode).filter(Boolean) as string[])).sort()
  const pSet = new Set<string>()
  for (const r of classified) {
    if (r.category == null) continue
    for (const p of P_BY_ROUTE_CAT[r.route][r.category] ?? []) pSet.add(p)
  }
  // Stable order: prevention → response → storage → disposal isn't encoded, so
  // sort by numeric code for a deterministic display.
  const pCodes = Array.from(pSet).sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10)
    const nb = parseInt(b.replace(/\D/g, ''), 10)
    return na - nb || a.localeCompare(b)
  })
  const all = new Set(routes.flatMap(r => r.warnings))
  const warnings = WARNING_ORDER.filter(w => all.has(w))
  const provisional = classified.some(r => r.corrected)
  return { routes, worstCategory, signalWord, pictogram, hCodes, pCodes, warnings, provisional }
}
