-- 117 - emergency lines: re-check of the first two seeds against official pages (2026-10-15).
--
-- Changes drafts only: no row becomes live, the public still sees nothing. One new draft row (Spain, line for physicians).
-- What changed and why:
--   HR  country: the 2009 rulebook was repealed by the Chemicals Act (NN 18/2013, art. 31 item 4), so the rule kind is
--       no_rule_found; the service CKO now has a dated notice (7 March 2022) and is confirmed.
--   IE  country/services: the professionals number is printed as text on the contact page (with a second number); the
--       fee page prints no date (the earlier text used a hidden metadata date).
--   GR, ES: current official pages of the Ministry of Health and of the Service itself replace the old PDF and report.
--   BG  : a second ministry page prints a different number under the same label; the row stays unconfirmed.
--   DE, IT: hours and audience read on the own pages of the centres; four Italian centres move to confirmed.
--   CY  : two further pages of the Department of Labour Inspection state round-the-clock operation.
-- Run the WHOLE file in the Supabase SQL Editor in one go. To undo, re-run the matching rows of 115 and 116.
-- Status: applied in the Supabase SQL Editor on 2026-10-15; counts verified afterwards (54 services, 0 live, 44 confirmed,
-- 9 dated_source, 1 unconfirmed); every long text in this file found identical in the database; the public role sees 0 rows.
begin;

update public.emergency_countries set
  sds_rule_kind = 'no_rule_found',
  sds_rule_summary = 'The 2009 rulebook on the content of safety data sheets, which said section 1.4 should give the company number and/or that of the competent official advisory body, was repealed by the Chemicals Act (Official Gazette 18/2013), which says a safety data sheet must be completed as Regulation (EC) 1907/2006 prescribes. No separate Croatian rule on the emergency number in section 1.4 was found. The page of the Croatian Institute of Public Health says a safety data sheet must be entirely in Croatian and describes a separate Croatian filing with a fee.',
  sds_rule_source_url = 'https://narodne-novine.nn.hr/clanci/sluzbeni/2013_02_18_294.html',
  updated_at = now()
where country_code = 'HR';

update public.emergency_countries set
  sds_rule_summary = 'The National Poisons Information Centre (NPIC) states that a poison-centre emergency number is obligatory in section 1.4 for notified hazardous mixtures and that an additional external number may be added. Its number can be used only after notification, a signed agreement and indemnity, and an annual retainer (EUR 650 excluding VAT per company, EUR 200 for companies notifying fewer than 10 products; the page prints no date). Suppliers should state that the NPIC line is open from 8 am to 10 pm every day.',
  sds_rule_source_url = 'https://poisons.ie/industry-manufacturers/safety-data-sheets/',
  updated_at = now()
where country_code = 'IE';

update public.emergency_countries set
  sds_rule_summary = 'The Department of Labour Inspection says suppliers must put the Cyprus Poison Centre number in section 1.4 for products on the Cyprus market; the number is free and for health or medical emergencies only. The Greek-language safety data sheet must be uploaded with each notification. The page does not say who runs the service or its hours, and does not say whether an own number of the supplier may be added. Two other pages of the Department state that 1401 operates 24 hours a day, 7 days a week; neither carries an update date, and no page read names the operator.',
  updated_at = now()
where country_code = 'CY';

update public.emergency_services set
  audience = 'public',
  source_url = 'https://www.mjusticia.gob.es/es/institucional/organismos/instituto-nacional/servicios/servicio-informacion/servicio-informacion1',
  source_date = null,
  verification = 'confirmed',
  sds_use_note = 'The page of the Service says it answers people without health training on this number and gives physicians a separate number, and that it is available 24 hours a day, 365 days a year. The ECHA table of 3 January 2024 lists the same number as the national emergency telephone number of the Spanish poison centre.',
  updated_at = now()
where country_code = 'ES' and slug = 'sit-intcf';

insert into public.emergency_services
  (country_code, slug, kind, name, operator, phone_display, phone_tel, hours_kind, hours_note, audience, languages,
   sds_use, sds_use_note, cost_note, source_url, source_date, verification, checked_on, state, sort)
values
  ('ES', 'sit-intcf-physicians', 'poison_centre', 'Servicio de Información Toxicológica (SIT), line for physicians',
   'Instituto Nacional de Toxicología y Ciencias Forenses (INTCF)', '+34 91 411 26 76', '+34914112676', 'not_stated', null,
   'professionals_only', '{es}', 'professionals_line',
   'Printed on the same page as the public number and labelled for physicians only ("solo para médicos").', null,
   'https://www.mjusticia.gob.es/es/institucional/organismos/instituto-nacional/servicios/servicio-informacion/servicio-informacion1',
   null, 'confirmed', '2026-10-15', 'draft', 1);

update public.emergency_services set
  source_url = 'https://www.moh.gov.gr/articles/citizen/xrhsima-thlefwna-amp-dieythynseis/203-210-7793777-kentro-dhlhthriasewn',
  source_date = null,
  verification = 'confirmed',
  sds_use_note = 'Page of the Ministry of Health: the centre works 24 hours a day, 7 days a week and gives guidance on poisoning to doctors, hospitals and the public. The contact page of the hospital prints the same number for the line that works every day and hour, and the 2019 hospital PDF and the ECHA table give it too. No page read ties the number to safety data sheets.',
  cost_note = 'The Ministry page says the information is provided free of charge.',
  updated_at = now()
where country_code = 'GR' and slug = 'poison-centre-kyriakou';

