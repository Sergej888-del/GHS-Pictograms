// src/lib/reportView.ts — pure part of the report pages (s114): types, the "1 in N" wording, formatters and the builder
// that turns the metric rows of one snapshot into the preview page's numbers. No database access here, so scripts and
// tests can import it without Supabase env. The build-time loader is src/lib/reportData.ts.

export const REPORT_PREVIEW_PUBLIC = false
export const REPORT_PREVIEW_SLUG = 'ai-gap-preview'
export const REPORT_PREVIEW_PATH = `/reports/${REPORT_PREVIEW_SLUG}/`
/** When the full quarterly issue is planned (s111 handoff: Q4 2026 issue in January 2027). */
export const REPORT_FULL_ISSUE = 'January 2027'

export interface ReportSnapshot {
  id: number
  snapshot_date: string
  label: string | null
}

export interface MetricRow {
  section: string
  metric: string
  dimension: string
  n: number | null
  base: number | null
  pct: number | null
}

export interface Share {
  n: number
  base: number
  pct: number
}

export interface RegionBar {
  key: string
  label: string
  talk: Share
  product: Share
  gapPp: number
}

export interface AiGapView {
  snapshot: ReportSnapshot
  vendors: number
  countries: number | null
  /** AI Gap index, percentage points (confirmed facts). */
  gapPp: number
  talk: Share
  product: Share
  /** Share of AI talkers that show AI in the listed product. */
  proof: Share
  checks: { customer: Share; vendor: Share }
  antiAi: { warnAboutAi: number; sellAi: number; pure: number; humanFirst: number }
  /** Vendors that sell themselves on not using AI, with the base of all live vendors (s115, for the numbers table). */
  humanFirstShare: Share | null
  insurance: Share
  regions: RegionBar[]
  cover: { talk: string; product: string }
}

const REGION_LABEL: Record<string, string> = { europe: 'Europe', north_america: 'North America' }
/** Regions drawn on the chart: the two with enough vendors; "other" and "unknown" stay in the totals only. */
const CHART_REGIONS = ['europe', 'north_america'] as const

function num(v: number | string | null | undefined): number {
  return v == null ? 0 : Number(v)
}

function share(rows: MetricRow[], section: string, metric: string, dimension: string): Share | null {
  const r = rows.find((x) => x.section === section && x.metric === metric && x.dimension === dimension)
  if (!r) return null
  const n = num(r.n)
  const base = num(r.base)
  return { n, base, pct: base > 0 ? Math.round((1000 * n) / base) / 10 : 0 }
}

function scalar(rows: MetricRow[], section: string, metric: string, dimension = ''): number | null {
  const r = rows.find((x) => x.section === section && x.metric === metric && x.dimension === dimension)
  return r ? num(r.n) : null
}

/**
 * "1 in N" in words that stay true: direction 'atLeast' gives a lower bound ("more than 1 in 4" for 27 %),
 * 'atMost' an upper bound ("fewer than 1 in 8" for 11.6 %). Within 2 % of a whole N it says "1 in N".
 */
export function oneIn(pct: number, direction: 'atLeast' | 'atMost'): string {
  if (!(pct > 0)) return 'none'
  if (pct >= 100) return 'all'
  const k = 100 / pct
  const r = Math.round(k)
  if (r >= 2 && Math.abs(k - r) / k <= 0.02) return `1 in ${r}`
  if (direction === 'atLeast') {
    const c = Math.ceil(k)
    return c <= 1 ? 'all' : `more than 1 in ${c}`
  }
  const f = Math.floor(k)
  return f <= 1 ? 'fewer than all' : `fewer than 1 in ${f}`
}

const CAP = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Pure: the preview page's numbers from the metric rows of one snapshot (confirmed facts only). Null if incomplete. */
export function buildAiGapView(snapshot: ReportSnapshot, rows: MetricRow[]): AiGapView | null {
  const C = 'confirmed_only'
  const talk = share(rows, 'G', 'ai_talk', C)
  const product = share(rows, 'G', 'ai_in_product', C)
  const proof = share(rows, 'G', 'ai_proof_rate', C)
  const gapPp = scalar(rows, 'G', 'ai_gap_pp', C)
  const customer = share(rows, 'G', 'who_checks_customer_product', C)
  const vendor = share(rows, 'G', 'who_checks_vendor_product', C)
  const insurance = share(rows, 'G', 'insurance_mentioned', C)
  const vendors = scalar(rows, 'A', 'live_total')
  if (!talk || !product || !proof || gapPp == null || !customer || !vendor || !insurance || vendors == null) return null
  if (talk.base === 0) return null

  const regions: RegionBar[] = []
  for (const key of CHART_REGIONS) {
    const t = share(rows, 'G', 'ai_talk_by', `${C}|region:${key}`)
    const p = share(rows, 'G', 'ai_in_product_by', `${C}|region:${key}`)
    const g = scalar(rows, 'G', 'ai_gap_pp_by', `${C}|region:${key}`)
    if (t && p && g != null && t.base > 0) regions.push({ key, label: REGION_LABEL[key], talk: t, product: p, gapPp: g })
  }

  return {
    snapshot,
    vendors,
    countries: scalar(rows, 'A', 'hq_countries_distinct'),
    gapPp,
    talk,
    product,
    proof,
    checks: { customer, vendor },
    antiAi: {
      warnAboutAi: scalar(rows, 'G', 'human_first_vs_ai', C) ?? 0,
      sellAi: scalar(rows, 'G', 'human_first_vs_ai_selling_ai', C) ?? 0,
      pure: scalar(rows, 'G', 'human_first_vs_ai_pure', C) ?? 0,
      humanFirst: scalar(rows, 'G', 'human_first', C) ?? 0,
    },
    humanFirstShare: share(rows, 'G', 'human_first', C),
    insurance,
    regions,
    cover: { talk: CAP(oneIn(talk.pct, 'atLeast')), product: CAP(oneIn(product.pct, 'atMost')) },
  }
}

export function longDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function monthYear(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function fmtPct(v: number): string {
  return `${Math.round(v)}%`
}

export function fmtPp(v: number): string {
  return `${v.toFixed(1)} pts`
}
