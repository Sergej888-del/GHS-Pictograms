-- 88-feature-interest.sql — №142, session 88 (2026-09-12)
-- Замер спроса на «Save this result» (сохранение результатов / личный кабинет).
--
-- ЗАЧЕМ: решение 04.09 — кабинет (Фаза D) строим только если люди жмут кнопку
-- «Save this result». GA4 для этого не годится (consent, блокировщики, боты —
-- s86: GA4 показал 2 партнёрских клика против ~110 в FirstPromoter). Источник
-- правды — своя таблица.
--
-- ДО:    таблицы public.feature_interest нет; RPC record_feature_interest нет.
-- ПОСЛЕ: таблица закрыта для anon/authenticated (RLS включён, политик нет,
--        грантов нет — default privileges закрыты с s78); единственный вход —
--        RPC record_feature_interest(...) SECURITY DEFINER, EXECUTE у anon и
--        authenticated, у PUBLIC отозван.
--        Лимиты внутри RPC: ≤ 5 кликов и ≤ 2 email на visitor_id в сутки.
--        Email (необязательный, «Tell me when it's ready») пишется в
--        feature_interest.email И в leads (use_case = 'save_result_notify',
--        ON CONFLICT (email, source_tool) DO NOTHING — старый лид не трогаем).
-- ROLLBACK: drop function public.record_feature_interest(text,text,text,uuid,text);
--           drop table public.feature_interest;
--           delete from public.leads where use_case = 'save_result_notify';
--
-- ОТЧЁТ (порог решения, названный 12.09: за 30 дней ≥ 15 уникальных нажавших
-- на конструкторе ИЛИ ≥ 30 уникальных по всем инструментам → строим кабинет):
--   select tool,
--          count(*) filter (where email is null)                     as clicks,
--          count(distinct visitor_id) filter (where email is null)   as unique_visitors,
--          count(*) filter (where email is not null)                 as emails
--   from public.feature_interest
--   where feature = 'save_result' and created_at >= now() - interval '30 days'
--   group by tool order by unique_visitors desc;

begin;

create table public.feature_interest (
  id          bigint generated always as identity primary key,
  feature     text        not null,
  tool        text        not null,
  page        text,
  visitor_id  uuid        not null,
  email       text,
  created_at  timestamptz not null default now(),
  constraint feature_interest_feature_chk check (feature in ('save_result')),
  constraint feature_interest_tool_chk    check (length(tool) between 1 and 40),
  constraint feature_interest_page_chk    check (page is null or length(page) <= 200)
);
comment on table public.feature_interest is
  '№142 замер спроса: клики «Save this result» по инструментам. Закрыта для anon; вход только через record_feature_interest().';

create index feature_interest_visitor_day_idx
  on public.feature_interest (visitor_id, created_at);
create index feature_interest_feature_created_idx
  on public.feature_interest (feature, created_at);

alter table public.feature_interest enable row level security;
-- политик нет и грантов нет: таблица читается/пишется только владельцем (postgres)
-- и SECURITY DEFINER-функцией ниже.

create or replace function public.record_feature_interest(
  p_feature text,
  p_tool    text,
  p_page    text default null,
  p_visitor uuid default null,
  p_email   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email    text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_today    timestamptz := date_trunc('day', now());
  v_clicks   int;
  v_emails   int;
  v_page     text := left(coalesce(p_page, ''), 200);
begin
  if p_visitor is null or p_feature is null or p_tool is null or length(p_tool) not between 1 and 40 then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  if p_feature <> 'save_result' then
    return jsonb_build_object('ok', false, 'reason', 'unknown_feature');
  end if;

  if v_email is not null then
    -- путь «Tell me when it's ready»: ≤ 2 email-строк на посетителя в сутки
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 254 then
      return jsonb_build_object('ok', false, 'reason', 'bad_email');
    end if;
    select count(*) into v_emails from public.feature_interest
      where visitor_id = p_visitor and email is not null and created_at >= v_today;
    if v_emails >= 2 then
      return jsonb_build_object('ok', true, 'counted', false, 'reason', 'rate_limited');
    end if;
    insert into public.feature_interest (feature, tool, page, visitor_id, email)
      values (p_feature, p_tool, nullif(v_page, ''), p_visitor, v_email);
    insert into public.leads (email, source_tool, source_domain, source_page, use_case, qualification_notes)
      values (v_email, p_tool, 'ghspictograms.com', nullif(v_page, ''), 'save_result_notify',
              'Asked to be told when saved results are available (№142, ' || to_char(now(), 'YYYY-MM-DD') || ')')
      on conflict (email, source_tool) do nothing;
    return jsonb_build_object('ok', true, 'counted', true, 'email_saved', true);
  end if;

  -- путь «клик»: ≤ 5 строк на посетителя в сутки (от накруток и headless-парка s85)
  select count(*) into v_clicks from public.feature_interest
    where visitor_id = p_visitor and email is null and created_at >= v_today;
  if v_clicks >= 5 then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'rate_limited');
  end if;
  insert into public.feature_interest (feature, tool, page, visitor_id)
    values (p_feature, p_tool, nullif(v_page, ''), p_visitor);
  return jsonb_build_object('ok', true, 'counted', true);
end;
$$;

revoke all on function public.record_feature_interest(text, text, text, uuid, text) from public;
grant execute on function public.record_feature_interest(text, text, text, uuid, text) to anon, authenticated;

-- post-check: таблица закрыта, функция открыта ровно двум ролям
do $$
declare
  n_tab int;
  n_fn  int;
begin
  select count(*) into n_tab from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'feature_interest' and grantee in ('anon', 'authenticated');
  if n_tab <> 0 then raise exception 'feature_interest: у anon/authenticated есть гранты (%), ожидалось 0', n_tab; end if;
  select count(*) into n_fn from information_schema.routine_privileges
    where specific_schema = 'public' and routine_name = 'record_feature_interest'
      and grantee in ('anon', 'authenticated') and privilege_type = 'EXECUTE';
  if n_fn <> 2 then raise exception 'record_feature_interest: EXECUTE у % ролей, ожидалось 2', n_fn; end if;
end $$;

commit;

-- VERIFICATION (после применения, как anon):
--   set local role anon;
--   select public.record_feature_interest('save_result','label-maker','/ghs-label-maker/','00000000-0000-4000-8000-000000000001');
--     → {"ok":true,"counted":true}
--   select * from public.feature_interest;  → 42501 permission denied
--   reset role;  delete from public.feature_interest where visitor_id = '00000000-0000-4000-8000-000000000001';
