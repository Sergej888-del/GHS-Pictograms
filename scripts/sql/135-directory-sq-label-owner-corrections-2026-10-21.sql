-- 135 - SQ Label (entry 113) owner corrections, ticket #73941, e-mail of Luka Viktor Rogač (Priber d.o.o.), 2026-10-21.
-- Checked against sqlabel.com in the browser pane the same day; the seed (scripts/data/directory-v3.json) carries the same values.
--   14241 deployment: desktop -> on_premise (owner's classification; the software is installed locally on Windows).
--   2988 market: "Used worldwide", detail worldwide - stated by the owner; the cited FAQ page does not say it (marked on the card).
--   1337 feature: owner wording; the page shows "Smart Text Object for Auto-Fitting Content" (formatting / text boundaries: owner).
--   3174 feature: owner wording, supported by the Automation page ("data reception from serial ports", network requests, REST API).
--   1329 free_trial: the trial page now states "free 30-day trial" -> no longer an owner statement.
update directory_facts set value = 'on_premise', provided_by = 'owner', checked_on = '2026-10-21' where id = 14241;
update directory_facts set value = 'Used worldwide', detail = 'worldwide', source_url = 'https://www.sqlabel.com/faq/', evidence = null,
       provided_by = 'owner', checked_on = '2026-10-21', confirmed = true, confirmed_on = '2026-10-21' where id = 2988;
update directory_facts set value = 'GHS pictograms, signal words, and hazard statements with advanced formatting, text boundaries, and auto-fitting',
       evidence = 'Smart Text Object for Auto-Fitting Content', provided_by = 'owner', checked_on = '2026-10-21',
       confirmed = true, confirmed_on = '2026-10-21' where id = 1337;
update directory_facts set value = 'SQ Label Automation, a separate product, prints labels automatically via file, database, serial port, and network or API requests',
       evidence = 'data reception from serial ports', checked_on = '2026-10-21', confirmed = true, confirmed_on = '2026-10-21' where id = 3174;
update directory_facts set detail = 'All features; registration required.', evidence = 'free 30-day trial', provided_by = 'editor',
       checked_on = '2026-10-21', confirmed = true, confirmed_on = '2026-10-21' where id = 1329;
update directory_entries set owner_confirmed_on = '2026-10-21' where id = 113;

-- History (s103): must stay the last statement.
select * from directory_snapshot('2026-10-21');
