-- 89-tool-feedback-search-miss.sql — session 88 (2026-09-12), механизм фидбека по инструментам
--
-- ЗАЧЕМ (решение Сергея 12.09): два слоя обратной связи —
--   C) форма пожеланий на каждом инструменте (чекбоксы + «Something else» + email),
--      открывается из кнопки «Save this result» и из ссылки «Suggest a feature»;
--   E) пассивный сигнал «искал вещество и не нашёл» — строка запроса из пяти
--      островов с поиском (SubstancePicker, MixtureClassifier, ATE, StorageTool,
--      PStatementSelector). Это данные о пробелах базы (№139: MDI, TDI, бутан…),
--      которые до сих пор терялись.
-- ПАТТЕРН тот же, что у feature_interest (88-*.sql): таблицы закрыты для anon,
-- вход только через SECURITY DEFINER RPC с лимитами на visitor_id в сутки.
--
-- ДО:    таблиц tool_feedback и tool_search_miss нет; RPC нет.
-- ПОСЛЕ: tool_feedback (tool, page, visitor_id, wants text[], comment, email) и
--        tool_search_miss (tool, query, query_norm, page, visitor_id); RPC
--        record_tool_feedback(...) и record_search_miss(...), EXECUTE у anon и
--        authenticated, у PUBLIC отозван. Лимиты: фидбек ≤ 3/visitor/сутки,
--        промахи поиска ≤ 30/visitor/сутки, запрос 2–120 знаков, комментарий ≤ 500.
--        Email из формы дублируется в leads (use_case='tool_feedback',
--        ON CONFLICT (email, source_tool) DO NOTHING).
-- ROLLBACK: drop function public.record_tool_feedback(text,text,uuid,text[],text,text);
--           drop function public.record_search_miss(text,text,uuid,text);
--           drop table public.tool_feedback; drop table public.tool_search_miss;
--           delete from public.leads where use_case = 'tool_feedback';
--
-- ОТЧЁТЫ (раз в месяц, и ОТВЕЧАТЬ тем, кто оставил email — это часть механизма):
--   -- пожелания по пунктам
--   select tool, w as want, count(*) as votes, count(distinct visitor_id) as people
--   from public.tool_feedback, unnest(wants) as w
--   where created_at >= now() - interval '30 days'
--   group by tool, w order by people desc, votes desc;
--   -- свободный текст
--   select created_at::date, tool, page, comment, email
--   from public.tool_feedback where comment is not null order by created_at desc;
--   -- чего не находят
--   select tool, query_norm, count(*) as n, count(distinct visitor_id) as people
--   from public.tool_search_miss
--   where created_at >= now() - interval '30 days'
--   group by tool, query_norm order by people desc, n desc limit 100;

create table public.tool_feedback (
  id          bigint generated always as identity primary key,
  tool        text        not null,
  page        text,
  visitor_id  uuid        not null,
  wants       text[]      not null default '{}',
  comment     text,
  email       text,
  created_at  timestamptz not null default now(),
  constraint tool_feedback_tool_chk    check (length(tool) between 1 and 40),
  constraint tool_feedback_page_chk    check (page is null or length(page) <= 200),
  constraint tool_feedback_comment_chk check (comment is null or length(comment) <= 500),
  constraint tool_feedback_wants_chk   check (cardinality(wants) <= 10),
  constraint tool_feedback_nonempty_chk check (cardinality(wants) > 0 or comment is not null or email is not null)
);
comment on table public.tool_feedback is
  'Форма пожеланий на инструментах (C, s88). Закрыта для anon; вход только через record_tool_feedback().';
create index tool_feedback_created_idx on public.tool_feedback (created_at);
create index tool_feedback_visitor_day_idx on public.tool_feedback (visitor_id, created_at);
alter table public.tool_feedback enable row level security;

create table public.tool_search_miss (
  id          bigint generated always as identity primary key,
  tool        text        not null,
  query       text        not null,
  query_norm  text        not null,
  page        text,
  visitor_id  uuid        not null,
  created_at  timestamptz not null default now(),
  constraint tool_search_miss_tool_chk  check (length(tool) between 1 and 40),
  constraint tool_search_miss_query_chk check (length(query) between 2 and 120),
  constraint tool_search_miss_page_chk  check (page is null or length(page) <= 200)
);
comment on table public.tool_search_miss is
  '«Искал и не нашёл» в островах с поиском вещества (E, s88). Закрыта для anon; вход только через record_search_miss().';
create index tool_search_miss_norm_idx on public.tool_search_miss (tool, query_norm);
create index tool_search_miss_visitor_day_idx on public.tool_search_miss (visitor_id, created_at);
alter table public.tool_search_miss enable row level security;

