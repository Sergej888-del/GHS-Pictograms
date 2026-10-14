// src/lib/directoryGeo.ts — география каталога (шаг A1, s108, мастер-план §3 и §5).
//
// ЧИСТЫЙ модуль: ни Supabase, ни import.meta.env, ни импортов. Его читают DirectoryListing / DirectoryCard (фильтры),
// directoryModel (countryName) и scripts/check-directory-geo.ts.
//
// Что здесь: таблица страна → субрегион → континент (одна на весь каталог), развёртка поля `market.detail`
// (EU / EEA / worldwide / коды ISO) в токены для фильтров, подписи на английском (строки на сайте — только по-английски).
//
// ⚠ ЭТО ФИЛЬТРЫ, А НЕ СТРАНИЦЫ. Решение Сергея 13.10 (A1): отдельные страницы стран и регионов не строим и в sitemap не
//   кладём, пока индекс Google не восстановится (правило s105 п. 5) и не будет данных по спросу. Порог страницы (≥ 5 живых
//   записей) — `PAGE_MIN_ENTRIES`, пока нигде не используется.
// ⚠ Слои фильтра: страна `c:DE` → субрегион `r:dach` → континент `k:europe`. Субрегион всегда внутри одного континента.
// ⚠ Россия и Беларусь есть в таблице только чтобы разобрать «рынки», которые называет вендор. Записей оттуда в каталоге
//   нет и пока не будет (решение Сергея 13.10: не добавлять до снятия санкций).

export type ContinentSlug = 'europe' | 'americas' | 'asia' | 'oceania' | 'africa'

export const CONTINENTS: readonly { slug: ContinentSlug; name: string }[] = [
  { slug: 'europe', name: 'Europe' },
  { slug: 'americas', name: 'Americas' },
  { slug: 'asia', name: 'Asia' },
  { slug: 'oceania', name: 'Oceania' },
  { slug: 'africa', name: 'Africa' },
]

export type SubregionSlug =
  | 'british-isles' | 'dach' | 'nordics' | 'baltics' | 'benelux' | 'central-eastern-europe' | 'southern-western-europe'
  | 'eastern-europe' | 'northern-america' | 'latin-america' | 'east-asia' | 'south-east-asia' | 'south-asia'
  | 'middle-east' | 'central-asia-caucasus' | 'oceania' | 'africa'

export const SUBREGIONS: readonly { slug: SubregionSlug; name: string; continent: ContinentSlug }[] = [
  { slug: 'british-isles', name: 'Britain & Ireland', continent: 'europe' },
  { slug: 'dach', name: 'DACH', continent: 'europe' },
  { slug: 'nordics', name: 'Nordics', continent: 'europe' },
  { slug: 'baltics', name: 'Baltics', continent: 'europe' },
  { slug: 'benelux', name: 'Benelux', continent: 'europe' },
  { slug: 'central-eastern-europe', name: 'Central & Eastern Europe', continent: 'europe' },
  { slug: 'southern-western-europe', name: 'Southern & Western Europe', continent: 'europe' },
  { slug: 'eastern-europe', name: 'Eastern Europe', continent: 'europe' },
  { slug: 'northern-america', name: 'US & Canada', continent: 'americas' },
  { slug: 'latin-america', name: 'Latin America', continent: 'americas' },
  { slug: 'east-asia', name: 'East Asia', continent: 'asia' },
  { slug: 'south-east-asia', name: 'South-East Asia', continent: 'asia' },
  { slug: 'south-asia', name: 'South Asia', continent: 'asia' },
  { slug: 'middle-east', name: 'Middle East', continent: 'asia' },
  { slug: 'central-asia-caucasus', name: 'Central Asia & Caucasus', continent: 'asia' },
  { slug: 'oceania', name: 'Oceania', continent: 'oceania' },
  { slug: 'africa', name: 'Africa', continent: 'africa' },
]

/** Порог страницы страны / региона (мастер-план §5). Сейчас страницы не строятся — см. шапку. */
export const PAGE_MIN_ENTRIES = 5

type GeoRow = { name: string; sub: SubregionSlug }

