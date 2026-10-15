-- 114 - check:directory for SDS-FullService (#176) after the corrections the vendor asked for (2026-10-15).
-- Report: directory-check-2026-10-15.json, two runs with --only 176. Across the two runs every fact with evidence
-- was found: run 1 found all but #2218 (watchlist-monitor page answered HTTP 429, the site's rate limit); run 2 found
-- all but #2209, #2212 and #2220 (professional-services page answered HTTP 429), which run 1 had found and which
-- stay confirmed from the earlier checks. Nothing to unconfirm. #2223 (pricing_statement) has no evidence by design.
--
-- Corrected by the seed (import:directory reset these to unconfirmed because the text changed):
--   #2213 platform       "Web browser (responsive interface for desktop and mobile); kiosk mode"
--   #2218 feature        watch-list check now names SVHC Candidate List, REACH Annex XIV/XVII, California Proposition 65,
--                        ZDHC MRSL and other industry lists (watchlist-monitor page)
--   #2221 certification  "ISO/IEC 27001:2022 (information security management system)" (about-us page)
-- New facts, all from the vendor's own public pages:
--   #3373 format PDF; #3374 accepts PDF/ZIP or a direct vendor flow; #3375 exports data to Excel/CSV/XML/JSON;
--   #3376 archives obsolete SDSs (REACH Article 36); #3377 steps, roles and notifications by production site;
--   #3378 Advanced PDF Comparison; #3379 market "Italy and abroad" (customers page).
-- The old format facts #3148-#3150 (Excel / CSV, XML, JSON) were removed from the seed: they are exports of extracted
-- data, not SDS formats, and now sit in #3375.
update directory_facts set confirmed = true, confirmed_on = '2026-10-15' where confirmed is distinct from true and id in (
  2213, 2218, 2221, 3373, 3374, 3375, 3376, 3377, 3378, 3379
);

-- The card was re-read against the vendor's pages today; the seed carries the same date.
update directory_entries set last_verified = '2026-10-15' where id = 176 and last_verified is distinct from '2026-10-15';

-- Snapshot into the directory history (s103): confirmations get the date of the check. Must stay the last statement.
select * from directory_snapshot('2026-10-15');
