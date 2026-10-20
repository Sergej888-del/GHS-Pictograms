-- 132 - GHS Compliance Market Report, section G "AI" and the AI Gap index (2026-10-19, session 114).
-- Sergej (2026-10-19): "Нам нужна уникальность информации" -> the AI chapter and its named index become a quarterly series.
-- Definitions (live entries; ai_status / ai_stance from vocabulary v2.1):
--   ai_in_product  = ai_status listing = yes (AI in the product or service listed in the directory)
--   ai_talk        = ai_in_product OR ai_status vendor_wide = yes, without detail parent_group / not_chemical_safety
--   ai_gap_pp      = AI Gap index, percentage points: (ai_talk - ai_in_product) / vendors with an AI status * 100
--   ai_proof_rate  = ai_in_product / ai_talk (pct column) - share of AI talkers that show AI in the listed product
--   ai_talk_broad  = ai_in_product OR any vendor_wide = yes (incl. parent group / other business lines): "sells or claims AI
--                    anywhere". Used for everything that asks "is this an AI vendor?": who checks the AI, AI disclaimers,
--                    human-first hybrids vs purists, the camps. The AI Gap itself uses the strict ai_talk.
--   human_first    = ai_stance human_first_positioning without detail not_chemical_safety; detail vs_ai_or_mt / vs_software
--                    says what the vendor contrasts itself with (set in the s114 review)
-- Scalars are written twice: dimension '' = all facts, dimension 'confirmed_only' = confirmed facts only (headline rule:
-- only confirmed numbers go into headlines); region / category breakdowns likewise ('confirmed_only|region:europe').
-- Region = macro region of the HQ country (europe, north_america, other, unknown).
-- Run once in the SQL Editor. Safe to re-run (CREATE OR REPLACE). Changes no data; the next snapshot writes section G.

CREATE OR REPLACE FUNCTION public.report_ai_metrics(p_snapshot_id integer)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_mode text;
  v_dim  text;
  v_talk numeric;
  v_live numeric;
  v_n    integer;
