-- Migration: report_public_facts
-- Applied via Supabase MCP on 2026-10-16 (project zhvrbrlqgntgzneggqst).
-- Archive copy for scripts/sql/. Do not re-run the CREATE: table already exists.
-- The INSERT below is the pilot seed (26 rows) applied the same day via execute_sql.

-- External public facts (OSHA, ECHA, UNECE...): entered by hand per issue, each with source and as-of date
CREATE TABLE public.report_public_facts (
  id           serial PRIMARY KEY,
  topic        text NOT NULL,          -- 'osha_top10', 'echa_sds_enforcement', 'echa_pcn_volume', 'deadline'
  jurisdiction text,                   -- 'US', 'EU', 'EEA', 'global'
  metric       text NOT NULL,          -- 'hazcom_violations_prelim', 'sds_noncompliant_pct', ...
  period       text,                   -- 'FY2026', '2024', 'inspections 2023'
  n            numeric,                -- value
  unit         text,                   -- 'violations', 'pct', 'notifications', 'date'
  value_text   text,                   -- for dates or non-numeric facts
  source_url   text NOT NULL,
  source_name  text,                   -- 'OSHA', 'ECHA', 'NSC Safety+Health'
  as_of        date NOT NULL,          -- when the source stated it
  checked_on   date NOT NULL DEFAULT CURRENT_DATE,
  note         text
);
CREATE INDEX report_public_facts_topic_idx ON public.report_public_facts (topic, metric, period);
COMMENT ON TABLE public.report_public_facts IS 'GHS Market Report: external public facts (OSHA, ECHA, EU/US deadlines) with source URL and as-of date. Hand-entered per issue. Public read; writes service_role only.';
ALTER TABLE public.report_public_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_public_facts_public_read ON public.report_public_facts FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.report_public_facts TO anon, authenticated;

