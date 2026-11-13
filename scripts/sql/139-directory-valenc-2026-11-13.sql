-- 139 - Valenc (entry 397, new listing in sds-authoring-software, also in label-design-printing), 2026-11-13 (s116).
-- The entry and its 85 facts come from scripts/data/directory-v3.json (npm run import:directory); 3 private facts from
-- ghs-research/directory-research.json (npm run import:research). Builder: Claude outputs/s116-valenc/build_valenc.py.
-- Every evidence below was found on 2026-11-13 in the HTML of its source page on valenc.com, read in the browser pane
-- with the same text extraction and match as scripts/check-directory.ts (price 7,000 with priceFound). 62 facts.
-- Facts without evidence (not_stated statuses, liability_cap no_terms) stay unconfirmed, as for every other vendor.
-- Run AFTER the import, in the Supabase SQL Editor.
update public.directory_facts set confirmed = true, confirmed_on = '2026-11-13'
where entry_id = 397 and id in (
  18107, 18108, 18109, 18110, 18111, 18112, 18113, 18114, 18115, 18116, 18117, 18118,
  18119, 18120, 18121, 18122, 18123, 18124, 18125, 18126, 18127, 18128, 18129, 18130,
  18131, 18132, 18133, 18134, 18135, 18136, 18137, 18138, 18140, 18141, 18144, 18145,
  18146, 18152, 18153, 18154, 18155, 18156, 18157, 18158, 18159, 18160, 18161, 18162,
  18163, 18164, 18165, 18181, 18182, 18183, 18184, 18185, 18186, 18187, 18188, 18189,
  18190, 18191
);

-- History (s103): must stay the last statement.
select * from directory_snapshot('2026-11-13');
