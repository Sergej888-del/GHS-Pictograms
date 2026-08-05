// GHS/CLP acute-toxicity engine for the ATE Mixture Calculator (pro).
// Pure, self-contained, unit-testable — the React island only renders what
// these functions return. All numbers are the harmonised GHS/CLP values:
//   • Table 3.1.1  — classification cut-off ranges (upper bound per category)
//   • Table 3.1.2  — converted acute toxicity point estimates
// Sources verified against UN GHS Rev.5+ Chapter 3.1, CLP Annex I 3.1.2,
// ECHA/SCHC acute-tox info sheets and the Sigma-Aldrich H→P allocation table.
//
// Inhalation is form-dependent (gas / vapour / dust-mist): the H-code (H330/
// H331/H332) does not encode the physical form, so the mixture carries ONE
// inhalation form and every inhalation conversion uses that form's column.

export type Route = 'oral' | 'dermal' | 'inhalation'
export type InhalForm = 'gas' | 'vapour' | 'dust_mist'
/** The key a route resolves to in the GHS tables (inhalation splits by form). */
export type TableKey = 'oral' | 'dermal' | 'gas' | 'vapour' | 'dust_mist'

export type Source = 'db' | 'converted' | 'manual' | 'manual-cat' | 'unknown'

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

// ── Acute-tox hazard statement → route + category(ies) ───────────────────────
// H300/H310/H330 span categories 1 AND 2 (same statement) — the H-code alone
// cannot tell them apart, so `cats` lists both and the engine defaults to the
// conservative (lower-numbered, more toxic) category unless the user overrides.
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

// ── Per-component route resolution ───────────────────────────────────────────

export interface Manual {
  ate?: number | null // explicit numeric ATE
  cat?: number | null // explicit category (uses point estimate)
}
export interface CompInput {
  concentration: number
  hCodes: string[] | null
  dbAteOral: number | null // raw substances.ate_oral (may be the 1.00 artifact)
  manual: Partial<Record<Route, Manual>>
}
export interface Resolved {
  ate: number | null
  cat: number | null
  source: Source
  /** converted from an H300/H310/H330 that spans cat 1–2 → shown as a caveat. */
  ambiguous: boolean
}

/**
 * Resolve the effective ATE + category a component contributes on one route.
 * Priority: manual ATE → manual category → converted point estimate from the
 * harmonised H-code → unknown.
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
 * ⚠⚠ Цена ошибки была несимметрична: число маленькое, поэтому категория
 * выходила 1–2 — то есть вещество объявлялось ОПАСНЕЕ, чем оно есть по закону.
 * Ошибка в безопасную сторону, но на сайте про соответствие требованиям
 * неверное остаётся неверным.
 *
 * ⚠ Затрагивало 260 веществ из 3 650 (7 %). Остальные 93 % — 2 868 нулей и
 * 522 единицы — ветка отбрасывала и раньше, они шли на пересчёт из H-кода.
 * Теперь туда идут все: у этого пути есть документированное основание
 * (CLP, таблица 3.1.2), а у числа из базы основания нет никакого.
 *
 * ⚠ Включать обратно — только когда выяснится, что такое `ate_oral`. Тип
 * `Source` вариант 'db' сохраняет намеренно: он описывает возможные источники,
 * а не те, что сейчас используются.
 */
export function resolveRoute(c: CompInput, route: Route, form: InhalForm): Resolved {
  const key = tableKey(route, form)
  const m = c.manual[route]

  if (m?.ate != null && m.ate > 0) {
    return { ate: m.ate, cat: categoryFor(m.ate, key), source: 'manual', ambiguous: false }
  }
  if (m?.cat != null) {
    return { ate: pointEstimate(key, m.cat), cat: m.cat, source: 'manual-cat', ambiguous: false }
  }
  // ⚠⚠⚠ ВЫКЛЮЧЕНО — разбор в шапке функции. `substances.ate_oral` не является
  // ATE в мг/кг: у веществ с H302 (300–2000 мг/кг по Annex VI) там лежит 3–22,
  // ровно как у веществ с H300 (≤ 50). Строка сохранена, а не удалена, чтобы
  // вернуть её было одним движением, когда источник числа выяснится.
  //
  // if (route === 'oral' && c.dbAteOral != null && c.dbAteOral > 0 && c.dbAteOral !== 1) {
  //   return { ate: c.dbAteOral, cat: categoryFor(c.dbAteOral, key), source: 'db', ambiguous: false }
  // }
  const h = hCodeForRoute(c.hCodes, route)
  if (h) {
    const cats = H_ACUTE[h].cats
    const cat = cats[0] // conservative (lowest-numbered = most toxic)
    return { ate: pointEstimate(key, cat), cat, source: 'converted', ambiguous: cats.length > 1 }
  }
  return { ate: null, cat: null, source: 'unknown', ambiguous: false }
}

// ── Mixture ATE (additivity formula with the 10% unknown correction) ──────────

export interface RouteResult {
  route: Route
  key: TableKey
  ateMix: number | null
  category: number | null
  hCode: string | null
  /** total conc. of relevant ingredients with unknown ATE on this route */
  unknownConc: number
  /** true when unknownConc > 10 and the numerator was corrected */
  corrected: boolean
  /** count of relevant ingredients that contributed a known ATE */
  knownCount: number
}

/** Relevance threshold — ingredients ≥ 1% enter the additivity formula (GHS
 * generic cut-off for acute toxicity). */
export const RELEVANCE_CUTOFF = 1

/**
 * ATEmix for one route from resolved components.
 *   100 / ATEmix = Σ (Ci / ATEi)                       (all ATE known)
 *   (100 − ΣCunknown) / ATEmix = Σ (Ci / ATEi)          (ΣCunknown > 10 %)
 * Cunknown is summed only over relevant ingredients whose ATE is unknown, and
 * only subtracted when it exceeds 10 %. Concentrations are weight-%.
 */
export function computeRoute(
  comps: { conc: number; resolved: Resolved }[],
  route: Route,
  key: TableKey,
): RouteResult {
  const relevant = comps.filter(c => c.conc >= RELEVANCE_CUTOFF)
  const known = relevant.filter(c => c.resolved.ate != null && c.resolved.ate > 0)
  const unknownConc = relevant
    .filter(c => c.resolved.ate == null || !(c.resolved.ate > 0))
    .reduce((s, c) => s + c.conc, 0)

  if (known.length === 0) {
    return { route, key, ateMix: null, category: null, hCode: null, unknownConc, corrected: false, knownCount: 0 }
  }
  const sumRatio = known.reduce((s, c) => s + c.conc / (c.resolved.ate as number), 0)
  if (sumRatio <= 0) {
    return { route, key, ateMix: null, category: null, hCode: null, unknownConc, corrected: false, knownCount: known.length }
  }
  const corrected = unknownConc > 10
  const numerator = corrected ? 100 - unknownConc : 100
  const ateMix = numerator / sumRatio
  const category = categoryFor(ateMix, key)
  const hCode = category ? H_BY_ROUTE_CAT[route][category] : null
  return { route, key, ateMix, category, hCode, unknownConc, corrected, knownCount: known.length }
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
}

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
  return { routes, worstCategory, signalWord, pictogram, hCodes, pCodes }
}