update public.emergency_services set
  source_url = 'https://www.imi.hr/hr/2022/07/03/obavijest-dostupnost-telefonske-savjetodavne-sluzbe-centra-za-kontrolu-otrovanja/',
  source_date = '2022-03-07',
  verification = 'confirmed',
  sds_use_note = 'A notice of 7 March 2022, signed by the head of the Centre, says the line is available to health workers and the public 24 hours a day, every day. The main page describes it as mainly for health institutions and staff and also open to citizens and users abroad. Neither page ties the number to safety data sheets.',
  updated_at = now()
where country_code = 'HR' and slug = 'cko-imi';

update public.emergency_services set
  source_url = 'https://poisons.ie/contact-us/',
  hours_note = 'The contact page says 8 am to 10 pm every day; the page for the public states no hours.',
  updated_at = now()
where country_code = 'IE' and slug = 'npic-public';

update public.emergency_services set
  phone_display = '01 809 2566 (or 01 837 9964)',
  source_url = 'https://poisons.ie/contact-us/',
  hours_note = 'Staffed in Dublin 8 am to 10 pm; calls outside those hours transfer to the UK National Poisons Information Service. The contact page says 24 hours.',
  sds_use_note = 'The contact page prints the number as text: "Healthcare professionals: Call 01 809 2566 or 01 837 9964 (24 hours)". The professionals page shows 01 809 2566 in image alt text only.',
  updated_at = now()
where country_code = 'IE' and slug = 'npic-professionals';

update public.emergency_services set
  sds_use_note = 'The Ministry of Environment and Water page shows this number under "Emergency number" on a line labelled "Emergency number/ fax", so it may be a fax line; the hospital own pages do not print it. A hospital page of 2017 says its Information Centre gives specialised information on acute poisonings round the clock, without a number. A second page of the same ministry (chemicals.moew.government.bg, no date) prints +359 2 9154 409 under the same label, so the two ministry pages disagree.',
  updated_at = now()
where country_code = 'BG' and slug = 'pirogov-toxicology';

update public.emergency_services set
  cost_note = 'The Health Board page (updated 8 November 2024) says the line is free of charge for all callers. The site of the service itself says the operator charges for the call: one page lists operator rates valid from 1 January 2024, others speak of the local-call rate or the normal tariff.',
  updated_at = now()
where country_code = 'EE' and slug = 'murgistusteabekeskus';

update public.emergency_services set
  sds_use_note = 'Printed with the label "Alarm" on the list of toxicological information centres of the Office for Registration of Medicinal Products. The page carries no date and matches an archived copy from 2015; it was not cross-checked on the centre own site, which could not be read. The page of the clinical toxicology department of the Medical University of Gdańsk (updated 3 March 2021) prints the same number labelled "lekarze" (physicians) and says the department works closely with the Pomorskie Toxicology Centre, the regional clinical toxicology centre since 2008.',
  updated_at = now()
where country_code = 'PL' and slug = 'gdansk-pct';

update public.emergency_services s set
  hours_kind = v.hours_kind,
  audience = v.audience,
  hours_note = v.hours_note,
  updated_at = now()
from (values
  ('berlin', '24_7', 'public_and_professionals', null::text),
  ('bonn', '24_7', 'public_and_professionals', null),
  ('erfurt', '24_7', 'public_and_professionals', null),
  ('freiburg', '24_7', 'public', 'The emergency line is staffed round the clock; general enquiries by telephone Monday to Friday 9:00-12:00 and 14:00-16:00.'),
  ('goettingen', '24_7', 'public_and_professionals', null),
  ('mainz', '24_7', 'public', null),
  ('muenchen', '24_7', 'public_and_professionals', 'The emergency line is staffed round the clock; general enquiries by telephone Monday to Friday 9:00-15:00.')
) as v(slug, hours_kind, audience, hours_note)
where s.country_code = 'DE' and s.slug = v.slug;

update public.emergency_services s set
  source_url = v.source_url,
  source_date = v.source_date,
  hours_kind = v.hours_kind,
  audience = v.audience,
  verification = 'confirmed',
  updated_at = now()
from (values
  ('roma-bambino-gesu', 'https://www.ospedalebambinogesu.it/centro-antiveleni-le-cose-da-sapere-128569/', null::text, 'not_stated', 'public_and_professionals'),
  ('roma-gemelli', 'https://www.policlinicogemelli.it/en/centers/poison-center/', null, '24_7', 'public_and_professionals'),
  ('firenze-careggi', 'https://www.aou-careggi.toscana.it/internet/diagnosi-e-cura/strutture-cliniche/crr-centri-di-riferimento-regionale/centro-antiveleni/', '2026-01-07', '24_7', 'public_and_professionals'),
  ('pavia', 'https://www.icsmaugeri.it/centro-antiveleni-cav-cnit', null, '24_7', 'public_and_professionals')
) as v(slug, source_url, source_date, hours_kind, audience)
where s.country_code = 'IT' and s.slug = v.slug;

update public.emergency_services set
  sds_use_note = 'The page says the number is "always active" ("sempre attivo") for poisoning and intoxication emergencies and names families, general and hospital doctors and health facilities of any region as callers.',
  updated_at = now()
where country_code = 'IT' and slug = 'roma-bambino-gesu';

commit;

-- Check: expect services 54, live 0, confirmed 44, dated_source 9, unconfirmed 1.
select count(*) as services,
       count(*) filter (where state = 'live') as live,
       count(*) filter (where verification = 'confirmed') as confirmed,
       count(*) filter (where verification = 'dated_source') as dated_source,
       count(*) filter (where verification = 'unconfirmed') as unconfirmed
from public.emergency_services;