create or replace function public.record_tool_feedback(
  p_tool    text,
  p_page    text default null,
  p_visitor uuid default null,
  p_wants   text[] default '{}',
  p_comment text default null,
  p_email   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_comment text := nullif(left(trim(coalesce(p_comment, '')), 500), '');
  v_wants   text[] := coalesce(p_wants, '{}');
  v_page    text := nullif(left(coalesce(p_page, ''), 200), '');
  v_today   timestamptz := date_trunc('day', now());
  v_n       int;
  w         text;
begin
  if p_visitor is null or p_tool is null or length(p_tool) not between 1 and 40 then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  if cardinality(v_wants) > 10 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_wants');
  end if;
  foreach w in array v_wants loop
    if w is null or w !~ '^[a-z0-9_]{1,40}$' then
      return jsonb_build_object('ok', false, 'reason', 'bad_want');
    end if;
  end loop;
  if v_email is not null and (v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 254) then
    return jsonb_build_object('ok', false, 'reason', 'bad_email');
  end if;
  if cardinality(v_wants) = 0 and v_comment is null and v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  select count(*) into v_n from public.tool_feedback
    where visitor_id = p_visitor and created_at >= v_today;
  if v_n >= 3 then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'rate_limited');
  end if;

  insert into public.tool_feedback (tool, page, visitor_id, wants, comment, email)
    values (p_tool, v_page, p_visitor, v_wants, v_comment, v_email);

  if v_email is not null then
    insert into public.leads (email, source_tool, source_domain, source_page, use_case, qualification_notes)
      values (v_email, p_tool, 'ghspictograms.com', v_page, 'tool_feedback',
              'Tool feedback ' || to_char(now(), 'YYYY-MM-DD') || ': wants=' || array_to_string(v_wants, ',')
              || coalesce(' | ' || v_comment, ''))
      on conflict (email, source_tool) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'counted', true, 'email_saved', v_email is not null);
end;
$$;

create or replace function public.record_search_miss(
  p_tool    text,
  p_query   text,
  p_visitor uuid default null,
  p_page    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q     text := left(regexp_replace(trim(coalesce(p_query, '')), '\s+', ' ', 'g'), 120);
  v_norm  text;
  v_page  text := nullif(left(coalesce(p_page, ''), 200), '');
  v_today timestamptz := date_trunc('day', now());
  v_n     int;
begin
  if p_visitor is null or p_tool is null or length(p_tool) not between 1 and 40 or length(v_q) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  v_norm := lower(v_q);
  select count(*) into v_n from public.tool_search_miss
    where visitor_id = p_visitor and created_at >= v_today;
  if v_n >= 30 then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'rate_limited');
  end if;
  -- один и тот же промах от одного посетителя в одном инструменте за день — одна строка
  if exists (select 1 from public.tool_search_miss
             where visitor_id = p_visitor and tool = p_tool and query_norm = v_norm and created_at >= v_today) then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'duplicate');
  end if;
  insert into public.tool_search_miss (tool, query, query_norm, page, visitor_id)
    values (p_tool, v_q, v_norm, v_page, p_visitor);
  return jsonb_build_object('ok', true, 'counted', true);
end;
$$;

revoke all on function public.record_tool_feedback(text, text, uuid, text[], text, text) from public;
revoke all on function public.record_search_miss(text, text, uuid, text) from public;
grant execute on function public.record_tool_feedback(text, text, uuid, text[], text, text) to anon, authenticated;
grant execute on function public.record_search_miss(text, text, uuid, text) to anon, authenticated;

do $$
declare n_tab int; n_fn int;
begin
  select count(*) into n_tab from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('tool_feedback', 'tool_search_miss')
      and grantee in ('anon', 'authenticated');
  if n_tab <> 0 then raise exception 'tool_feedback/tool_search_miss: у anon/authenticated есть гранты (%), ожидалось 0', n_tab; end if;
  select count(*) into n_fn from information_schema.routine_privileges
    where specific_schema = 'public' and routine_name in ('record_tool_feedback', 'record_search_miss')
      and grantee in ('anon', 'authenticated') and privilege_type = 'EXECUTE';
  if n_fn <> 4 then raise exception 'RPC: EXECUTE у % пар роль×функция, ожидалось 4', n_fn; end if;
end $$;

-- VERIFICATION (после применения, как anon — см. s78-метод pg_temp.try):
--   set local role anon;
--   select public.record_search_miss('storage-matrix','Toluenee ','00000000-0000-4000-8000-000000000002','/tools/x/');
--     → {"ok":true,"counted":true}; повтор → "duplicate"
--   select public.record_tool_feedback('label-maker','/ghs-label-maker/','00000000-0000-4000-8000-000000000002',
--          array['save_results','batch'],'  ','probe@example.com'); → email_saved true, строка в leads
--   select * from public.tool_feedback; → 42501
--   reset role; delete … where visitor_id = '00000000-0000-4000-8000-000000000002'; delete from leads where email='probe@example.com';
