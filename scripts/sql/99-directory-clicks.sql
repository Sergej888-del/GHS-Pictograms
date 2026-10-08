-- 99-directory-clicks.sql — №148, session 99 (2026-10-08)
-- Счётчик переходов из каталога на сайты вендоров — источник правды для письма
-- «we sent you N visitors» (первое обещание — SQ Label, отчёт через 90 дней).
--
-- ЗАЧЕМ СВОЯ ТАБЛИЦА: GA4 видит только тех, кто принял cookie; Umami засорён
-- бот-роем (Сингапур/Китай, ~80 % «посетителей» в сутки) и хранит 6 месяцев.
-- Цифру, которую показываем вендору, считаем сами, как feature_interest (88-*).
--
-- ⚠ ДВА ФАЙЛА:
--   99-directory-clicks.sql    (этот, v1) — ПРИМЕНЁН через Supabase MCP 08.10
--                               (миграция directory_clicks_v1). Повторно НЕ запускать.
--   99b-directory-clicks-v2.sql (v2)      — колонки placement/asn и RPC по category+slug.
--
-- ДО:    таблицы public.directory_clicks нет.
-- ПОСЛЕ: таблица закрыта для anon/authenticated (RLS, политик нет, грантов нет);
--        единственный вход — RPC record_directory_click(...) SECURITY DEFINER,
--        EXECUTE ТОЛЬКО у service_role (зовёт functions/api/directory-click.ts).
--        IP не хранится. visitor_id — дневной ключ, считается на сервере.
-- ROLLBACK: drop view public.directory_click_stats;
--           drop function public.record_directory_click(text,text,text,text,uuid,text,text,text,bigint);
--           drop table public.directory_clicks;
--
-- ОТЧЁТ ДЛЯ ВЕНДОРА (пример — SQ Label, sq-label в label-design-printing):
--   select * from public.directory_click_stats where slug = 'sq-label';
--   -- по странам, без дата-центров (если asn заполнен — смотрим и его):
--   select c.country, count(*) as clicks, count(distinct c.visitor_id) as visitor_days
--   from public.directory_clicks c join public.directory_entries e on e.id = c.entry_id
--   where e.slug = 'sq-label' and c.created_at >= now() - interval '90 days'
--   group by c.country order by clicks desc;
--   -- сети с наибольшим числом кликов — проверить, нет ли там дата-центров:
--   select asn, count(*) from public.directory_clicks group by asn order by 2 desc limit 20;

create table public.directory_clicks (
  id          bigint generated always as identity primary key,
  entry_id    integer not null references public.directory_entries(id),
  link_kind   text    not null check (link_kind ~ '^[a-z_]{1,20}$'),
  target_host text,
  page        text,
  country     text check (country is null or country ~ '^[A-Z0-9]{2}$'),
  visitor_id  uuid    not null,
  created_at  timestamptz not null default now()
);

create index directory_clicks_entry_created_idx on public.directory_clicks (entry_id, created_at);
create index directory_clicks_visitor_day_idx   on public.directory_clicks (visitor_id, created_at);

alter table public.directory_clicks enable row level security;
revoke all on table public.directory_clicks from anon, authenticated;

-- (v1-функция по entry_id удалена в 99b — здесь не повторяется)

create view public.directory_click_stats
with (security_invoker = true) as
select
  e.id        as entry_id,
  e.category,
  e.slug,
  e.title,
  e.vendor,
  count(c.id)                                                          as clicks_total,
  count(distinct c.visitor_id)                                         as visitors_total,
  count(distinct c.visitor_id) filter (where c.created_at >= now() - interval '30 days') as visitors_30d,
  count(distinct c.visitor_id) filter (where c.created_at >= now() - interval '90 days') as visitors_90d,
  min(c.created_at)                                                    as first_click,
  max(c.created_at)                                                    as last_click
from public.directory_entries e
join public.directory_clicks c on c.entry_id = e.id
group by e.id, e.category, e.slug, e.title, e.vendor;

revoke all on table public.directory_click_stats from anon, authenticated;
