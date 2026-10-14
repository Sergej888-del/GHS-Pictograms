-- 2026-10-14 (s109, A2.3): check:directory --only 230,231,232,233,234,235,131 (report directory-check-2026-10-14.json).
-- Run the WHOLE file in the Supabase SQL Editor in one go, AFTER the second `npm run import:directory`.
--
-- New subsection registration-or-pcn: six new entries #230-#235 (REACHECK OR Services, Reach Integra, REACHLINKED, CRAD,
-- REACHLaw, REACH Global Services) and 12 new service facts of Chementors #131 (service_scope 5, sector 7).
-- The checker found the evidence of 74 of the new facts on the source page; all 74 are confirmed here.
-- Meaning was checked by hand against the vendor pages for the riskiest ones (REACHLINKED regimes, REACHLaw K-REACH Only
-- Representative via the Seoul office, CRAD dossier preparation, REACH Global Services KKDIK).
-- Facts without evidence (deployment) are not gated and need no confirmation.
-- Reach Only Representative Ltd (rorltd.com) is not in the seed: its site has no HTTPS, and live entries must link to https.
update directory_facts set confirmed = true, confirmed_on = '2026-10-14' where confirmed is distinct from true and id in (
  3225, 3226, 3227, 3228, 3229, 3230, 3231, 3232, 3233, 3235,
  3236, 3237, 3238, 3239, 3240, 3241, 3242, 3244, 3245, 3246,
  3247, 3248, 3249, 3251, 3252, 3254, 3255, 3256, 3257, 3258,
  3259, 3260, 3261, 3262, 3263, 3265, 3266, 3267, 3268, 3269,
  3270, 3271, 3272, 3273, 3274, 3275, 3276, 3277, 3278, 3279,
  3280, 3282, 3283, 3284, 3285, 3286, 3287, 3288, 3289, 3290,
  3291, 3292, 3293, 3294, 3295, 3296, 3297, 3298, 3299, 3300,
  3301, 3302, 3303, 3304
);

-- Snapshot into the directory history (s103): confirmations get the date of the check. Must stay the last statement.
select * from directory_snapshot('2026-10-14');
