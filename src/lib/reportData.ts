// src/lib/reportData.ts — GHS Compliance Market Report pages: frozen snapshots read at build time (s114, 2026-10-19).
//
// Source: report_snapshots + report_metrics (scripts/sql/119, 120, 132). A snapshot is taken by hand on its date
// (`SELECT * FROM report_take_snapshot(CURRENT_DATE, '<label>')`); the pages only read it, so a page always shows the
// numbers of one frozen cut and never mixes dates.
//
// ⚠ Headline rule (Sergej, 2026-10-19): only CONFIRMED facts go into headlines. Section G writes every scalar twice:
//   dimension '' (all collected facts) and 'confirmed_only'; region breakdowns as 'confirmed_only|region:<macro>'.
//   The preview page reads the confirmed_only rows only.
// ⚠ The preview page is built only when the newest snapshot that has section G exists (getStaticPaths returns [] before
//   SQL 132 + the first snapshot), so builds stay green before the import is finished.
// ⚠ REPORT_PREVIEW_PUBLIC: false = page is built with noindex and is not in the sitemap (Sergej reviews it on the live
//   URL); true = indexed and listed in the sitemap. Decision 2026-10-19: publish after the facts are confirmed.

import { supabase } from './supabase'
import { must } from './mustQuery'
import { buildAiGapView } from './reportView'
import type { AiGapView, MetricRow, ReportSnapshot } from './reportView'

export * from './reportView'

let cache: Promise<{ snapshot: ReportSnapshot; rows: MetricRow[] } | null> | null = null

/** Newest snapshot that carries section G (AI), with its sections A and G. One read per build. */
export function loadAiSnapshot(): Promise<{ snapshot: ReportSnapshot; rows: MetricRow[] } | null> {
  if (!cache) cache = loadAiSnapshotUncached()
  return cache
}

async function loadAiSnapshotUncached(): Promise<{ snapshot: ReportSnapshot; rows: MetricRow[] } | null> {
  const snaps = must(
    'report_snapshots for /reports/',
    await supabase.from('report_snapshots').select('id, snapshot_date, label').order('snapshot_date', { ascending: false }).range(0, 19),
  ) as ReportSnapshot[]
  for (const snapshot of snaps) {
    const rows = must(
      `report_metrics snapshot ${snapshot.id}`,
      await supabase
        .from('report_metrics')
        .select('section, metric, dimension, n, base, pct')
        .eq('snapshot_id', snapshot.id)
        .in('section', ['A', 'G'])
        .order('metric')
        .range(0, 999),
    ) as MetricRow[]
    if (rows.length >= 1000) throw new Error(`build: report_metrics snapshot ${snapshot.id} reached 1000 rows for A+G — page through them`)
    if (rows.some((r) => r.section === 'G' && r.dimension === 'confirmed_only')) return { snapshot, rows }
  }
  return null
}

/** The preview view, or null while no snapshot with section G exists. Used by the page and by the sitemap. */
export async function loadAiGapView(): Promise<AiGapView | null> {
  const s = await loadAiSnapshot()
  return s ? buildAiGapView(s.snapshot, s.rows) : null
}

