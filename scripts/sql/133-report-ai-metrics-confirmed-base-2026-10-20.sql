-- 133 - fix for report_ai_metrics (SQL 132), 2026-10-20 s114: the confirmed_only figures used a wrong base.
-- Found on the first snapshot (id 2): "vendors with an AI status" counted only 81 of 356 in confirmed_only, because an
-- ai_status fact with status not_stated has no evidence, so check:directory can never confirm it. The base therefore
-- shrank to vendors with a confirmed AI claim and the shares went to 90 %.
-- Rule now: in confirmed_only every POSITIVE claim (AI in product, AI talk, AI explicitly none, stances, disclaimers,
-- guarantees, insurance, quality steps) must be confirmed; the base "has an AI status" counts all facts, confirmed or not.
-- Applied as a text patch of the live function (same pattern as the report_take_snapshot step of 132), then re-run the
-- snapshot of the day: SELECT * FROM report_take_snapshot(CURRENT_DATE, 'v2.1 2026-10');  (idempotent per date)
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.report_ai_metrics(integer)'::regprocedure);
  IF position('JOIN directory_facts f ON true' in d) = 0 THEN
    IF position('JOIN directory_facts f ON (m.mode = ''all'' OR f.confirmed IS TRUE)' in d) = 0 THEN
      RAISE EXCEPTION '133: join anchor not found in report_ai_metrics';
    END IF;
    d := replace(d, 'JOIN directory_facts f ON (m.mode = ''all'' OR f.confirmed IS TRUE)', 'JOIN directory_facts f ON true');
    d := replace(d, 'bool_or(f.kind', 'bool_or((m.mode = ''all'' OR f.confirmed IS TRUE) AND f.kind');
    d := replace(d, 'bool_or((f.kind = ''responsibility'' AND f.label = ''insurance'') OR (f.kind = ''liability_cap'' AND f.label = ''insurance_cover''))',
                    'bool_or((m.mode = ''all'' OR f.confirmed IS TRUE) AND ((f.kind = ''responsibility'' AND f.label = ''insurance'') OR (f.kind = ''liability_cap'' AND f.label = ''insurance_cover'')))');
    d := replace(d, 'bool_or((m.mode = ''all'' OR f.confirmed IS TRUE) AND f.kind = ''ai_status'') AS known', 'bool_or(f.kind = ''ai_status'') AS known');
    EXECUTE d;
  END IF;
END
$do$;
