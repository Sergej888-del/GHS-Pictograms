-- 128 - step 3b recode (2026-10-19): legacy wording of closed-list facts -> vocabulary v2 codes.
--
-- Same mapping as the new seed scripts/data/directory-v3.json (generated together): vocabulary legacy
-- arrays (src/lib/directoryVocab.ts, copied into directory_vocab) + a reviewed integration map.
-- Apply BEFORE the next import:directory: the import keeps a confirmation only when value/quote/evidence/
-- source_url are unchanged, so the database must already hold the codes when the seed arrives.
--
-- History: nothing is lost. directory_snapshot() closes every old version (old wording stays in
-- directory_fact_history) and opens the coded one. Closed versions of recoded facts get the new end_reason
-- 'recoded'; the report metric fact_versions_changed_window counts end_reason = 'changed' only, so a
-- wording change is not reported as market movement.
--
-- Safety: every step checks its row count; at the end the md5 of (id, kind, label, value, detail) over all
-- facts must equal the md5 of the new seed (8c85d3abbf24ac524c49d0e69e081731). Any mismatch aborts the whole transaction.
--
-- Counts: 661 values (by vocabulary: billing_model 2, certification 39, deployment 194, format 31, platform 47, pricing_model 181, sector 37, service_scope 99; platform split parents 2;
-- integration 29), 219 labels (jurisdiction role 209, free_trial 10), 161 jurisdiction
-- country codes; 12 split parts inserted; 4 duplicate integration wordings removed.

BEGIN;

-- 0. History: a third end reason for wording-only changes.
ALTER TABLE public.directory_fact_history DROP CONSTRAINT directory_fact_history_end_chk;
ALTER TABLE public.directory_fact_history ADD CONSTRAINT directory_fact_history_end_chk CHECK (
  ((valid_to IS NULL) = (end_reason IS NULL))
  AND (end_reason IS NULL OR end_reason = ANY (ARRAY['changed'::text, 'removed'::text, 'recoded'::text])));

-- 1. Vocabulary copy (mirrors CODES in src/lib/directoryVocab.ts): hardware and label stock are bought, not
--    licensed; one more spelling of ISO/IEC 27001.
INSERT INTO public.directory_vocab (vocab, code, label, sort, legacy, vocab_version) VALUES
  ('pricing_model', 'one_off_purchase', 'One-off purchase', 8, ARRAY['Purchase', 'Purchase (online store)'], '2026-10-19');
UPDATE public.directory_vocab SET legacy = ARRAY['Licence', 'One-off licence']
 WHERE vocab = 'pricing_model' AND code = 'perpetual_licence';
UPDATE public.directory_vocab SET legacy = ARRAY['ISO 27001', 'ISO 27001:2022', 'ISO/IEC 27001:2022', 'ISO/IEC 27001:2022 (information security management system)']
 WHERE vocab = 'certification' AND code = 'iso_27001';

DO $$
DECLARE n integer;
BEGIN
  -- 2. Value-coded kinds: old wording -> the one code whose legacy list holds it.
  UPDATE public.directory_facts f SET value = m.code
    FROM (SELECT v.vocab, x.old, min(v.code) AS code
            FROM public.directory_vocab v CROSS JOIN LATERAL unnest(v.legacy) AS x(old)
           WHERE v.retired_on IS NULL
           GROUP BY v.vocab, x.old HAVING count(*) = 1) m
   WHERE f.kind = m.vocab AND f.value = m.old AND f.value <> m.code
     AND f.kind IN ('billing_model', 'certification', 'deployment', 'format', 'platform', 'pricing_model', 'sector', 'service_scope');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 630 THEN RAISE EXCEPTION 'recode: % vocabulary values, expected 630', n; END IF;

  -- 3. Labels: jurisdiction role and free-trial kind, from the same legacy lists.
  UPDATE public.directory_facts f SET label = v.code
    FROM public.directory_vocab v
   WHERE f.label IS NULL AND f.value = ANY (v.legacy) AND v.retired_on IS NULL
     AND ((f.kind = 'jurisdiction' AND v.vocab = 'jurisdiction.role') OR (f.kind = 'free_trial' AND v.vocab = 'free_trial'));
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 219 THEN RAISE EXCEPTION 'recode: % labels, expected 219', n; END IF;

  -- 4. Country code of the four named regimes (detail of a countryDetail kind; the card prints value only).
  UPDATE public.directory_facts SET detail = CASE value WHEN 'EU CLP' THEN 'EU' WHEN 'GB CLP' THEN 'GB' WHEN 'US OSHA HCS' THEN 'US' WHEN 'Canada WHMIS' THEN 'CA' END
   WHERE kind = 'jurisdiction' AND detail IS NULL AND value IN ('EU CLP', 'GB CLP', 'US OSHA HCS', 'Canada WHMIS');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 161 THEN RAISE EXCEPTION 'recode: % country codes, expected 161', n; END IF;
