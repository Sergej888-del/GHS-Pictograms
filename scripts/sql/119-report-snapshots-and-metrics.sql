-- Migration: report_snapshots_and_metrics
-- Applied via Supabase MCP on 2026-10-16 (project zhvrbrlqgntgzneggqst).
-- Archive copy for scripts/sql/. Do not re-run: tables already exist.

-- Report snapshots: one row per frozen data cut (quarterly, plus the pilot)
CREATE TABLE public.report_snapshots (
  id            serial PRIMARY KEY,
  snapshot_date date NOT NULL UNIQUE,
  label         text,                 -- e.g. 'Pilot 2026-10', 'Q4 2026'
  note          text,
  computed_at   timestamptz NOT NULL DEFAULT now()
);

-- Long-format metrics: section/metric/dimension, counts kept raw so ratios can be recomputed later
CREATE TABLE public.report_metrics (
  snapshot_id integer NOT NULL REFERENCES public.report_snapshots(id) ON DELETE CASCADE,
  section     text NOT NULL,            -- A market, B commercial, C liability, D movement, E hotlines, F demand
  metric      text NOT NULL,            -- e.g. 'live_by_category'
  dimension   text NOT NULL DEFAULT '', -- e.g. 'sds-management'; '' for scalars
  n           numeric,                  -- count or value
  base        numeric,                  -- denominator, NULL for scalars
  pct         numeric GENERATED ALWAYS AS (CASE WHEN base > 0 THEN round(100 * n / base, 1) END) STORED,
  value_text  text,                     -- for non-numeric facts (e.g. list of missing countries)
  PRIMARY KEY (snapshot_id, section, metric, dimension)
);

CREATE INDEX report_metrics_metric_idx ON public.report_metrics (section, metric, dimension);

COMMENT ON TABLE public.report_snapshots IS 'GHS Market Report: frozen data cuts of the directory + hotlines (pilot 2026-10, then quarterly). Public read; writes service_role only.';
COMMENT ON TABLE public.report_metrics IS 'GHS Market Report metrics in long format per snapshot. n/base kept raw; pct is derived. Public read; writes service_role only.';

-- Public read like directory_entries (report pages render on anon); writes service_role only
ALTER TABLE public.report_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_metrics  ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_snapshots_public_read ON public.report_snapshots FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY report_metrics_public_read  ON public.report_metrics  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.report_snapshots, public.report_metrics TO anon, authenticated;