BEGIN
  DELETE FROM report_metrics m WHERE m.snapshot_id = p_snapshot_id AND m.section = 'G';

  DROP TABLE IF EXISTS _ai_g;
  CREATE TEMP TABLE _ai_g ON COMMIT DROP AS
  WITH live AS (
    SELECT e.id, e.category,
           CASE WHEN e.hq_country IN ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','GB','CH','NO','IS','LI','TR','RS','BA','ME','MK','AL') THEN 'europe'
                WHEN e.hq_country IN ('US','CA','MX') THEN 'north_america'
                WHEN e.hq_country IS NULL THEN 'unknown'
                ELSE 'other' END AS macro
    FROM directory_entries e WHERE e.state = 'live'
  ),
  modes(mode) AS (VALUES ('all'), ('confirmed')),
  agg AS (
    SELECT m.mode, f.entry_id,
      bool_or(f.kind = 'ai_status') AS known,
      bool_or(f.kind = 'ai_status' AND f.label = 'listing' AND f.status = 'yes') AS listing,
      bool_or(f.kind = 'ai_status' AND f.label = 'listing' AND f.status = 'no') AS listing_no,
      bool_or(f.kind = 'ai_status' AND f.label = 'vendor_wide' AND f.status = 'yes'
              AND coalesce(f.detail, '') NOT IN ('parent_group', 'not_chemical_safety')) AS vw,
      bool_or(f.kind = 'ai_status' AND f.label = 'vendor_wide' AND f.status = 'yes') AS vw_broad,
      bool_or(f.kind = 'ai_stance' AND f.label = 'ai_in_headline') AS headline,
      bool_or(f.kind = 'ai_stance' AND f.label = 'human_review_customer') AS rev_cust,
      bool_or(f.kind = 'ai_stance' AND f.label = 'human_review_vendor') AS rev_vend,
      bool_or(f.kind = 'ai_stance' AND f.label = 'human_only_stated') AS human_only,
      bool_or(f.kind = 'ai_stance' AND f.label = 'human_first_positioning' AND coalesce(f.detail, '') <> 'not_chemical_safety') AS hf,
      bool_or(f.kind = 'ai_stance' AND f.label = 'human_first_positioning' AND f.detail = 'vs_ai_or_mt') AS hf_ai,
      bool_or(f.kind = 'ai_stance' AND f.label = 'human_first_positioning' AND f.detail = 'vs_software') AS hf_sw,
      bool_or(f.kind = 'ai_disclaimer') AS disclaimer,
      bool_or(f.kind = 'responsibility' AND f.label = 'compliance_guarantee') AS guarantee,
      bool_or((f.kind = 'responsibility' AND f.label = 'insurance') OR (f.kind = 'liability_cap' AND f.label = 'insurance_cover')) AS insurance,
      bool_or(f.kind = 'responsibility' AND f.label = 'customer_responsible') AS customer_responsible,
      bool_or(f.kind = 'quality_process') AS quality_process
    FROM modes m
    JOIN directory_facts f ON (m.mode = 'all' OR f.confirmed IS TRUE)
    JOIN live l ON l.id = f.entry_id
    GROUP BY m.mode, f.entry_id
  )
  SELECT m.mode, l.id AS entry_id, l.category, l.macro,
         coalesce(a.known, false) AS known,
         coalesce(a.listing, false) AS listing,
         coalesce(a.listing_no, false) AS listing_no,
         coalesce(a.listing, false) OR coalesce(a.vw, false) AS talk,
         coalesce(a.listing, false) OR coalesce(a.vw_broad, false) AS talk_broad,
         coalesce(a.headline, false) AS headline,
         coalesce(a.rev_cust, false) AS rev_cust,
         coalesce(a.rev_vend, false) AS rev_vend,
         coalesce(a.human_only, false) AS human_only,
         coalesce(a.hf, false) AS hf,
         coalesce(a.hf_ai, false) AS hf_ai,
         coalesce(a.hf_sw, false) AS hf_sw,
         coalesce(a.disclaimer, false) AS disclaimer,
         coalesce(a.guarantee, false) AS guarantee,
         coalesce(a.insurance, false) AS insurance,
         coalesce(a.customer_responsible, false) AS customer_responsible,
         coalesce(a.quality_process, false) AS quality_process
  FROM live l CROSS JOIN modes m
  LEFT JOIN agg a ON a.entry_id = l.id AND a.mode = m.mode;

  -- Scalars: all facts (dimension '') and confirmed facts only (dimension 'confirmed_only')
  FOREACH v_mode IN ARRAY ARRAY['all', 'confirmed'] LOOP
    v_dim := CASE WHEN v_mode = 'all' THEN '' ELSE 'confirmed_only' END;
    INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
    SELECT p_snapshot_id, 'G', v.k, v_dim, v.n, v.b
    FROM (SELECT count(*)::numeric AS live,
                 count(*) FILTER (WHERE known)::numeric AS known,
                 count(*) FILTER (WHERE listing)::numeric AS listing,
                 count(*) FILTER (WHERE listing_no)::numeric AS listing_no,
                 count(*) FILTER (WHERE talk)::numeric AS talk,
                 count(*) FILTER (WHERE talk_broad)::numeric AS talk_broad,
                 count(*) FILTER (WHERE headline)::numeric AS headline,
                 count(*) FILTER (WHERE talk_broad AND rev_cust)::numeric AS rev_cust,
                 count(*) FILTER (WHERE talk_broad AND rev_vend)::numeric AS rev_vend,
                 count(*) FILTER (WHERE listing AND rev_cust)::numeric AS rev_cust_p,
                 count(*) FILTER (WHERE listing AND rev_vend)::numeric AS rev_vend_p,
                 count(*) FILTER (WHERE disclaimer)::numeric AS disclaimer,
                 count(*) FILTER (WHERE hf)::numeric AS hf,
                 count(*) FILTER (WHERE hf_ai)::numeric AS hf_ai,
                 count(*) FILTER (WHERE hf_sw)::numeric AS hf_sw,
                 count(*) FILTER (WHERE hf AND talk_broad)::numeric AS hf_hybrid,
                 count(*) FILTER (WHERE hf AND NOT talk_broad)::numeric AS hf_purist,
                 count(*) FILTER (WHERE hf_ai AND talk_broad)::numeric AS hf_ai_selling,
                 count(*) FILTER (WHERE hf_ai AND NOT talk_broad)::numeric AS hf_ai_pure,
                 count(*) FILTER (WHERE human_only)::numeric AS human_only,
                 count(*) FILTER (WHERE insurance)::numeric AS insurance
          FROM _ai_g WHERE mode = v_mode) s,
    LATERAL (VALUES
      ('ai_status_known',            s.known,                s.live),
      ('ai_in_product',              s.listing,              s.known),
      ('ai_explicitly_none',         s.listing_no,           s.known),
      ('ai_talk',                    s.talk,                 s.known),
      ('ai_talk_broad',              s.talk_broad,           s.known),
      ('ai_talk_not_in_product',     s.talk - s.listing,     s.talk),
      ('ai_proof_rate',              s.listing,              s.talk),
      ('ai_gap_pp',                  round(100 * (s.talk - s.listing) / nullif(s.known, 0), 1), NULL),
      ('ai_in_headline',             s.headline,             s.live),
      ('who_checks_customer',        s.rev_cust,             s.talk_broad),
      ('who_checks_vendor',          s.rev_vend,             s.talk_broad),
      ('who_checks_customer_product', s.rev_cust_p,          s.listing),
      ('who_checks_vendor_product',  s.rev_vend_p,           s.listing),
      ('ai_disclaimer_vendors',      s.disclaimer,           s.talk_broad),
      ('human_first',                s.hf,                   s.live),
      ('human_first_vs_ai',          s.hf_ai,                s.hf),
      ('human_first_vs_software',    s.hf_sw,                s.hf),
      ('human_first_hybrid',         s.hf_hybrid,            s.hf),
      ('human_first_purist',         s.hf_purist,            s.hf),
      ('human_first_vs_ai_selling_ai', s.hf_ai_selling,      s.hf_ai),
      ('human_first_vs_ai_pure',     s.hf_ai_pure,           s.live),
      ('human_only_stated',          s.human_only,           s.live),
      ('insurance_mentioned',        s.insurance,            s.live)
    ) AS v(k, n, b);
  END LOOP;

  -- Breakdowns: macro region and category; dimension 'region:europe' (all facts) and 'confirmed_only|region:europe'
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT p_snapshot_id, 'G', v.k, g.dim, v.n, v.b
  FROM (SELECT CASE WHEN mode = 'confirmed' THEN 'confirmed_only|' ELSE '' END || 'region:' || macro AS dim,
               count(*)::numeric AS live,
               count(*) FILTER (WHERE known)::numeric AS known,
               count(*) FILTER (WHERE listing)::numeric AS listing,
               count(*) FILTER (WHERE talk)::numeric AS talk,
               count(*) FILTER (WHERE hf)::numeric AS hf,
               count(*) FILTER (WHERE headline)::numeric AS headline
        FROM _ai_g GROUP BY mode, macro
        UNION ALL
        SELECT CASE WHEN mode = 'confirmed' THEN 'confirmed_only|' ELSE '' END || 'category:' || category,
               count(*), count(*) FILTER (WHERE known), count(*) FILTER (WHERE listing),
               count(*) FILTER (WHERE talk), count(*) FILTER (WHERE hf), count(*) FILTER (WHERE headline)
        FROM _ai_g GROUP BY mode, category) g,
  LATERAL (VALUES ('ai_in_product_by', g.listing, g.known),
                  ('ai_talk_by', g.talk, g.known),
                  ('ai_gap_pp_by', round(100 * (g.talk - g.listing) / nullif(g.known, 0), 1), NULL),
                  ('human_first_by', g.hf, g.live),
                  ('ai_in_headline_by', g.headline, g.live)) AS v(k, n, b);

  -- Thesis 4 (fear of error): each camp x each responsibility / process signal
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT p_snapshot_id, 'G', 'camp_x_signal', c.camp || '|' || v.k, v.n, c.size
  FROM (SELECT c.camp,
               count(*)::numeric AS size,
               count(*) FILTER (WHERE g.guarantee)::numeric AS guarantee,
               count(*) FILTER (WHERE g.insurance)::numeric AS insurance,
               count(*) FILTER (WHERE g.customer_responsible)::numeric AS customer_responsible,
               count(*) FILTER (WHERE g.quality_process)::numeric AS quality_process,
               count(*) FILTER (WHERE g.disclaimer)::numeric AS disclaimer,
               count(*) FILTER (WHERE g.rev_cust)::numeric AS rev_cust,
               count(*) FILTER (WHERE g.rev_vend)::numeric AS rev_vend
        FROM _ai_g g
        CROSS JOIN LATERAL (VALUES
          ('human_first_purist', g.hf AND NOT g.talk_broad),
          ('human_camp_no_ai',   (g.hf OR g.human_only OR g.listing_no) AND NOT g.talk_broad),
          ('ai_in_product',      g.listing),
          ('ai_elsewhere_only',  g.talk_broad AND NOT g.listing),
          ('rest',               NOT g.talk_broad AND NOT (g.hf OR g.human_only OR g.listing_no))) AS c(camp, inside)
        WHERE g.mode = 'all' AND c.inside
        GROUP BY c.camp) c,
  LATERAL (VALUES ('compliance_guarantee', c.guarantee), ('insurance', c.insurance),
                  ('customer_responsible', c.customer_responsible), ('quality_process', c.quality_process),
                  ('ai_disclaimer', c.disclaimer), ('human_review_customer', c.rev_cust),
                  ('human_review_vendor', c.rev_vend)) AS v(k, n);

  -- Label breakdowns straight from the facts (all facts, live entries)
  SELECT count(*) FILTER (WHERE talk_broad), count(*) INTO v_talk, v_live FROM _ai_g WHERE mode = 'all';
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT p_snapshot_id, 'G', x.metric, x.dim, count(DISTINCT x.entry_id), x.base
  FROM (SELECT 'ai_disclaimer_by_label' AS metric, f.label AS dim, f.entry_id, v_talk AS base
          FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.kind = 'ai_disclaimer'
        UNION ALL
        SELECT 'ai_governance_by_label', f.label, f.entry_id, v_live
          FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.kind = 'ai_governance' AND f.status = 'yes'
        UNION ALL
        SELECT 'ai_provider_by_value', f.value, f.entry_id, v_talk
          FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.kind = 'ai_provider' AND f.status = 'yes'
        UNION ALL
        SELECT 'ai_use_by_label', f.label, f.entry_id, v_talk
          FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.kind = 'ai_use' AND f.status = 'yes') x
  WHERE x.dim IS NOT NULL
  GROUP BY x.metric, x.dim, x.base;

  SELECT count(*) INTO v_n FROM report_metrics m WHERE m.snapshot_id = p_snapshot_id AND m.section = 'G';
  RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION public.report_ai_metrics(integer) IS 'GHS Market Report section G (AI): AI Gap index, who checks the AI, human-first camp, camp x responsibility signals. Called by report_take_snapshot.';