END $$;

-- 5. Rows naming several codes: the row keeps the first code, one new row per further code (copied from the
--    parent: same page, same evidence, so the parent confirmation carries over).
UPDATE public.directory_facts SET value = 'ios' WHERE id = 2086 AND value = 'iOS and Android app with offline use';
UPDATE public.directory_facts SET value = 'web' WHERE id = 2242 AND value = 'Windows, macOS, Linux and mobile devices via RDP client or web browser';
UPDATE public.directory_facts SET value = 'other_erp' WHERE id = 39 AND value = 'ERP / PLM / third-party systems (vendors not named)';
UPDATE public.directory_facts SET value = 'sap' WHERE id = 57 AND value = 'SAP';
UPDATE public.directory_facts SET value = 'ms_dynamics' WHERE id = 58 AND value = 'Microsoft Dynamics / Navision';
UPDATE public.directory_facts SET value = 'oracle' WHERE id = 59 AND value = 'Oracle';
UPDATE public.directory_facts SET value = 'other_erp' WHERE id = 97 AND value = 'ERP API';
UPDATE public.directory_facts SET value = 'sap' WHERE id = 281 AND value = 'SAP (Compliance Engine module; ''SAP certified Silver partner'')';
UPDATE public.directory_facts SET value = 'other_erp' WHERE id = 293 AND value = 'ERP (BOM and inventory interfaces; ERP not named)';
UPDATE public.directory_facts SET value = 'other_erp' WHERE id = 359 AND value = 'ERP webhook (DirectSDS distribution product)';
UPDATE public.directory_facts SET value = 'sap' WHERE id = 539 AND value = 'SAP';
UPDATE public.directory_facts SET value = 'oracle' WHERE id = 540 AND value = 'Oracle';
UPDATE public.directory_facts SET value = 'sap' WHERE id = 558 AND value = 'SAP ECC / SAP S/4HANA';
UPDATE public.directory_facts SET value = 'sap' WHERE id = 599 AND value = 'SAP (Integration Builder connector)';
UPDATE public.directory_facts SET value = 'oracle' WHERE id = 600 AND value = 'Oracle (Integration Builder connector)';
UPDATE public.directory_facts SET value = 'other_erp' WHERE id = 1015 AND value = 'ERP (system not named: ''Connect your ERP-solution to iPublisher'')';
UPDATE public.directory_facts SET value = 'other_erp' WHERE id = 1045 AND value = 'ERP (automatic data sync; system not named)';
UPDATE public.directory_facts SET value = 'sap' WHERE id = 1312 AND value = 'SAP';
UPDATE public.directory_facts SET value = 'sap' WHERE id = 1356 AND value = 'SAP';
UPDATE public.directory_facts SET value = 'sap' WHERE id = 1392 AND value = 'ERP, PLM and printing systems, including SAP and Oracle';
UPDATE public.directory_facts SET value = 'label_printer' WHERE id = 1413 AND value = 'Zebra printers';
UPDATE public.directory_facts SET value = 'other_erp' WHERE id = 1954 AND value = 'Data exchange with ERP';
UPDATE public.directory_facts SET value = 'other_erp' WHERE id = 2076 AND value = 'ERP and internal databases (element1 software)';
UPDATE public.directory_facts SET value = 'sap' WHERE id = 2250 AND value = 'SAP, Oracle, Microsoft Dynamics NAV (Navision)';
UPDATE public.directory_facts SET value = 'sap' WHERE id = 2290 AND value = 'Embedded in SAP S/4HANA, integrated with logistics processes';
UPDATE public.directory_facts SET value = 'other_erp' WHERE id = 2299 AND value = 'Integrated in dibac.erp³ or standalone alongside an existing system';
UPDATE public.directory_facts SET value = 'ms_dynamics' WHERE id = 2344 AND value = 'ERP systems e.g. Microsoft Dynamics NAV/AX, SAP Business One/R/3, Sage, Pro Alpha, AlphaPlan, Ebsoft';
UPDATE public.directory_facts SET value = 'sap' WHERE id = 2363 AND value = 'SAP (interfaces to external programs)';
UPDATE public.directory_facts SET value = 'ms_dynamics' WHERE id = 2378 AND value = 'Microsoft Dynamics 365 Business Central (module)';
UPDATE public.directory_facts SET value = 'other_erp' WHERE id = 2380 AND value = 'Also used with other ERP systems';
UPDATE public.directory_facts SET value = 'sap' WHERE id = 2432 AND value = 'SAP or other ERP systems';
INSERT INTO public.directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on)
  SELECT 8732, entry_id, kind, label, 'oracle', detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on FROM public.directory_facts WHERE id = 1392;