/** ISO 3166-1 alpha-2 → название и субрегион. Коды, которых здесь нет, сборка и import:directory не пропускают. */
export const GEO: Readonly<Record<string, GeoRow>> = {
  // Britain & Ireland
  GB: { name: 'United Kingdom', sub: 'british-isles' }, IE: { name: 'Ireland', sub: 'british-isles' },
  // DACH
  DE: { name: 'Germany', sub: 'dach' }, AT: { name: 'Austria', sub: 'dach' }, CH: { name: 'Switzerland', sub: 'dach' },
  LI: { name: 'Liechtenstein', sub: 'dach' },
  // Nordics
  DK: { name: 'Denmark', sub: 'nordics' }, FI: { name: 'Finland', sub: 'nordics' }, IS: { name: 'Iceland', sub: 'nordics' },
  NO: { name: 'Norway', sub: 'nordics' }, SE: { name: 'Sweden', sub: 'nordics' },
  // Baltics
  EE: { name: 'Estonia', sub: 'baltics' }, LV: { name: 'Latvia', sub: 'baltics' }, LT: { name: 'Lithuania', sub: 'baltics' },
  // Benelux
  BE: { name: 'Belgium', sub: 'benelux' }, NL: { name: 'Netherlands', sub: 'benelux' }, LU: { name: 'Luxembourg', sub: 'benelux' },
  // Central & Eastern Europe
  PL: { name: 'Poland', sub: 'central-eastern-europe' }, CZ: { name: 'Czechia', sub: 'central-eastern-europe' },
  SK: { name: 'Slovakia', sub: 'central-eastern-europe' }, HU: { name: 'Hungary', sub: 'central-eastern-europe' },
  SI: { name: 'Slovenia', sub: 'central-eastern-europe' }, HR: { name: 'Croatia', sub: 'central-eastern-europe' },
  RO: { name: 'Romania', sub: 'central-eastern-europe' }, BG: { name: 'Bulgaria', sub: 'central-eastern-europe' },
  RS: { name: 'Serbia', sub: 'central-eastern-europe' }, BA: { name: 'Bosnia and Herzegovina', sub: 'central-eastern-europe' },
  ME: { name: 'Montenegro', sub: 'central-eastern-europe' }, MK: { name: 'North Macedonia', sub: 'central-eastern-europe' },
  AL: { name: 'Albania', sub: 'central-eastern-europe' },
  // Southern & Western Europe
  FR: { name: 'France', sub: 'southern-western-europe' }, IT: { name: 'Italy', sub: 'southern-western-europe' },
  ES: { name: 'Spain', sub: 'southern-western-europe' }, PT: { name: 'Portugal', sub: 'southern-western-europe' },
  GR: { name: 'Greece', sub: 'southern-western-europe' }, MT: { name: 'Malta', sub: 'southern-western-europe' },
  CY: { name: 'Cyprus', sub: 'southern-western-europe' },
  // Eastern Europe
  UA: { name: 'Ukraine', sub: 'eastern-europe' }, BY: { name: 'Belarus', sub: 'eastern-europe' },
  MD: { name: 'Moldova', sub: 'eastern-europe' }, RU: { name: 'Russia', sub: 'eastern-europe' },
  // US & Canada
  US: { name: 'United States', sub: 'northern-america' }, CA: { name: 'Canada', sub: 'northern-america' },
  // Latin America
  MX: { name: 'Mexico', sub: 'latin-america' }, BR: { name: 'Brazil', sub: 'latin-america' },
  AR: { name: 'Argentina', sub: 'latin-america' }, CL: { name: 'Chile', sub: 'latin-america' },
  CO: { name: 'Colombia', sub: 'latin-america' }, PE: { name: 'Peru', sub: 'latin-america' },
  UY: { name: 'Uruguay', sub: 'latin-america' }, EC: { name: 'Ecuador', sub: 'latin-america' },
  // East Asia
  CN: { name: 'China', sub: 'east-asia' }, JP: { name: 'Japan', sub: 'east-asia' }, KR: { name: 'South Korea', sub: 'east-asia' },
  TW: { name: 'Taiwan', sub: 'east-asia' }, HK: { name: 'Hong Kong', sub: 'east-asia' },
  // South-East Asia
  SG: { name: 'Singapore', sub: 'south-east-asia' }, MY: { name: 'Malaysia', sub: 'south-east-asia' },
  TH: { name: 'Thailand', sub: 'south-east-asia' }, ID: { name: 'Indonesia', sub: 'south-east-asia' },
  VN: { name: 'Vietnam', sub: 'south-east-asia' }, PH: { name: 'Philippines', sub: 'south-east-asia' },
  // South Asia
  IN: { name: 'India', sub: 'south-asia' }, PK: { name: 'Pakistan', sub: 'south-asia' }, BD: { name: 'Bangladesh', sub: 'south-asia' },
  LK: { name: 'Sri Lanka', sub: 'south-asia' },
  // Middle East
  TR: { name: 'Turkey', sub: 'middle-east' }, IL: { name: 'Israel', sub: 'middle-east' }, SA: { name: 'Saudi Arabia', sub: 'middle-east' },
  AE: { name: 'United Arab Emirates', sub: 'middle-east' }, KW: { name: 'Kuwait', sub: 'middle-east' },
  QA: { name: 'Qatar', sub: 'middle-east' }, BH: { name: 'Bahrain', sub: 'middle-east' }, OM: { name: 'Oman', sub: 'middle-east' },
  JO: { name: 'Jordan', sub: 'middle-east' }, LB: { name: 'Lebanon', sub: 'middle-east' },
  // Central Asia & Caucasus
  KZ: { name: 'Kazakhstan', sub: 'central-asia-caucasus' }, UZ: { name: 'Uzbekistan', sub: 'central-asia-caucasus' },
  KG: { name: 'Kyrgyzstan', sub: 'central-asia-caucasus' }, AM: { name: 'Armenia', sub: 'central-asia-caucasus' },
  AZ: { name: 'Azerbaijan', sub: 'central-asia-caucasus' }, GE: { name: 'Georgia', sub: 'central-asia-caucasus' },
  // Oceania
  AU: { name: 'Australia', sub: 'oceania' }, NZ: { name: 'New Zealand', sub: 'oceania' },
  // Africa
  ZA: { name: 'South Africa', sub: 'africa' }, EG: { name: 'Egypt', sub: 'africa' }, MA: { name: 'Morocco', sub: 'africa' },
  DZ: { name: 'Algeria', sub: 'africa' }, TN: { name: 'Tunisia', sub: 'africa' }, NG: { name: 'Nigeria', sub: 'africa' },
  KE: { name: 'Kenya', sub: 'africa' },
}

