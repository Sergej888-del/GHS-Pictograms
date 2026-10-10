-- SDS Manager (entry 24): replace three vague price facts taken from the page's meta description
-- with per-plan prices from the rendered price table on https://sdsmanager.com/us/pricing/?solution=management.
-- The management price table is filled in by JavaScript (raw HTML shows "$ 0 /month"), so the automated
-- check cannot see it: verified in the built-in browser on 2026-10-10 and confirmed by hand.
-- Do NOT apply "unconfirm" proposals from check:directory for facts 345, 346, 347, 2278, 2279.
-- Note: the page's meta description says "1,000 SDS = USD 2064/yr"; the rendered table says Premium 800-1000 = $ 2,068.

update directory_facts set label='Basic, up to 100 SDSs', value='USD 228 / year',
  detail='Shown as USD 19 per month, billed annually', evidence='228', sort=1, checked_on='2026-10-10'
where id=345;
update directory_facts set label='Premium, up to 100 SDSs', value='USD 468 / year',
  detail='Shown as USD 39 per month, billed annually', evidence='468', sort=2, checked_on='2026-10-10'
where id=346;
update directory_facts set label='Pro, up to 100 SDSs', value='USD 708 / year',
  detail='Shown as USD 59 per month, billed annually', evidence='708', sort=3, checked_on='2026-10-10'
where id=347;

insert into directory_facts (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, provided_by, basis_for)
values
 (2278, 24, 'price', 'Premium, 800–1,000 SDSs', 'USD 2,068 / year', 'Price rises with the number of SDSs in the library', null,
  'https://sdsmanager.com/us/pricing/?solution=management', '2,068', 4, '2026-10-10', 'editor', null),
 (2279, 24, 'price', 'Premium, 8,000–10,000 SDSs', 'USD 9,468 / year', 'Largest library size in the published price table', null,
  'https://sdsmanager.com/us/pricing/?solution=management', '9,468', 5, '2026-10-10', 'editor', null)
on conflict (id) do nothing;

update directory_facts set confirmed=true, confirmed_on='2026-10-10'
where id in (345, 346, 347, 2278, 2279) and confirmed is distinct from true;

-- ExactSDS (entry 1): Standard 70/100/200 SDS prices are in the raw HTML price table
-- ("Standard 70 SDS $ 4,299/year" etc.); the automated check missed them. Confirmed by hand 2026-10-10.
update directory_facts set confirmed=true, confirmed_on='2026-10-10'
where id in (13, 14, 15) and confirmed is distinct from true;
