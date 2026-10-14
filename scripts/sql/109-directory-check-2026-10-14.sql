-- 2026-10-14 (s109, A2.2): check:directory --only 144,137,136,133,138,210,219,209 (report directory-check-2026-10-14.json).
-- Run the WHOLE file in the Supabase SQL Editor in one go.
--
-- First data of the new service-provider kinds: 49 facts #3175-#3223 (service_scope 28, sector 20, billing_model 1).
-- The checker found the evidence of 37 of them on the source page; 35 are confirmed here.
-- Not confirmed on purpose:
--   #3187 knoell, Registration dossiers: the evidence stands only in a "dossier follow-ups" bullet, and the
--         submission-support page names no REACH registration. Needs a better source page.
--   #3204 ServiREACH, Fixed fee per project: "Presupuesto cerrado" is a closed quote, not a billing unit.
-- Not found, left unconfirmed (the vendor sites block scripts): Charles River #3179-#3185, WSP #3205-#3209.
-- All 50 older facts of these entries that the checker found again were confirmed before.
update directory_facts set confirmed = true, confirmed_on = '2026-10-14' where confirmed is distinct from true and id in (
  3175, 3176, 3177, 3178,
  3186, 3188, 3189, 3190, 3191, 3192, 3193, 3194, 3195,
  3196, 3197, 3198, 3199, 3200, 3201, 3202, 3203,
  3210, 3211, 3212, 3213, 3214, 3215, 3216, 3217, 3218,
  3219, 3220, 3221, 3222, 3223
);

-- Snapshot into the directory history (s103): confirmations get the date of the check. Must stay the last statement.
select * from directory_snapshot('2026-10-14');