/** Государства-члены ЕС (27). Нужны, чтобы «EU» в рынках вендора превращалось в страны. */
export const EU_MEMBERS: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]
/** ЕЭЗ = ЕС + эти три страны. */
export const EEA_EXTRA: readonly string[] = ['IS', 'LI', 'NO']

const SUB_BY_SLUG = new Map(SUBREGIONS.map((s) => [s.slug, s]))
export const subregionBySlug = (slug: string) => SUB_BY_SLUG.get(slug as SubregionSlug)
export const continentBySlug = (slug: string) => CONTINENTS.find((c) => c.slug === slug)

export function countryNameOf(code: string | null | undefined): string | null {
  if (!code) return null
  return GEO[code]?.name ?? null
}

/** Токены одной страны: `c:DE`, `r:dach`, `k:europe`. Неизвестный код → пустой список (его ловит geoProblems). */
export function geoTokens(code: string | null | undefined): string[] {
  const g = code ? GEO[code] : undefined
  if (!g) return []
  const sub = SUB_BY_SLUG.get(g.sub)
  return [`c:${code}`, `r:${g.sub}`, `k:${sub?.continent}`]
}

export type MarketParse = {
  /** Страны, которые вендор назвал прямо или через EU / EEA. */
  codes: string[]
  /** Вендор называет EU (или EEA, которая включает EU). */
  eu: boolean
  eea: boolean
  /** Вендор пишет «worldwide» («over 80 countries» — тот же смысл: detail = worldwide / unspecified, см. s104). */
  worldwide: boolean
  /** Коды, которых нет в таблице GEO. */
  unknown: string[]
}

/** `market.detail` / `hosting.detail`: «EU,GB,US», «worldwide,AU», «unspecified». */
export function parseMarket(detail: string | null | undefined): MarketParse {
  const out: MarketParse = { codes: [], eu: false, eea: false, worldwide: false, unknown: [] }
  const seen = new Set<string>()
  const add = (c: string) => { if (!seen.has(c)) { seen.add(c); out.codes.push(c) } }
  for (const raw of String(detail ?? '').split(',')) {
    const t = raw.trim()
    if (!t || t === 'unspecified') continue
    if (t === 'worldwide') out.worldwide = true
    else if (t === 'EU') { out.eu = true; EU_MEMBERS.forEach(add) }
    else if (t === 'EEA') { out.eu = true; out.eea = true; EU_MEMBERS.forEach(add); EEA_EXTRA.forEach(add) }
    else if (GEO[t]) add(t)
    else out.unknown.push(t)
  }
  return out
}

/** Токены рынков для фильтра «Operates in». `ww` — вендор называет весь мир; `eu` — называет ЕС. */
export function marketTokens(details: readonly (string | null | undefined)[]): string[] {
  const tokens = new Set<string>()
  for (const d of details) {
    const p = parseMarket(d)
    if (p.worldwide) tokens.add('ww')
    if (p.eu) tokens.add('eu')
    for (const c of p.codes) geoTokens(c).forEach((t) => tokens.add(t))
  }
  return [...tokens]
}

/** Неизвестные коды в списке штаб-квартир и рынков — для сторожа и import:directory. */
export function geoProblems(hq: readonly (string | null | undefined)[], marketDetails: readonly (string | null | undefined)[]): string[] {
  const p: string[] = []
  for (const c of new Set(hq.filter(Boolean) as string[])) if (!GEO[c]) p.push(`hq_country «${c}» нет в таблице directoryGeo.GEO`)
  for (const d of marketDetails) for (const u of parseMarket(d).unknown) p.push(`market «${u}» нет в таблице directoryGeo.GEO (detail «${d}»)`)
  return [...new Set(p)]
}

