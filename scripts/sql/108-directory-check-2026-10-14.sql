-- 2026-10-14 (s108): check:directory --only 113 after the SQ Label card update (report directory-check-2026-10-14.json).
-- Run the WHOLE file in the Supabase SQL Editor in one go.
--
-- 1) Facts found by the checker (page ok, evidence found). 14 ids are listed; those already confirmed stay as they are.
--    Newly confirmed: #1332 (Original, network of 20 workstations, EUR 4,797 - source moved to the Original licence page),
--    #3168 Original Plus EUR 697 and #3169 Professional Plus EUR 897-10,797 (vendor licence pages, per workstation),
--    #3172 licence types, #3173 support and updates (sqlabel.com/support), #3174 SQ Label Automation sentence.
--    Not confirmed on purpose (owner statements, no evidence, printed as "stated by the vendor"): #1330, #1336, #3170.
update directory_facts set confirmed = true, confirmed_on = '2026-10-14' where confirmed is distinct from true and id in (
  1329, 1331, 1332, 1333, 1341, 1345, 2987, 2988, 2989, 3168, 3169, 3172, 3173, 3174
);

-- 2) The owner's answers (ticket #73941) are recorded on the claim row. verified_at stays empty on purpose:
--    it is set only after the owner confirms the updated card.
update directory_claims
set note = note || ' Answers received 14.10 (ticket #73941): Plus prices are per workstation like Original (answer "Yes" to the per-workstation and VAT question); e-mail support is free and regular updates are included inside the same version while it is officially supported (sqlabel.com/support); High Priority Support is a separate paid service; the download is a 30-day fully functional trial running Professional Plus; the EULA came as an attachment and the owner will check whether it has a public link; role not stated. Owner asked to list licence types as software, hardware, portable and network, and to remove Automation prices but keep a one-sentence description (done on the card). Reseller programme terms promised in a separate email; no affiliate link until a signed agreement.'
where id = 3 and entry_id = 113;

-- 3) Snapshot into the directory history (s103): confirmations get the date of the check. Must stay the last statement.
select * from directory_snapshot('2026-10-14');
