-- Session 110 (2026-10-15), check:directory after two seed edits promised in the wave 6 and wave 7 letters.
-- Report: directory-check-2026-10-15.json (--only 176,216: 42 facts, all found, nothing to unconfirm).
--
-- #2221 SDS-FullService: certification "ISO 27001" -> "ISO/IEC 27001:2022". The vendor confirmed the edition
--       by e-mail (reply to letter 60); the About page says "ISO/IEC 27001:2022 certification".
-- #2685 asseso: "Swizerland" -> "Switzerland" in the value (promised in letter 62; evidence "Taiwan" unchanged).
-- Both were reset to unconfirmed by import:directory because the fact changed; the checker found the evidence again.
update directory_facts set confirmed = true, confirmed_on = '2026-10-15' where confirmed is distinct from true and id in (
  2221, 2685
);

-- Snapshot into the directory history (s103): confirmations get the date of the check. Must stay the last statement.
select * from directory_snapshot('2026-10-15');
