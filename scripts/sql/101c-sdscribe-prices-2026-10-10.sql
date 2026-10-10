-- s101 (10.10.2026, evening). Applied by `npm run import:directory` from scripts/data/directory-v3.json
-- (writing these rows through the Supabase MCP was refused by the tool), then the confirm step below.
--
-- SDScribe (entry 86): card prices were out of date (USD 795 / 1,449). Purchase page and home page now say
-- USD 1,595 / USD 2,795. Facts 1025, 1026, 1027 rewritten with source https://www.sdscribe.com/purchase;
-- new facts 2280 (language option USD 695) and 2281 (upgrade USD 615). Prices are in the raw HTML; checked in
-- the built-in browser with the same HTML strip as check:directory.
--
-- GHS Mixture Calculator (entry 12): moved to not-listed. ghsmixtures.com is no longer in the .com zone
-- (dns.google: NXDOMAIN answered by gtld-servers on 2026-10-10; whois still shows it registered). Re-check later.

update directory_facts set confirmed=true, confirmed_on='2026-10-10'
where id in (1025, 1026, 1027, 2280, 2281) and confirmed is distinct from true;
