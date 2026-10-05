-- 92-directory-affiliate-off.sql — архив миграции s92_directory_affiliate_off_brady_avery_seton (применена Claude через MCP, 05.10.2026)
--
-- Почему: посев пометил Brady (#38), Avery (#42) и Seton (#44) «Affiliate relationship: ghslabels.com» по
-- правилу 4 §18.2 — на основании планов ghslabels (§8). Сергей 05.10: партнёрств с Avery, Brady и Seton НЕТ.
-- Пометка партнёрства там, где его нет, — такая же неправда, как скрытое партнёрство.
--
-- До:    affiliate = 'ghslabels' у id 38, 42, 44; партнёров всего 5.
-- После: affiliate = null у id 38, 42, 44; партнёров 2 (ExactSDS #1 и SDS Manager #24, оба sds_manager).
-- Посев: scripts/data/directory-v3.json правлен так же (иначе повторная заливка вернула бы пометку).
-- Откат: update public.directory_entries set affiliate = 'ghslabels' where id in (38, 42, 44);
--        — только когда партнёрство действительно заключено, и вместе с посевом.

update public.directory_entries
   set affiliate = null, updated_at = now()
 where id in (38, 42, 44) and affiliate = 'ghslabels';

do $$
declare n int; m int;
begin
  select count(*) into n from public.directory_entries where affiliate = 'ghslabels';
  select count(*) into m from public.directory_entries where affiliate is not null;
  if n <> 0 or m <> 2 then
    raise exception 'post-check failed: ghslabels=% , affiliates total=% (expected 0 and 2)', n, m;
  end if;
end $$;