REVOKE EXECUTE ON FUNCTION public.report_ai_metrics(integer) FROM PUBLIC, anon, authenticated;

-- report_take_snapshot is re-created below unchanged from scripts/sql/120 except one line: it now calls
-- report_ai_metrics(v_id) before counting, so every snapshot also writes section G.
-- Section codes: A market structure, B commercial practices, C liability & terms, D movement,
--                E hotlines (Europe), F demand signals (own data), G AI (since 2026-10-19).

CREATE OR REPLACE FUNCTION public.report_take_snapshot(
  p_date  date DEFAULT CURRENT_DATE,
  p_label text DEFAULT NULL,
  p_since date DEFAULT NULL
)
RETURNS TABLE (snapshot_id integer, metrics_written integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_id    integer;
  v_since date := coalesce(p_since, p_date - 90);
  v_live  integer;
  v_sw    integer;   -- software: sds-authoring-software + sds-management
  v_svc   integer;   -- services: authoring-services-consultants
  v_facts integer;   -- facts attached to live entries
  v_eur   integer;   -- European hotline countries (all except US)
  v_svc_eu integer;  -- European hotline services
  v_eu27  text[] := ARRAY['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'];
  v_count integer;
BEGIN
  INSERT INTO report_snapshots (snapshot_date, label, note)
  VALUES (p_date, p_label, 'Computed from live tables at run time; movement window ' || v_since || '..' || p_date)
  ON CONFLICT (snapshot_date) DO UPDATE
    SET label = coalesce(EXCLUDED.label, report_snapshots.label),
        note = EXCLUDED.note,
        computed_at = now()
  RETURNING id INTO v_id;

  DELETE FROM report_metrics m WHERE m.snapshot_id = v_id;

  SELECT count(*) INTO v_live FROM directory_entries WHERE state = 'live';
  SELECT count(*) INTO v_sw   FROM directory_entries WHERE state = 'live' AND category IN ('sds-authoring-software','sds-management');
  SELECT count(*) INTO v_svc  FROM directory_entries WHERE state = 'live' AND category = 'authoring-services-consultants';
  SELECT count(*) INTO v_facts FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live';
  SELECT count(*) INTO v_eur  FROM emergency_countries WHERE country_code <> 'US';
  SELECT count(*) INTO v_svc_eu FROM emergency_services WHERE country_code <> 'US';

  ------------------------------------------------------------------
  -- A. Market structure
  ------------------------------------------------------------------
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'A', 'entries_by_state', state, count(*), (SELECT count(*) FROM directory_entries) FROM directory_entries GROUP BY state;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  VALUES (v_id, 'A', 'live_total', '', v_live, NULL),
         (v_id, 'A', 'software_total', '', v_sw, v_live),
         (v_id, 'A', 'services_total', '', v_svc, v_live);

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'A', 'live_by_tier', tier, count(*), v_live FROM directory_entries WHERE state = 'live' GROUP BY tier;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'A', 'live_by_category', category, count(*), v_live FROM directory_entries WHERE state = 'live' GROUP BY category;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'A', 'services_by_subcategory', coalesce(subcategory, 'none'), count(*), v_svc
  FROM directory_entries WHERE state = 'live' AND category = 'authoring-services-consultants' GROUP BY subcategory;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'A', 'live_by_hq_country', coalesce(hq_country, 'unknown'), count(*), v_live FROM directory_entries WHERE state = 'live' GROUP BY hq_country;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  VALUES (v_id, 'A', 'hq_countries_distinct', '', (SELECT count(DISTINCT hq_country) FROM directory_entries WHERE state = 'live'), NULL);

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'A', 'live_by_region', r.region, count(*), v_live
  FROM (SELECT CASE WHEN hq_country = ANY(v_eu27) THEN 'EU27'
                    WHEN hq_country = 'GB' THEN 'UK'
                    WHEN hq_country IN ('NO','CH','IS','LI') THEN 'EFTA'
                    WHEN hq_country = 'US' THEN 'US'
                    WHEN hq_country = 'CA' THEN 'CA'
                    WHEN hq_country IS NULL THEN 'unknown'
                    ELSE 'rest_of_world' END AS region
        FROM directory_entries WHERE state = 'live') r
  GROUP BY r.region;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'A', 'category_x_region', r.category || '|' || r.region, count(*), sum(count(*)) OVER (PARTITION BY r.category)
  FROM (SELECT category,
               CASE WHEN hq_country = ANY(v_eu27) THEN 'EU27'
                    WHEN hq_country = 'GB' THEN 'UK'
                    WHEN hq_country IN ('NO','CH','IS','LI') THEN 'EFTA'
                    WHEN hq_country = 'US' THEN 'US'
                    WHEN hq_country = 'CA' THEN 'CA'
                    WHEN hq_country IS NULL THEN 'unknown'
                    ELSE 'rest_of_world' END AS region
        FROM directory_entries WHERE state = 'live') r
  GROUP BY r.category, r.region;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  VALUES (v_id, 'A', 'multi_category_entries', '', (SELECT count(*) FROM directory_entries WHERE state = 'live' AND cardinality(also_in) > 0), v_live),
         (v_id, 'A', 'categories_per_entry_avg', '', (SELECT round(avg(1 + cardinality(also_in)), 2) FROM directory_entries WHERE state = 'live'), NULL),
         (v_id, 'A', 'claimed_entries', '', (SELECT count(*) FROM directory_entries WHERE state = 'live' AND tier = 'claimed'), v_live),
         (v_id, 'A', 'owner_confirmed_entries', '', (SELECT count(*) FROM directory_entries WHERE state = 'live' AND owner_confirmed_on IS NOT NULL), v_live),
         (v_id, 'A', 'owner_provided_facts', '', (SELECT count(*) FROM directory_facts WHERE provided_by = 'owner'), NULL),
         (v_id, 'A', 'entries_with_logo', '', (SELECT count(*) FROM directory_entries WHERE state = 'live' AND logo_path IS NOT NULL), v_live);

  -- Founding year
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'A', m.k, '', m.v, m.b
  FROM (SELECT count(*) AS n_with,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY f.num) AS med,
               min(f.num) AS mn, max(f.num) AS mx,
               count(*) FILTER (WHERE f.num >= 2015) AS n_2015,
               count(*) FILTER (WHERE f.num < 2000)  AS n_pre2000
        FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
        WHERE f.kind = 'founded' AND f.num IS NOT NULL) s,
  LATERAL (VALUES ('founded_entries_with_year', s.n_with::numeric, v_live::numeric),
                  ('founded_median_year', round(s.med::numeric), NULL::numeric),
                  ('founded_median_age_years', round(extract(year FROM p_date) - s.med::numeric), NULL),
                  ('founded_oldest_year', s.mn, NULL),
                  ('founded_newest_year', s.mx, NULL),
                  ('founded_2015_or_later', s.n_2015::numeric, s.n_with::numeric),
                  ('founded_before_2000', s.n_pre2000::numeric, s.n_with::numeric)) AS m(k, v, b);

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'A', 'founded_by_decade', ((f.num::int / 10) * 10)::text || 's', count(*), sum(count(*)) OVER ()
  FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
  WHERE f.kind = 'founded' AND f.num IS NOT NULL
  GROUP BY (f.num::int / 10);

  -- Data quality (for the methodology page)
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  VALUES (v_id, 'A', 'facts_total', '', v_facts, NULL),
         (v_id, 'A', 'facts_confirmed', '', (SELECT count(*) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.confirmed), v_facts),
         (v_id, 'A', 'facts_per_entry_avg', '', round(v_facts::numeric / nullif(v_live, 0), 1), NULL),
         (v_id, 'A', 'source_urls_distinct', '', (SELECT count(DISTINCT f.source_url) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'), NULL),
         (v_id, 'A', 'verification_median_days', '', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (p_date - last_verified)) FROM directory_entries WHERE state = 'live'), NULL),
         (v_id, 'A', 'facts_checked_last_30d', '', (SELECT count(*) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.checked_on >= p_date - 30), v_facts);

  ------------------------------------------------------------------
  -- B. Commercial practices
  ------------------------------------------------------------------
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', 'pricing_model', f.value, count(DISTINCT f.entry_id),
         (SELECT count(DISTINCT f2.entry_id) FROM directory_facts f2 JOIN directory_entries e2 ON e2.id = f2.entry_id AND e2.state = 'live' WHERE f2.kind = 'pricing_model')
  FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
  WHERE f.kind = 'pricing_model' GROUP BY f.value;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  VALUES (v_id, 'B', 'pricing_on_request_software', '', (SELECT count(DISTINCT f.entry_id) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' AND e.category IN ('sds-authoring-software','sds-management') WHERE f.kind = 'pricing_model' AND f.value = 'On request'), v_sw),
         (v_id, 'B', 'pricing_on_request_services', '', (SELECT count(DISTINCT f.entry_id) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' AND e.category = 'authoring-services-consultants' WHERE f.kind = 'pricing_model' AND f.value = 'On request'), v_svc),
         (v_id, 'B', 'price_confirmed_entries', '', (SELECT count(DISTINCT f.entry_id) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.kind = 'price' AND f.confirmed), v_live),
         (v_id, 'B', 'price_confirmed_software', '', (SELECT count(DISTINCT f.entry_id) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' AND e.category IN ('sds-authoring-software','sds-management') WHERE f.kind = 'price' AND f.confirmed), v_sw),
         (v_id, 'B', 'price_confirmed_services', '', (SELECT count(DISTINCT f.entry_id) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' AND e.category = 'authoring-services-consultants' WHERE f.kind = 'price' AND f.confirmed), v_svc),
         (v_id, 'B', 'pricing_url_entries', '', (SELECT count(*) FROM directory_entries WHERE state = 'live' AND pricing_url IS NOT NULL), v_live),
         (v_id, 'B', 'pricing_statement_entries', '', (SELECT count(DISTINCT f.entry_id) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.kind = 'pricing_statement'), v_live),
         (v_id, 'B', 'free_trial_software', '', (SELECT count(DISTINCT f.entry_id) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' AND e.category IN ('sds-authoring-software','sds-management') WHERE f.kind = 'free_trial'), v_sw),
         (v_id, 'B', 'api_entries', '', (SELECT count(DISTINCT f.entry_id) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.kind = 'api'), v_sw),
         (v_id, 'B', 'integration_entries', '', (SELECT count(DISTINCT f.entry_id) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.kind = 'integration'), v_live),
         (v_id, 'B', 'mobile_app_entries', '', (SELECT count(DISTINCT f.entry_id) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.kind = 'platform' AND (f.value ILIKE '%ios%' OR f.value ILIKE '%android%')), v_sw),
         (v_id, 'B', 'ufi_pcn_entries', '', (SELECT count(DISTINCT f.entry_id) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.kind = 'ufi_pcn'), v_live);

  -- Price statistics per currency: dimension = currency|stat (n, min, median, max)
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', 'price_plan_flat_month', s.currency || '|' || m.k, m.v, NULL
  FROM (SELECT coalesce(f.currency,'NA') AS currency, count(*) AS n, min(f.num) AS mn, percentile_cont(0.5) WITHIN GROUP (ORDER BY f.num) AS md, max(coalesce(f.num_max, f.num)) AS mx
        FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
        WHERE f.kind = 'price' AND f.confirmed AND f.unit = 'flat' AND f.period = 'month' AND f.price_role = 'plan' AND f.num IS NOT NULL
        GROUP BY f.currency) s,
  LATERAL (VALUES ('n', s.n::numeric), ('min', s.mn), ('median', round(s.md::numeric, 2)), ('max', s.mx)) AS m(k, v);

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', 'price_plan_flat_year', s.currency || '|' || m.k, m.v, NULL
  FROM (SELECT coalesce(f.currency,'NA') AS currency, count(*) AS n, min(f.num) AS mn, percentile_cont(0.5) WITHIN GROUP (ORDER BY f.num) AS md, max(coalesce(f.num_max, f.num)) AS mx
        FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
        WHERE f.kind = 'price' AND f.confirmed AND f.unit = 'flat' AND f.period = 'year' AND f.price_role = 'plan' AND f.num IS NOT NULL
        GROUP BY f.currency) s,
  LATERAL (VALUES ('n', s.n::numeric), ('min', s.mn), ('median', round(s.md::numeric, 2)), ('max', s.mx)) AS m(k, v);

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', 'price_per_user_month', s.currency || '|' || m.k, m.v, NULL
  FROM (SELECT coalesce(f.currency,'NA') AS currency, count(*) AS n, min(f.num) AS mn, percentile_cont(0.5) WITHIN GROUP (ORDER BY f.num) AS md, max(coalesce(f.num_max, f.num)) AS mx
        FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
        WHERE f.kind = 'price' AND f.confirmed AND f.unit = 'user' AND f.period = 'month' AND f.num IS NOT NULL
        GROUP BY f.currency) s,
  LATERAL (VALUES ('n', s.n::numeric), ('min', s.mn), ('median', round(s.md::numeric, 2)), ('max', s.mx)) AS m(k, v);

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', 'price_sds_authoring_oneoff', s.currency || '|' || m.k, m.v, NULL
  FROM (SELECT coalesce(f.currency,'NA') AS currency, count(*) AS n, min(f.num) AS mn, percentile_cont(0.5) WITHIN GROUP (ORDER BY f.num) AS md, max(coalesce(f.num_max, f.num)) AS mx
        FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
        WHERE f.kind = 'price' AND f.confirmed AND f.unit = 'sds' AND f.price_role = 'service'
          AND coalesce(f.period, 'one_off') = 'one_off' AND coalesce(f.unit_qty, 1) = 1 AND f.num IS NOT NULL
        GROUP BY f.currency) s,
  LATERAL (VALUES ('n', s.n::numeric), ('min', s.mn), ('median', round(s.md::numeric, 2)), ('max', s.mx)) AS m(k, v);

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', 'price_per_word', s.currency || '|' || m.k, m.v, NULL
  FROM (SELECT coalesce(f.currency,'NA') AS currency, count(*) AS n, min(f.num) AS mn, percentile_cont(0.5) WITHIN GROUP (ORDER BY f.num) AS md, max(coalesce(f.num_max, f.num)) AS mx
        FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
        WHERE f.kind = 'price' AND f.confirmed AND f.unit = 'word' AND f.num IS NOT NULL
        GROUP BY f.currency) s,
  LATERAL (VALUES ('n', s.n::numeric), ('min', s.mn), ('median', round(s.md::numeric, 3)), ('max', s.mx)) AS m(k, v);

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', 'price_units', coalesce(f.unit,'-') || '/' || coalesce(f.period,'-') || '/' || coalesce(f.price_role,'-'), count(*), sum(count(*)) OVER ()
  FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
  WHERE f.kind = 'price' AND f.confirmed GROUP BY f.unit, f.period, f.price_role;

  -- Distribution facts: dimension = value, base = entries having that fact kind
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', k.metric, f.value, count(DISTINCT f.entry_id),
         (SELECT count(DISTINCT f2.entry_id) FROM directory_facts f2 JOIN directory_entries e2 ON e2.id = f2.entry_id AND e2.state = 'live' WHERE f2.kind = k.kind)
  FROM (VALUES ('deployment','deployment'), ('format','format'), ('jurisdiction','jurisdiction'),
               ('regulation','regulation_cited'), ('certification','certification'), ('sector','sector')) AS k(kind, metric)
  JOIN directory_facts f ON f.kind = k.kind
  JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
  GROUP BY k.metric, k.kind, f.value;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', k.metric, '', count(DISTINCT f.entry_id), v_live
  FROM (VALUES ('jurisdiction','jurisdiction_entries'), ('jurisdiction_claim','jurisdiction_claim_entries'),
               ('regulation','regulation_cited_entries'), ('certification','certification_entries'),
               ('iso17100','iso17100_entries'), ('sector','sector_entries'), ('hosting','hosting_entries'),
               ('language','language_entries'), ('deployment','deployment_entries'), ('format','format_entries')) AS k(kind, metric)
  JOIN directory_facts f ON f.kind = k.kind
  JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
  GROUP BY k.metric;

  -- Jurisdiction combinations
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', m.k, '', m.v, j.total
  FROM (SELECT count(*) AS total,
               count(*) FILTER (WHERE arr @> ARRAY['EU CLP'] AND arr @> ARRAY['US OSHA HCS']) AS both_eu_us,
               count(*) FILTER (WHERE arr = ARRAY['EU CLP']) AS eu_only,
               count(*) FILTER (WHERE arr = ARRAY['US OSHA HCS']) AS us_only,
               round(avg(cardinality(arr)), 2) AS avg_n
        FROM (SELECT f.entry_id, array_agg(f.value ORDER BY f.value) AS arr
              FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
              WHERE f.kind = 'jurisdiction' GROUP BY f.entry_id) x) j,
  LATERAL (VALUES ('jurisdiction_eu_and_us', j.both_eu_us::numeric), ('jurisdiction_eu_only', j.eu_only::numeric),
                  ('jurisdiction_us_only', j.us_only::numeric), ('jurisdiction_avg_per_entry', j.avg_n)) AS m(k, v);

  -- Hosting region (regex classification of free-text hosting facts; review when vocabulary changes)
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', 'hosting_region', h.region, count(DISTINCT h.entry_id), sum(count(DISTINCT h.entry_id)) OVER ()
  FROM (SELECT f.entry_id,
               CASE WHEN f.value ~* '(EU|Europe|European|Germany|Ireland|Finland|Netherlands|Frankfurt)' AND f.value !~* 'United States' THEN 'EU/Europe'
                    WHEN f.value ~* '(United States|\mUS\M|USA)' AND f.value !~* '(EU|Europe)' THEN 'US'
                    WHEN f.value ~* '(on-premises|customer|chosen|dedicated|options|close to the customer|three global)' THEN 'customer choice / multi-region'
                    ELSE 'region not stated' END AS region
        FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
        WHERE f.kind = 'hosting') h
  GROUP BY h.region;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', 'hosting_provider', p.provider, count(DISTINCT f.entry_id), NULL
  FROM (VALUES ('AWS', '(AWS|Amazon)'), ('Azure', 'Azure'), ('Google Cloud', '(Google Cloud|GCP)')) AS p(provider, rx)
  JOIN directory_facts f ON f.kind = 'hosting' AND f.value ~* p.rx
  JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
  GROUP BY p.provider;

  -- Languages
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', m.k, '', m.v, m.b
  FROM (SELECT count(DISTINCT f.entry_id) FILTER (WHERE f.num IS NOT NULL) AS n_num,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY f.num) AS med,
               max(f.num) AS mx,
               count(DISTINCT f.entry_id) FILTER (WHERE f.num >= 24) AS n_24,
               count(DISTINCT f.entry_id) FILTER (WHERE f.unit = 'eu_official') AS n_eu_official
        FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
        WHERE f.kind = 'language') s,
  LATERAL (VALUES ('language_numeric_entries', s.n_num::numeric, v_live::numeric),
                  ('language_median', round(s.med::numeric), NULL::numeric),
                  ('language_max', s.mx, NULL),
                  ('language_24_plus_entries', s.n_24::numeric, s.n_num::numeric),
                  ('language_all_eu_official_entries', s.n_eu_official::numeric, v_live::numeric)) AS m(k, v, b);

  -- Turnaround (hours converted to days)
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'B', m.k, '', m.v, m.b
  FROM (SELECT count(DISTINCT t.entry_id) AS n_entries, count(*) AS n_facts,
               min(t.d_min) AS fastest, percentile_cont(0.5) WITHIN GROUP (ORDER BY t.d_max) AS med_upper, max(t.d_max) AS slowest,
               count(*) FILTER (WHERE t.d_max <= 1) AS express
        FROM (SELECT f.entry_id,
                     CASE WHEN f.unit = 'hours' THEN f.num / 24.0 ELSE f.num END AS d_min,
                     CASE WHEN f.unit = 'hours' THEN coalesce(f.num_max, f.num) / 24.0 ELSE coalesce(f.num_max, f.num) END AS d_max
              FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
              WHERE f.kind = 'turnaround' AND f.num IS NOT NULL) t) s,
  LATERAL (VALUES ('turnaround_entries', s.n_entries::numeric, v_svc::numeric),
                  ('turnaround_facts', s.n_facts::numeric, NULL::numeric),
                  ('turnaround_fastest_days', round(s.fastest::numeric, 2), NULL),
                  ('turnaround_median_upper_days', round(s.med_upper::numeric, 1), NULL),
                  ('turnaround_slowest_days', round(s.slowest::numeric, 1), NULL),
                  ('turnaround_express_le_1_day_facts', s.express::numeric, s.n_facts::numeric)) AS m(k, v, b);

  ------------------------------------------------------------------
  -- C. Liability & terms
  ------------------------------------------------------------------
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'C', 'terms_kind', coalesce(terms_kind, 'not_checked'), count(*), v_live FROM directory_entries WHERE state = 'live' GROUP BY terms_kind;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'C', 'terms_kind_by_category', category || '|' || coalesce(terms_kind, 'not_checked'), count(*), sum(count(*)) OVER (PARTITION BY category)
  FROM directory_entries WHERE state = 'live' GROUP BY category, terms_kind;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  VALUES (v_id, 'C', 'terms_document_entries', '', (SELECT count(*) FROM directory_entries WHERE state = 'live' AND terms_kind IN ('html','pdf')), v_live),
         (v_id, 'C', 'terms_dated_entries', '', (SELECT count(*) FROM directory_entries WHERE state = 'live' AND terms_dated IS NOT NULL), v_live),
         (v_id, 'C', 'terms_doc_url_entries', '', (SELECT count(*) FROM directory_entries WHERE state = 'live' AND terms_doc_url IS NOT NULL), v_live),
         (v_id, 'C', 'responsibility_entries', '', (SELECT count(DISTINCT f.entry_id) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.kind = 'responsibility' AND f.confirmed), v_live),
         (v_id, 'C', 'responsibility_facts', '', (SELECT count(*) FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live' WHERE f.kind = 'responsibility' AND f.confirmed), NULL);

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'C', 'responsibility_source', coalesce(f.source_kind, 'unknown'), count(*), sum(count(*)) OVER ()
  FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
  WHERE f.kind = 'responsibility' AND f.confirmed GROUP BY f.source_kind;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'C', 'responsibility_label', coalesce(f.label, 'unlabelled'), count(*), sum(count(*)) OVER ()
  FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
  WHERE f.kind = 'responsibility' AND f.confirmed GROUP BY f.label;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'C', 'responsibility_entries_by_category', e.category, count(DISTINCT f.entry_id),
         (SELECT count(*) FROM directory_entries e2 WHERE e2.state = 'live' AND e2.category = e.category)
  FROM directory_facts f JOIN directory_entries e ON e.id = f.entry_id AND e.state = 'live'
  WHERE f.kind = 'responsibility' AND f.confirmed GROUP BY e.category;

  ------------------------------------------------------------------
  -- D. Movement (window v_since..p_date) and lifecycle
  ------------------------------------------------------------------
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  VALUES (v_id, 'D', 'closed_entries', '', (SELECT count(*) FROM directory_entries WHERE state = 'closed'), NULL),
         (v_id, 'D', 'closed_with_successor', '', (SELECT count(*) FROM directory_entries WHERE state = 'closed' AND successor IS NOT NULL), (SELECT count(*) FROM directory_entries WHERE state = 'closed')),
         (v_id, 'D', 'not_listed_entries', '', (SELECT count(*) FROM directory_entries WHERE state = 'not-listed'), NULL),
         (v_id, 'D', 'entries_added_window', '', (SELECT count(*) FROM directory_entries WHERE created_at::date > v_since AND created_at::date <= p_date), NULL),
         (v_id, 'D', 'entry_versions_changed_window', '', (SELECT count(*) FROM directory_entry_history WHERE valid_to > v_since AND valid_to <= p_date), NULL),
         (v_id, 'D', 'fact_versions_changed_window', '', (SELECT count(*) FROM directory_fact_history WHERE end_reason = 'changed' AND valid_to > v_since AND valid_to <= p_date), NULL),
         (v_id, 'D', 'fact_versions_removed_window', '', (SELECT count(*) FROM directory_fact_history WHERE end_reason = 'removed' AND valid_to > v_since AND valid_to <= p_date), NULL),
         (v_id, 'D', 'clicks_window', '', (SELECT count(*) FROM directory_clicks WHERE created_at::date > v_since AND created_at::date <= p_date), NULL),
         (v_id, 'D', 'clicks_window_visitors', '', (SELECT count(DISTINCT visitor_id) FROM directory_clicks WHERE created_at::date > v_since AND created_at::date <= p_date), NULL),
         (v_id, 'D', 'clicks_all_time', '', (SELECT count(*) FROM directory_clicks), NULL);

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'D', 'clicks_window_by_category', e.category, count(*), sum(count(*)) OVER ()
  FROM directory_clicks c JOIN directory_entries e ON e.id = c.entry_id
  WHERE c.created_at::date > v_since AND c.created_at::date <= p_date GROUP BY e.category;

  ------------------------------------------------------------------
  -- E. Hotlines (Europe = every country except US)
  ------------------------------------------------------------------
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base, value_text)
  VALUES (v_id, 'E', 'countries_total', '', (SELECT count(*) FROM emergency_countries), NULL, NULL),
         (v_id, 'E', 'countries_europe', '', v_eur, NULL, NULL),
         (v_id, 'E', 'countries_europe_live', '', (SELECT count(*) FROM emergency_countries WHERE country_code <> 'US' AND state = 'live'), v_eur, NULL),
         (v_id, 'E', 'eu27_covered', '', (SELECT count(*) FROM emergency_countries WHERE country_code = ANY(v_eu27)), 27, NULL),
         (v_id, 'E', 'eu27_missing', '', NULL, NULL, coalesce((SELECT string_agg(cc, ',' ORDER BY cc) FROM unnest(v_eu27) AS cc WHERE cc NOT IN (SELECT country_code FROM emergency_countries)), 'none')),
         (v_id, 'E', 'efta_covered', '', NULL, NULL, coalesce((SELECT string_agg(country_code, ',' ORDER BY country_code) FROM emergency_countries WHERE country_code IN ('NO','IS','LI','CH')), 'none')),
         (v_id, 'E', 'countries_with_general_number', '', (SELECT count(*) FROM emergency_countries WHERE country_code <> 'US' AND general_number IS NOT NULL), v_eur, NULL),
         (v_id, 'E', 'countries_sds_rule_checked', '', (SELECT count(*) FROM emergency_countries WHERE country_code <> 'US' AND sds_rule_checked_on IS NOT NULL), v_eur, NULL),
         (v_id, 'E', 'services_total', '', (SELECT count(*) FROM emergency_services), NULL, NULL),
         (v_id, 'E', 'services_europe', '', v_svc_eu, NULL, NULL),
         (v_id, 'E', 'services_europe_live', '', (SELECT count(*) FROM emergency_services WHERE country_code <> 'US' AND state = 'live'), v_svc_eu, NULL),
         (v_id, 'E', 'services_with_phone', '', (SELECT count(*) FROM emergency_services WHERE country_code <> 'US' AND phone_tel IS NOT NULL), v_svc_eu, NULL),
         (v_id, 'E', 'services_with_cost_note', '', (SELECT count(*) FROM emergency_services WHERE country_code <> 'US' AND cost_note IS NOT NULL), v_svc_eu, NULL),
         (v_id, 'E', 'services_with_languages', '', (SELECT count(*) FROM emergency_services WHERE country_code <> 'US' AND cardinality(languages) > 0), v_svc_eu, NULL),
         (v_id, 'E', 'services_per_country_avg', '', round(v_svc_eu::numeric / nullif(v_eur, 0), 2), NULL, NULL);

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'E', 'sds_rule_kind_europe', coalesce(sds_rule_kind, 'unknown'), count(*), v_eur FROM emergency_countries WHERE country_code <> 'US' GROUP BY sds_rule_kind;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'E', 'sds_rule_kind_eu27', coalesce(sds_rule_kind, 'unknown'), count(*), (SELECT count(*) FROM emergency_countries WHERE country_code = ANY(v_eu27))
  FROM emergency_countries WHERE country_code = ANY(v_eu27) GROUP BY sds_rule_kind;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'E', k.metric, coalesce(k.val, 'unknown'), count(*), v_svc_eu
  FROM (SELECT 'services_kind' AS metric, kind AS val FROM emergency_services WHERE country_code <> 'US'
        UNION ALL SELECT 'services_hours', hours_kind FROM emergency_services WHERE country_code <> 'US'
        UNION ALL SELECT 'services_audience', audience FROM emergency_services WHERE country_code <> 'US'
        UNION ALL SELECT 'services_sds_use', sds_use FROM emergency_services WHERE country_code <> 'US'
        UNION ALL SELECT 'services_verification', verification FROM emergency_services WHERE country_code <> 'US') k
  GROUP BY k.metric, k.val;

  -- Per-country rows (Europe)
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base, value_text)
  SELECT v_id, 'E', 'country_services', c.country_code, count(s.id), NULL, c.sds_rule_kind
  FROM emergency_countries c LEFT JOIN emergency_services s ON s.country_code = c.country_code
  WHERE c.country_code <> 'US' GROUP BY c.country_code, c.sds_rule_kind;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'E', 'country_services_24_7', c.country_code, count(s.id) FILTER (WHERE s.hours_kind = '24_7'), count(s.id)
  FROM emergency_countries c LEFT JOIN emergency_services s ON s.country_code = c.country_code
  WHERE c.country_code <> 'US' GROUP BY c.country_code;

  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  SELECT v_id, 'E', m.k, '', m.v, v_eur
  FROM (SELECT count(*) FILTER (WHERE pc.services = 0) AS zero_svc,
               count(*) FILTER (WHERE pc.svc_24_7 > 0) AS with_24_7,
               count(*) FILTER (WHERE pc.svc_official > 0) AS with_official,
               count(*) FILTER (WHERE pc.svc_contract > 0) AS with_contract
        FROM (SELECT c.country_code, count(s.id) AS services,
                     count(s.id) FILTER (WHERE s.hours_kind = '24_7') AS svc_24_7,
                     count(s.id) FILTER (WHERE s.sds_use IN ('listed_in_register','national_body_for_sds')) AS svc_official,
                     count(s.id) FILTER (WHERE s.sds_use = 'by_contract_only') AS svc_contract
              FROM emergency_countries c LEFT JOIN emergency_services s ON s.country_code = c.country_code
              WHERE c.country_code <> 'US' GROUP BY c.country_code) pc) s,
  LATERAL (VALUES ('countries_zero_services', s.zero_svc::numeric), ('countries_with_24_7', s.with_24_7::numeric),
                  ('countries_with_official_sds_body', s.with_official::numeric), ('countries_with_contract_only', s.with_contract::numeric)) AS m(k, v);

  ------------------------------------------------------------------
  -- F. Demand signals (own data, totals)
  ------------------------------------------------------------------
  INSERT INTO report_metrics (snapshot_id, section, metric, dimension, n, base)
  VALUES (v_id, 'F', 'leads_total', '', (SELECT count(*) FROM leads), NULL),
         (v_id, 'F', 'tool_search_miss_total', '', (SELECT count(*) FROM tool_search_miss), NULL),
         (v_id, 'F', 'feature_interest_total', '', (SELECT count(*) FROM feature_interest), NULL),
         (v_id, 'F', 'tool_feedback_total', '', (SELECT count(*) FROM tool_feedback), NULL);

  ------------------------------------------------------------------
  -- G. AI (s114): see public.report_ai_metrics
  ------------------------------------------------------------------
  PERFORM public.report_ai_metrics(v_id);

  SELECT count(*) INTO v_count FROM report_metrics m WHERE m.snapshot_id = v_id;
  RETURN QUERY SELECT v_id, v_count;
END;
$$;

COMMENT ON FUNCTION public.report_take_snapshot(date, text, date) IS 'GHS Market Report: compute all metrics into report_metrics for one snapshot date. Run on the snapshot date. Not callable by anon/authenticated.';

REVOKE EXECUTE ON FUNCTION public.report_take_snapshot(date, text, date) FROM PUBLIC, anon, authenticated;
