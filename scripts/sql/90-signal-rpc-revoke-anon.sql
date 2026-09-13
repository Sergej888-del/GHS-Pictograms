-- 90-signal-rpc-revoke-anon.sql — №120 Turnstile для сигналов инструментов (session 88, 13.09.2026)
--
-- ЗАЧЕМ: три RPC сигналов (record_feature_interest, record_tool_feedback,
-- record_search_miss) с s88 звались из браузера напрямую anon-ключом; единственной
-- защитой были лимиты на клиентский visitor_id. Теперь браузер ходит в Pages
-- Function /api/signal (functions/api/signal.ts): Turnstile → лимит по IP →
-- RPC service-ключом. Чтобы функцию нельзя было обойти, прямой вызов anon
-- закрывается здесь.
--
-- ДО:    EXECUTE на трёх RPC у anon и authenticated (88-*, 89-*).
-- ПОСЛЕ: EXECUTE только у владельца (postgres) и service_role (владелец объектов
--        public — postgres, service_role — суперпользовательская роль Supabase,
--        грант ей не нужен). anon/authenticated → 42501.
-- ROLLBACK: grant execute on function public.record_feature_interest(text,text,text,uuid,text) to anon, authenticated;
--           grant execute on function public.record_tool_feedback(text,text,uuid,text[],text,text) to anon, authenticated;
--           grant execute on function public.record_search_miss(text,text,uuid,text) to anon, authenticated;
--           — и вернуть toolSignals.ts на прямой supabase.rpc (коммит ed196cc).
--
-- ⚠ Классификатор (/api/classify) и его RPC (get_classifier_profile и др.) здесь
-- не трогаются — они и так закрыты для anon с s78/s80.

revoke execute on function public.record_feature_interest(text, text, text, uuid, text) from anon, authenticated;
revoke execute on function public.record_tool_feedback(text, text, uuid, text[], text, text) from anon, authenticated;
revoke execute on function public.record_search_miss(text, text, uuid, text) from anon, authenticated;

do $$
declare n int;
begin
  select count(*) into n from information_schema.routine_privileges
    where specific_schema = 'public'
      and routine_name in ('record_feature_interest', 'record_tool_feedback', 'record_search_miss')
      and grantee in ('anon', 'authenticated', 'PUBLIC') and privilege_type = 'EXECUTE';
  if n <> 0 then raise exception 'signal RPC: у anon/authenticated/PUBLIC осталось % грантов EXECUTE, ожидалось 0', n; end if;
end $$;

-- VERIFICATION (как anon, метод s78 pg_temp.try):
--   set local role anon;
--   select public.record_search_miss('x','probe','00000000-0000-4000-8000-000000000003',null);  → 42501
--   select public.record_feature_interest('save_result','x',null,'00000000-0000-4000-8000-000000000003'); → 42501
--   select public.record_tool_feedback('x',null,'00000000-0000-4000-8000-000000000003',array['api'],null,null); → 42501
--   reset role;  (как postgres — вызовы работают, строки удалить)
