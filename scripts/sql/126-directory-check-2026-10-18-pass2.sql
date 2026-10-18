-- 126 - check:directory for the second pass (2026-10-18): 28 changed or new live entries.
-- Report: directory-check-2026-10-18.json (--only run: 655 facts, 129 addresses; ok 116, blocked 12, dead 1).
-- 1) 121 facts found on their source page, confirmed now; plus SDS Manager #346 #347 #2278 #2279, re-read by hand
--    in a browser on 2026-10-18 (the plan cards are drawn by script; the library size is chosen with buttons):
--    Premium USD 39 and Pro USD 59 a month at 100 SDSs, Premium USD 172 at 1,000 and USD 789 at 10,000, billed annually.
-- 2) The one fact reported as "confirmed before, not found today", ChemiusExpert #1974 (EUR 4,79 per SDS), is on the page
--    in the tier table (re-read 2026-10-18) and stays confirmed.
-- 3) The dead page (CSB history, old address) is fixed in the seed: the facts now cite /en/csb-history.
update directory_facts set confirmed = true, confirmed_on = '2026-10-18' where confirmed is distinct from true and id in (
  345, 346, 347, 2187, 2188, 2278, 2279, 2884, 3602, 3603, 3604, 3610, 3617, 4529, 6646, 6647, 6649, 6650, 6652, 6653,
  6654, 6656, 6657, 6658, 6659, 6660, 6662, 6663, 6664, 6665, 6667, 6670, 6672, 6673, 6675, 6679, 6682, 6685, 6686, 6687,
  6688, 6689, 6690, 6691, 6692, 6693, 6695, 6696, 6705, 6706, 6707, 6709, 6713, 6714, 6715, 6716, 6717, 6718, 6719, 6720,
  6721, 6724, 6726, 6727, 6728, 6729, 6730, 6731, 6732, 6733, 6734, 6736, 6740, 6741, 6745, 6751, 6752, 6753, 6760, 6764,
  6765, 6766, 6767, 6768, 6769, 6770, 6773, 6775, 6779, 6780, 6781, 6782, 6783, 6784, 6785, 6804, 6806, 6809, 6810, 6812,
  6813, 6814, 6815, 6816, 6818, 6822, 6823, 6824, 6825, 6826, 6827, 6828, 6829, 6830, 6831, 6832, 6833, 6838, 6841, 6854,
  6856, 6857, 6858, 6861, 6863
);

-- Snapshot into the directory history (s103). Must stay the last statement.
select * from directory_snapshot('2026-10-18');