INSERT INTO public.directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on)
  SELECT 8733, entry_id, kind, label, 'plm', detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on FROM public.directory_facts WHERE id = 1392;
INSERT INTO public.directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on)
  SELECT 8734, entry_id, kind, label, 'label_printer', detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on FROM public.directory_facts WHERE id = 1392;
INSERT INTO public.directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on)
  SELECT 8735, entry_id, kind, label, 'android', detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on FROM public.directory_facts WHERE id = 2086;
INSERT INTO public.directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on)
  SELECT 8736, entry_id, kind, label, 'windows', detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on FROM public.directory_facts WHERE id = 2242;
INSERT INTO public.directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on)
  SELECT 8737, entry_id, kind, label, 'macos', detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on FROM public.directory_facts WHERE id = 2242;
INSERT INTO public.directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on)
  SELECT 8738, entry_id, kind, label, 'linux', detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on FROM public.directory_facts WHERE id = 2242;
INSERT INTO public.directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on)
  SELECT 8739, entry_id, kind, label, 'oracle', detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on FROM public.directory_facts WHERE id = 2250;
INSERT INTO public.directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on)
  SELECT 8740, entry_id, kind, label, 'ms_dynamics', detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on FROM public.directory_facts WHERE id = 2250;
INSERT INTO public.directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on)
  SELECT 8741, entry_id, kind, label, 'sap', detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on FROM public.directory_facts WHERE id = 2344;
INSERT INTO public.directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on)
  SELECT 8742, entry_id, kind, label, 'other_erp', detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on FROM public.directory_facts WHERE id = 2344;
INSERT INTO public.directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on)
  SELECT 8743, entry_id, kind, label, 'other_erp', detail, quote, source_url, evidence, sort, checked_on, source_kind, provided_by, basis_for, status, confirmed, confirmed_on FROM public.directory_facts WHERE id = 2432;

-- 6. Duplicate wordings: the entry already carries the same integration code (the old row stays in history).
DELETE FROM public.directory_facts WHERE id = 60 AND kind = 'integration' AND value = 'JD Edwards';
DELETE FROM public.directory_facts WHERE id = 61 AND kind = 'integration' AND value = 'PeopleSoft';
DELETE FROM public.directory_facts WHERE id = 1933 AND kind = 'integration' AND value = 'ECHA PCN system-to-system (S2S) bulk upload';
DELETE FROM public.directory_facts WHERE id = 2379 AND kind = 'integration' AND value = 'Microsoft Dynamics NAV (Navision) — module certified for NAV';

SELECT setval('public.directory_facts_id_seq', (SELECT max(id) FROM public.directory_facts));

-- 7. The database must now equal the new seed.
DO $$
DECLARE n integer; h text;
BEGIN
  SELECT count(*), md5(string_agg(id || '|' || kind || '|' || coalesce(label, '') || '|' || value || '|' || coalesce(detail, ''), E'\n' ORDER BY id))
    INTO n, h FROM public.directory_facts;
  IF n <> 8504 OR h <> '8c85d3abbf24ac524c49d0e69e081731' THEN
    RAISE EXCEPTION 'recode: database (% facts, md5 %) differs from the new seed (8504 facts, md5 8c85d3abbf24ac524c49d0e69e081731)', n, h;
  END IF;
END $$;

-- 8. Version the change and tag it as a recode. Before this script ran, history matched the facts exactly
--    (0 pending differences, checked 2026-10-19), and everything runs in one transaction, so every version
--    closed today was closed by this recode.
SELECT * FROM public.directory_snapshot('2026-10-19');
UPDATE public.directory_fact_history SET end_reason = 'recoded'
 WHERE valid_to = '2026-10-19' AND end_reason IN ('changed', 'removed');

COMMIT;
