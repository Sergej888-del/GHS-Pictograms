-- 118-emergency-publish.sql - publishes the emergency-numbers reference (15.10.2026, evening).
-- Page: /directory/emergency-numbers/ (src/pages/directory/emergency-numbers/[...page].astro). It is built only while rows are live.
--
-- What this does:
--   1. Norway: the number 22 59 13 00 is read on the operator's own page (fhi.no/giftinformasjonen, "around the clock"), so the
--      row becomes confirmed, the source becomes that page, and the working note "recheck before publishing" is replaced by a
--      plain statement of what each source says. The helsenorge.no page (29 June 2020) stays named in the note.
--   2. Sets every service that is confirmed or dated_source to live. unconfirmed rows (Bulgaria) stay draft.
--   3. Sets live every country that has a live service or a general number (Cyprus has 1401 and no service row).
--      Countries with neither (LV, LI, RO, SI) and Bulgaria stay draft.
-- Nothing is deleted. The database refuses a live row that is unconfirmed or has no https source.
-- Expected result of the check at the end: live_services 53, live_confirmed 45, live_dated 8, live_countries 26,
-- draft_services 1, draft_countries BG,LI,LV,RO,SI.

update public.emergency_services
set verification = 'confirmed',
    source_url   = 'https://fhi.no/giftinformasjonen',
    source_date  = null,
    checked_on   = '2026-10-15',
    sds_use_note = 'The page of the Institute (FHI) for the service gives this number and says to call around the clock; it shows no date. The helsenorge.no page for producers and importers (29 June 2020) says to enter this number in section 1.4 because it is the only poison centre in Norway.',
    updated_at   = now()
where country_code = 'NO' and slug = 'giftinformasjonen';

update public.emergency_services
set state = 'live', updated_at = now()
where verification in ('confirmed', 'dated_source') and state <> 'live';

update public.emergency_countries c
set state = 'live', updated_at = now()
where c.state <> 'live'
  and (c.general_number is not null
       or exists (select 1 from public.emergency_services s where s.country_code = c.country_code and s.state = 'live'));

-- Check (read-only):
select
  (select count(*) from public.emergency_services  where state = 'live')                              as live_services,
  (select count(*) from public.emergency_services  where state = 'live' and verification = 'confirmed')    as live_confirmed,
  (select count(*) from public.emergency_services  where state = 'live' and verification = 'dated_source') as live_dated,
  (select count(*) from public.emergency_countries where state = 'live')                              as live_countries,
  (select count(*) from public.emergency_services  where state <> 'live')                             as draft_services,
  (select string_agg(country_code, ',' order by country_code) from public.emergency_countries where state <> 'live') as draft_countries;