-- Pilot seed, 2026-10-16. Rows whose note says "replace URL" cite a secondary source; swap for the primary (osha.gov, echa.europa.eu, EUR-Lex) before print.
INSERT INTO public.report_public_facts (topic, jurisdiction, metric, period, n, unit, value_text, source_url, source_name, as_of, note) VALUES
-- OSHA Top 10 series (Hazard Communication 29 CFR 1910.1200)
('osha_top10','US','hazcom_violations_prelim','FY2026',1961,'violations',NULL,'https://www.carriermanagement.com/news/2026/09/15/291957.htm','OSHA via Carrier Management','2026-09-15','Preliminary, data 2025-10-01..2026-08-31; announced at NSC Safety Congress 2026-09-15. Replace with osha.gov/top10 once FY2026 page is live.'),
('osha_top10','US','hazcom_rank','FY2026',2,'rank',NULL,'https://jjkellercompliancenetwork.com/news/fall-protection-for-construction-continues-to-lead-oshas-top-10-list','OSHA via J.J. Keller','2026-09-15','Most-cited general industry standard; #2 overall behind construction fall protection'),
('osha_top10','US','fall_protection_violations_prelim','FY2026',4041,'violations',NULL,'https://www.carriermanagement.com/news/2026/09/15/291957.htm','OSHA via Carrier Management','2026-09-15','Context for ratio HazCom / #1'),
('osha_top10','US','hazcom_violations_prelim','FY2025',2546,'violations',NULL,'https://www.ngwa.org/detail/news/2025/09/17/osha-announces-2025-top-10-most-cited-standards','OSHA via NGWA','2025-09-17','Preliminary, data as of 2025-08-12'),
('osha_top10','US','hazcom_violations_final','FY2025',3010,'violations',NULL,'https://www.osha.gov/top10citedstandards','OSHA','2026-04-15','Final FY2025 count per OSHA Information System data pulled 2026-04-15 (as reported by Safety+Health / Reliamag)'),
('osha_top10','US','hazcom_rank','FY2025',2,'rank',NULL,'https://www.osha.gov/top10citedstandards','OSHA','2026-04-15',NULL),
('osha_top10','US','hazcom_violations_prelim','FY2024',2888,'violations',NULL,'https://www.ngwa.org/detail/news/2024/09/23/osha-reveals-top-10-safety-violations-at-nsc-safety-congress-expo','OSHA via NGWA','2024-09-17','Preliminary'),
('osha_top10','US','hazcom_rank','FY2024',2,'rank',NULL,'https://www.ngwa.org/detail/news/2024/09/23/osha-reveals-top-10-safety-violations-at-nsc-safety-congress-expo','OSHA via NGWA','2024-09-17',NULL),
-- ECHA Enforcement Forum: SDS compliance project (inspections 2023, report late 2024)
('echa_sds_enforcement','EEA','sds_noncompliant_pct','inspections 2023',35,'pct',NULL,'https://podcast.ausha.co/scpodcast/eu-enforcement-project-checks-safety-data-sheets-still-room-for-improvement','ECHA Safer Chemicals podcast','2024-12-03','35% of checked SDS reported non-compliant; replace URL with ECHA news/report page'),
('echa_sds_enforcement','EEA','sds_data_quality_deficient_pct','inspections 2023',27,'pct',NULL,'https://textination.de/en/node/28680','ECHA via Textination','2024-12-03','Deficiencies in data quality for 27% of inspected SDS'),
('echa_sds_enforcement','EEA','sds_not_provided_pct','inspections 2023',4,'pct',NULL,'https://podcast.ausha.co/scpodcast/eu-enforcement-project-checks-safety-data-sheets-still-room-for-improvement','ECHA Safer Chemicals podcast','2024-12-03','Approximately 4% of controlled cases: SDS not actively provided'),
('echa_sds_enforcement','EEA','sds_checked','inspections 2023',2500,'sds',NULL,'https://textination.de/en/node/28680','ECHA via Textination','2024-12-03','More than 2,500 SDS checked'),
('echa_sds_enforcement','EEA','countries_participating','inspections 2023',28,'countries',NULL,'https://textination.de/en/node/28680','ECHA via Textination','2024-12-03',NULL),
('echa_sds_enforcement','EEA','sds_noncompliant_pct_historic_high','earlier Forum projects',52,'pct',NULL,'https://podcast.ausha.co/scpodcast/eu-enforcement-project-checks-safety-data-sheets-still-room-for-improvement','ECHA Safer Chemicals podcast','2024-12-03','Highest non-compliance rate seen in past Forum projects'),
-- ECHA Enforcement Forum: PCN pilot project (inspections H1 2025, report Feb 2026, ECHA-26-R-01-EN)
('echa_pcn_enforcement','EEA','mixtures_inspected','H1 2025',1597,'mixtures',NULL,'https://www.cirs-group.com/en/chemicals/echa-releases-pilot-project-report-on-pcn-enforcement-nearly-20-of-companies-failed-to-meet-compliance-obligations','ECHA via CIRS','2026-02-28','Report ref ECHA-26-R-01-EN; replace URL with ECHA report page'),
('echa_pcn_enforcement','EEA','pcn_missing_pct','H1 2025',19,'pct',NULL,'https://www.cirs-group.com/en/chemicals/echa-releases-pilot-project-report-on-pcn-enforcement-nearly-20-of-companies-failed-to-meet-compliance-obligations','ECHA via CIRS','2026-02-28','Where PCN submission was required, 19% non-compliance'),
('echa_pcn_enforcement','EEA','ufi_missing_on_label_pct','H1 2025',15,'pct',NULL,'https://www.cirs-group.com/en/chemicals/echa-releases-pilot-project-report-on-pcn-enforcement-nearly-20-of-companies-failed-to-meet-compliance-obligations','ECHA via CIRS','2026-02-28',NULL),
('echa_pcn_enforcement','EEA','countries_participating','H1 2025',18,'countries',NULL,'https://www.cirs-group.com/en/chemicals/echa-releases-pilot-project-report-on-pcn-enforcement-nearly-20-of-companies-failed-to-meet-compliance-obligations','ECHA via CIRS','2026-02-28',NULL),
-- ECHA volumes 2024 (annual report)
('echa_pcn_volume','EU','pcn_received','2024',3148898,'notifications',NULL,'https://www.chemradar.com/en/service/detail/ejmul0mksagw','ECHA Annual Report 2024 via ChemRadar','2025-06-30','Target 2-3 million; replace URL with ECHA annual report'),
('echa_cl_volume','EU','cl_notifications_received','2024',168990,'notifications',NULL,'https://www.chemradar.com/en/service/detail/ejmul0mksagw','ECHA Annual Report 2024 via ChemRadar','2025-06-30','Target 35,000; surge attributed to batch/automated submissions'),
-- Deadlines: US HazCom 2024 (final rule 2024-05-20, effective 2024-07-19; extension rule 2026-01-15)
('deadline','US','hazcom2024_substances_manufacturers',NULL,NULL,'date','2026-05-19','https://www.ehs.com/?p=20716','OSHA via EHS.com','2026-01-15','Extended from 2026-01-19 by final rule published 2026-01-15'),
('deadline','US','hazcom2024_substances_employers',NULL,NULL,'date','2026-11-20','https://www.ehs.com/?p=20716','OSHA via EHS.com','2026-01-15','Extended from 2026-07-20 by final rule published 2026-01-15'),
('deadline','US','hazcom2024_mixtures_manufacturers',NULL,NULL,'date','2027-07-19','https://www.govinfo.gov/content/pkg/FR-2024-05-20/pdf/2024-08568.pdf','OSHA / Federal Register','2024-05-20','Original date from 2024 final rule; check whether 2026-01-15 extension shifted it'),
('deadline','US','hazcom2024_mixtures_employers',NULL,NULL,'date','2028-01-19','https://www.govinfo.gov/content/pkg/FR-2024-05-20/pdf/2024-08568.pdf','OSHA / Federal Register','2024-05-20','Original date from 2024 final rule; check whether 2026-01-15 extension shifted it'),
-- Deadlines: EU CLP revision
('deadline','EU','clp_2024_2865_in_force',NULL,NULL,'date','2024-12-10','https://tksd.org.tr/news/clp-eu-regulation-no-20252439-was-published-in-the-official-bulletin-of-the-european-union-on-3-december-2025','TKSD (secondary)','2024-12-10','Regulation (EU) 2024/2865 published OJ 2024-11-20, in force 2024-12-10; replace URL with EUR-Lex'),
('deadline','EU','clp_label_format_advertising_distance_sales_fuel_pumps',NULL,NULL,'date','2028-01-01','https://en.reach24h.com/news/industry-news/chemical/eu-delays-clp-implementation-dates-to-2028','REACH24H (secondary)','2025-12-03','Regulation (EU) 2025/2439, OJ 2025-12-03, postpones four provisions of 2024/2865 to 2028-01-01; new hazard class transitions unaffected; replace URL with EUR-Lex');
