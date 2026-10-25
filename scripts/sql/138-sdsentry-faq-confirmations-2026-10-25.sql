-- 138 - SDSentry (entry 28): the two owner statements are now on the vendor's FAQ, 2026-10-25 (s115).
-- E-mail from Dale Weaver (dale.weaver@0xpi.com), 25.10: the FAQ states the price with no end date and "English only";
-- the "regularly USD 49" line is gone from the homepage. Read in the browser pane 25.10 on https://sdsentry.0xpi.com/faq.html
-- (also in a fresh fetch of the HTML), so both facts become editor facts, confirmed, and lose "stated by the vendor":
--   417 pricing_note: "That is the standard price with no end date: it does not go up after November 20, 2026."
--   18105 language: "English only. The app, its labels and its training guides are in English."
-- Every other quote on the card was found again the same day, except 3108 (privacy page): the sentence goes on
-- "...hosted in the United States and intended for U.S.-based facility operators", so the quote loses its full stop.
-- The homepage now carries the "Verified listing" badge linking to the card (dofollow, rel="noopener").
update public.directory_facts set
  value = 'Standard price with no end date: USD 24 a month or USD 199 a year per location, not going up after 20 November 2026',
  source_url = 'https://sdsentry.0xpi.com/faq.html',
  evidence = 'That is the standard price with no end date: it does not go up after November 20, 2026.',
  provided_by = 'editor', checked_on = '2026-10-25', confirmed = true, confirmed_on = '2026-10-25'
where id = 417;
update public.directory_facts set
  source_url = 'https://sdsentry.0xpi.com/faq.html',
  evidence = 'The app, its labels and its training guides are in English.',
  provided_by = 'editor', checked_on = '2026-10-25', confirmed = true, confirmed_on = '2026-10-25'
where id = 18105;
update public.directory_facts set evidence = 'The service is hosted in the United States', checked_on = '2026-10-25',
  confirmed = true, confirmed_on = '2026-10-25'
where id = 3108;
update public.directory_entries set last_verified = '2026-10-25' where id = 28;

-- History (s103): must stay the last statement.
select * from directory_snapshot('2026-10-25');
