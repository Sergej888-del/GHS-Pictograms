-- 2026-10-14 (s109, A2.4): check:directory --only 62,66,67,132,135,136,139,162,200,216,220,224 (report directory-check-2026-10-14.json).
-- Run the WHOLE file in the Supabase SQL Editor in one go. Run it AFTER the second npm run import:directory.
--
-- 58 facts found on the vendor pages by the checker (new service_scope / sector / feature / ufi_pcn / billing_model facts
-- for 11 entries, plus knoell #3187 with its new source page).
-- Confirmed by hand in the built-in browser (the checker cannot read these pages, or missed an exact phrase that is on the page):
--   Biorius #3317-#3324 (site blocks scripts; every evidence string found in the page text),
--   Ekotox #3364 ("ECHA notification (PCN)" stands verbatim in the rendered 'We offer' page),
--   Charles River #3179-#3185 (#3179, #3182, #3183 read in the browser; #3180, #3181, #3184, #3185 from verbatim quotes of the page reader,
--   the site blocks repeated automatic loads),
--   WSP #3205, #3207-#3209 (read in the browser; #3206 Registration dossiers was deleted: the page names no dossier preparation),
--   ServiREACH #3204 (a closed quote "Presupuesto cerrado" = fixed fee per project, decision 14.10).
-- Removed from the seed instead of confirming: Sagentia feature "consortia and task forces" (phrase not on the page),
-- Renfrey C&L Inventory (the page prints "(C&L) Notifications" only).
update directory_facts set confirmed = true, confirmed_on = '2026-10-14' where confirmed is distinct from true and id in (
  3179, 3180, 3181, 3182, 3183, 3184, 3185, 3187, 3204, 3205,
  3207, 3208, 3209, 3305, 3306, 3307, 3308, 3309, 3310, 3311,
  3312, 3313, 3314, 3315, 3316, 3317, 3318, 3319, 3320, 3321,
  3322, 3323, 3324, 3325, 3326, 3327, 3328, 3329, 3330, 3331,
  3332, 3333, 3334, 3335, 3336, 3337, 3338, 3339, 3340, 3341,
  3343, 3344, 3345, 3346, 3347, 3348, 3349, 3351, 3352, 3353,
  3354, 3355, 3356, 3357, 3358, 3359, 3360, 3361, 3362, 3363,
  3364, 3365, 3366, 3367, 3368, 3369, 3370, 3371, 3372
);

-- Snapshot into the directory history (s103): confirmations get the date of the check. Must stay the last statement.
select * from directory_snapshot('2026-10-14');
