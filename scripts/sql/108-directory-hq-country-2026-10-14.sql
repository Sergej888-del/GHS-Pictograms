-- 2026-10-14: A1.5 - hq_country + hq_country_source for 15 live directory entries (s108).
-- Each country comes from the vendor's own page (the URL is stored in hq_country_source); the comment on each line says what the page states.
-- Run the WHOLE file in the Supabase SQL Editor in one go. Rollback is at the end of the file.
-- The same values are in scripts/data/directory-v3.json, so a repeated import:directory will not overwrite them.
begin;
update directory_entries set hq_country = 'US', hq_country_source = 'https://www.ul.com/impressum' where id = 2 and state = 'live' and hq_country is null;  -- UL Solutions, Impressum: 333 Pfingsten Road, Northbrook, Illinois
update directory_entries set hq_country = 'AU', hq_country_source = 'https://chemwatch.net/contact/' where id = 3 and state = 'live' and hq_country is null;  -- Chemwatch, Contact: "Australia HQ", 1227 Glen Huntly Road, Glen Huntly VIC
update directory_entries set hq_country = 'US', hq_country_source = 'https://sphera.com/imprint/' where id = 16 and state = 'live' and hq_country is null;  -- Sphera, Imprint: Sphera Solutions, Inc., 130 E Randolph St, Chicago, IL
update directory_entries set hq_country = 'US', hq_country_source = 'https://www.seton.com/global-locations.html' where id = 44 and state = 'live' and hq_country is null;  -- Seton, Worldwide Locations: "Seton Corporate Headquarters", Milwaukee, WI
update directory_entries set hq_country = 'FR', hq_country_source = 'https://www.oecd.org/en/about/locations.html' where id = 53 and state = 'live' and hq_country is null;  -- OECD, Locations: "OECD Paris Headquarters", 2 rue Andre Pascal, Paris
update directory_entries set hq_country = 'US', hq_country_source = 'https://www.freyrsolutions.com/press-releases/freyr-continues-global-growth-with-mexico-office-launch' where id = 61 and state = 'live' and hq_country is null;  -- Freyr, press release: "Headquartered in Princeton (New Jersey, USA)"
update directory_entries set hq_country = 'US', hq_country_source = 'https://www.ul.com/impressum' where id = 69 and state = 'live' and hq_country is null;  -- UL Solutions, Impressum: 333 Pfingsten Road, Northbrook, Illinois
update directory_entries set hq_country = 'BE', hq_country_source = 'https://www.enhesa.com/recruitment-privacy-policy' where id = 73 and state = 'live' and hq_country is null;  -- Enhesa, Recruitment Privacy Policy, contact block: Avenue Louise 287, 1050 Brussels, Belgium (the page does not use the word "headquarters")
update directory_entries set hq_country = 'US', hq_country_source = 'https://www.acs.org/content/dam/acsorg/about/governance/governance-directory.pdf' where id = 77 and state = 'live' and hq_country is null;  -- American Chemical Society, governance directory: 1155 16th Street NW, Washington DC; lists the Chemical Health and Safety division
update directory_entries set hq_country = 'US', hq_country_source = 'https://www.sdscribe.com/contact' where id = 86 and state = 'live' and hq_country is null;  -- SDScribe, Contact: Hazard Solutions LLC, San Mateo, CA
update directory_entries set hq_country = 'CA', hq_country_source = 'https://www.cgi.com/canada/en-ca/offices' where id = 94 and state = 'live' and hq_country is null;  -- CGI, Offices: "Montreal - Head office"
update directory_entries set hq_country = 'US', hq_country_source = 'https://helioscomply.com/privacy-policy/' where id = 97 and state = 'live' and hq_country is null;  -- Helios Comply, Privacy Policy: "Helios is based in the United States"
update directory_entries set hq_country = 'US', hq_country_source = 'https://www.tpgtex.com/contact-pls.html' where id = 114 and state = 'live' and hq_country is null;  -- TPGTEX, Contact: 1 Mockingbird Circle, Houston, Texas
update directory_entries set hq_country = 'US', hq_country_source = 'https://www.3eco.com/locations/' where id = 121 and state = 'live' and hq_country is null;  -- 3E, Locations: "3E Headquarters: Carlsbad, California"
update directory_entries set hq_country = 'GB', hq_country_source = 'https://www.intertek.com/investors/contacts/' where id = 128 and state = 'live' and hq_country is null;  -- Intertek, Investor contacts: Registered Office, 33 Cavendish Square, London
commit;

-- Check: must return 15 rows with the country filled in.
select id, title, hq_country, hq_country_source from directory_entries where id in (2,3,16,44,53,61,69,73,77,86,94,97,114,121,128) order by id;

-- Rollback (only if you need to undo):
-- update directory_entries set hq_country = null, hq_country_source = null where id in (2,3,16,44,53,61,69,73,77,86,94,97,114,121,128);
