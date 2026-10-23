-- 136 - fourth claim in the directory: SDSentry (entry 28, "SDSentry (0xpi)"), plus SQ Label's FAQ line, 2026-10-23 (s115).
-- Claim: Dale Weaver wrote from dale.weaver@0xpi.com on 2026-10-21 21:16 Kyiv (18:16 UTC), after a first reply from a personal
-- address that our rule does not accept. Right to claim: 0xpi.com is the host of the entry URL (sdsentry.0xpi.com), and the homepage
-- says "built and operated by Dale Weaver, a sole proprietor doing business as 0xpi and as SDSentry. The same person answers
-- dale.weaver@0xpi.com". He confirmed the card line by line on 2026-10-23 (all twelve lines OK) with these changes:
--   languages: English only (owner statement, no page says it) -> new fact 18105;
--   SDS formats: PDF, JSON, CSV (opens in Excel), no native Excel file -> new format code csv, fact 3111 excel_csv -> csv;
--   trial: add "up to 5 chemicals with no card" (login.html, checked in the browser pane 21.10 and 23.10) -> new fact 18106;
--   price: USD 24 / 199 stays for new customers after 20 November 2026 ("regularly $49" leaves the site that day) -> fact 417 rewritten
--   as an owner note (printed with "stated by the vendor").
-- Owner fields: 57-word description, logo public/directory-logos/sdsentry.png (512 x 512 PNG, 12 972 bytes), pricing and terms links.
-- SQ Label (entry 113): fact 2988 "Used worldwide" was an owner statement; the owner added it to the FAQ (e-mail 2026-10-23, ticket
-- #73941) and the browser pane found "SQ Label is used worldwide" on https://www.sqlabel.com/faq/ -> evidence, editor, confirmed.
-- The seed (scripts/data/directory-v3.json) and src/lib/directoryVocab.ts carry the same values.

-- 1. Vocabulary: CSV as its own format (appended; sort 9 = after html).
insert into public.directory_vocab (vocab, code, label, sort, legacy, vocab_version)
values ('format', 'csv', 'CSV', 9, '{}', '2026-10-23');

-- 2. The entry becomes claimed.
update public.directory_entries set
  tier = 'claimed', claimed_on = '2026-10-21', owner_confirmed_on = '2026-10-23', logo_path = 'sdsentry.png',
  owner_description = 'SDSentry keeps a workplace''s safety data sheets in one place: it finds the current manufacturer SDS for each product, flags sheets that are missing or out of date, and gives staff a QR code to open any sheet on a phone. USD 24 per location a month; try it on up to 5 chemicals with no card.',
  pricing_url = 'https://sdsentry.0xpi.com/#pricing', terms_url = 'https://sdsentry.0xpi.com/terms.html', last_verified = '2026-10-23'
where id = 28;

-- 3. Changed facts.
update public.directory_facts set value = 'csv',
  detail = 'CSV exports that open in Excel (training records, audit log, Tier II); no native Excel file',
  provided_by = 'owner', checked_on = '2026-10-23', confirmed = true, confirmed_on = '2026-10-23'
where id = 3111;
update public.directory_facts set
  value = 'USD 24 a month or USD 199 a year per location, kept for new customers after 20 November 2026 with no end date',
  evidence = null, provided_by = 'owner', checked_on = '2026-10-23', confirmed = null, confirmed_on = null
where id = 417;
update public.directory_facts set evidence = 'SQ Label is used worldwide', provided_by = 'editor', checked_on = '2026-10-23',
  confirmed = true, confirmed_on = '2026-10-23'
where id = 2988;

-- 4. New facts.
insert into public.directory_facts
  (id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, provided_by, num, num_qual, unit, confirmed, confirmed_on)
values
  (18105, 28, 'language', 'interface', 'English only', 'en', null, 'https://sdsentry.0xpi.com/', null, 0, '2026-10-23', 'owner',
   1, 'exact', 'named', null, null),
  (18106, 28, 'free_trial', 'free_tier', 'Up to 5 chemicals with no card, before the 7-day trial', null, null,
   'https://sdsentry.0xpi.com/login.html', 'Try it on up to 5 chemicals first, no card needed', 1, '2026-10-23', 'editor',
   null, null, null, true, '2026-10-23');

-- 5. The claim (service_role only; the public seed never carries claimant fields).
insert into public.directory_claims (entry_id, owner_email, owner_domains, owner_name, owner_role, requested_at, verified_at, note)
values (28, 'dale.weaver@0xpi.com', '{0xpi.com}', 'Dale Weaver', 'Owner (sole proprietor)',
        '2026-10-21 18:16:00+00', '2026-10-23 12:00:00+00',
        'Claim by e-mail from dale.weaver@0xpi.com (address named on the SDSentry homepage) after the wave-2 letter of 2026-10-07. Owner supplied: line-by-line OK of all twelve card lines, English only, CSV not Excel, the 5-chemical no-card start, price kept after 20 November 2026, 57-word description, logo (512 px PNG), pricing and terms links. verified_at = date of the line-by-line reply.');

-- History (s103): must stay the last statement.
select * from directory_snapshot('2026-10-23');
