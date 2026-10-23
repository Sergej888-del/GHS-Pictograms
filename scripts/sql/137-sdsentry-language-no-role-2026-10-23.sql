-- 137 - fix to SQL 136 (2026-10-23, s115): SDSentry fact 18105 "English only" without a language role.
-- The card's Languages line prints only facts with no role or role 'documents' (DirectoryCard.astro, s112); with role 'interface'
-- the owner fact was not printed, and check:dist (dir-claimed) counted 2 unconfirmed owner facts against 1 "stated by the vendor" mark.
-- The owner answered "Languages: English only" for the product as a whole, so no role is the honest reading.
update public.directory_facts set label = null where id = 18105;

-- History (s103): must stay the last statement.
select * from directory_snapshot('2026-10-23');