/** Подпись токена для фильтра: `c:DE` → Germany, `r:dach` → DACH, `k:europe` → Europe, `eu` → European Union, `ww` → Worldwide. */
export function tokenLabel(token: string): string {
  if (token === 'ww') return 'Worldwide'
  if (token === 'eu') return 'European Union'
  const [kind, id] = token.split(':')
  if (kind === 'c') return GEO[id]?.name ?? id
  if (kind === 'r') return SUB_BY_SLUG.get(id as SubregionSlug)?.name ?? id
  if (kind === 'k') return continentBySlug(id)?.name ?? id
  return token
}

// ─────────────────────────── поиск и опции фильтров (s108, шаг A1b) ───────────────────────────

/**
 * Слова, по которым человек ищет страну, но которых нет в её названии (поиск идёт по подстроке: «usa» не находит
 * «United States»). Двухбуквенные коды сюда НЕ кладём: «us» нашлось бы в «use», «plus». Только латиница, нижний регистр.
 */
export const GEO_ALIASES: Readonly<Record<string, string>> = {
  US: 'usa america', GB: 'uk britain england scotland wales', AE: 'uae emirates', KR: 'korea', CZ: 'czech republic',
  NL: 'holland', DE: 'deutschland', CH: 'schweiz suisse switzerland', AT: 'osterreich', RU: 'russian federation',
  TR: 'turkiye', CN: 'prc', MK: 'macedonia', BA: 'bosnia', PH: 'philippines',
}

/** Слова страны для строки поиска: название, псевдонимы, субрегион, континент («dach», «nordics», «europe»). */
export function geoSearchWords(code: string | null | undefined): string[] {
  const g = code ? GEO[code] : undefined
  if (!g || !code) return []
  const sub = SUB_BY_SLUG.get(g.sub)
  const cont = sub ? continentBySlug(sub.continent) : undefined
  return [g.name, GEO_ALIASES[code], sub?.name, cont?.name].filter(Boolean) as string[]
}

export type GeoOption = { value: string; label: string; /** строк останется при выборе */ n: number; /** из них — назвали это место прямо */ nn: number }
export type GeoOptions = { continents: GeoOption[]; regions: GeoOption[]; countries: GeoOption[]; extra: GeoOption[] }

/**
 * Опции фильтра «Based in» / «Operates in» из токенов строк страницы (по одному списку токенов на строку).
 * `ww` = «Operates in»: вендор с токеном `ww` («worldwide») остаётся при выборе любого места, кроме самого «Worldwide».
 * Опций нет для того, чего на странице нет (нет вендоров из Африки — нет пункта «Africa»).
 */
export function geoFilterOptions(tokensOf: readonly (readonly string[])[], ww: boolean): GeoOptions {
  const present = new Set(tokensOf.flat())
  const count = (v: string, withWw: boolean) => tokensOf.filter((t) => t.includes(v) || (withWw && v !== 'ww' && t.includes('ww'))).length
  const mk = (v: string): GeoOption => ({ value: v, label: tokenLabel(v), n: count(v, ww), nn: count(v, false) })
  const byName = (a: GeoOption, b: GeoOption) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' })
  return {
    continents: CONTINENTS.map((k) => `k:${k.slug}`).filter((v) => present.has(v)).map(mk),
    regions: SUBREGIONS.map((r) => `r:${r.slug}`).filter((v) => present.has(v)).map(mk),
    countries: [...present].filter((v) => v.startsWith('c:')).map(mk).sort(byName),
    extra: ['eu', 'ww'].filter((v) => present.has(v)).map(mk),
  }
}

/**
 * Короткая подпись рынков для таблицы общего вида: «EU, United Kingdom, United States +3 more».
 * ⚠ Берёт СЫРЫЕ токены `market.detail` (EU остаётся «EU», а не 27 странами) — поэтому parseMarket здесь не годится.
 */
export function marketSummary(details: readonly (string | null | undefined)[], max = 4): string {
  const seen = new Set<string>()
  const items: string[] = []
  for (const d of details) {
    for (const raw of String(d ?? '').split(',')) {
      const t = raw.trim()
      if (!t || t === 'unspecified' || seen.has(t)) continue
      seen.add(t)
      if (t === 'worldwide') items.push('Worldwide')
      else if (t === 'EU' || t === 'EEA') items.push(t)
      else if (GEO[t]) items.push(GEO[t].name)
    }
  }
  if (items.length <= max) return items.join(', ')
  return `${items.slice(0, max).join(', ')} +${items.length - max} more`
}
