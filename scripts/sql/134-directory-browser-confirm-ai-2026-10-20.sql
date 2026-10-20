-- 134 - manual (browser pane) confirmation of AI facts, 2026-10-20 s114.
-- After SQL 131, 88 positive AI facts were still unconfirmed because their pages are closed to scripts. They were re-read in
-- the built-in browser of the Claude desktop app (a real browser, reading only), with the same normalised substring test as
-- check:directory. Result: 58 found on their own source page (confirmed below), 3 not found (17250 helioscomply.com now shows
-- an unrelated gambling site; 13047 stoffenjournaal.nl removed its "AI-hulp" line; 10487 aimplas.es changed wording),
-- 18 blocked (404, bot protection, geo-redirect to LV/NL pages, haz-map.com unreachable, nexreg.com "access limited"),
-- 9 inside PDFs (manual). Work file: scratchpad browsercheck/result.json.
update directory_facts set confirmed = true, confirmed_on = '2026-10-20'
 where confirmed is distinct from true and id in (
  4011,4226,4847,4892,5020,5077,5283,5318,5368,5407,6635,8746,10122,10209,10285,11679,12267,13200,13202,13203,13631,13775,
  13776,13781,13782,13903,14404,14406,14417,14418,14420,14422,14423,14479,14487,14494,14495,14496,14506,14510,14518,14519,
  14520,14525,14550,14570,14573,15057,15208,15651,15656,15657,15658,15984,17010,17147,17390,17411);

-- History (s103): must stay after the update. Then the report snapshot of the day is re-run (idempotent per date).
select * from directory_snapshot('2026-10-20');
select * from report_take_snapshot(CURRENT_DATE, 'v2.1 2026-10');
