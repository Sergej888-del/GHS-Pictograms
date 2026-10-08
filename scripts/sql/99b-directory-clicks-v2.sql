-- 99b-directory-clicks-v2.sql — №148, session 99 (2026-10-08)
-- Вторая часть счётчика кликов каталога (первая — 99-directory-clicks.sql, уже в базе).
-- ПРИМЕНЁН 08.10 в Supabase SQL Editor (apply_migration через MCP трижды отменялся).
-- Проверка в BEGIN … ROLLBACK: клик → counted; повтор за 30 с → duplicate; contact → counted;
-- чужой kind / несуществующий slug / slug в чужой категории → отказ; кривые place/host/asn → NULL;
-- anon и authenticated — ни RPC, ни таблицы; service_role — EXECUTE. Повторно НЕ запускать.
--
-- Ссылки вендоров на сайте уже размечены data-dir-out=<slug>, data-dir-cat=<category>,
-- data-dir-place=<placement> (s92) — поэтому RPC ищет запись по category+slug
-- (уникальный индекс directory_entries_slug_uq), и HTML трогать не нужно.
-- Таблица на момент v2 пустая — колонки добавляются без риска.

alter table public.directory_clicks
  add column placement text check (placement is null or placement in ('card', 'entry', 'entry-hero', 'table', 'contact')),
  add column asn bigint check (asn is null or asn between 0 and 4294967295);

comment on column public.directory_clicks.visitor_id is
  'Daily visitor key: hash of IP + user agent + UTC date + server secret, computed in functions/api/directory-click.ts. Changes every day, never stored on the device; the IP itself is not stored.';
comment on column public.directory_clicks.asn is
  'Network (autonomous system) number from Cloudflare - lets reports drop data-centre traffic. Names the network operator, not a person.';

drop function if exists public.record_directory_click(integer, text, uuid, text, text, text);

create or replace function public.record_directory_click(
  p_category    text,
  p_slug        text,
  p_link_kind   text,
  p_placement   text,
  p_visitor     uuid,
  p_page        text   default null,
  p_target_host text   default null,
  p_country     text   default null,
  p_asn         bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_kind    text := lower(trim(coalesce(p_link_kind, '')));
  v_place   text := nullif(lower(trim(coalesce(p_placement, ''))), '');
  v_page    text := nullif(left(coalesce(p_page, ''), 200), '');
  v_host    text := nullif(left(lower(trim(coalesce(p_target_host, ''))), 100), '');
  v_country text := nullif(upper(trim(coalesce(p_country, ''))), '');
  v_asn     bigint := case when p_asn between 0 and 4294967295 then p_asn else null end;
  v_today   timestamptz := date_trunc('day', now());
  v_entry   integer;
  v_n       int;
begin
  if p_visitor is null or p_category is null or p_slug is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  if v_kind not in ('website', 'contact') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_kind');
  end if;
  if v_place is not null and v_place not in ('card', 'entry', 'entry-hero', 'table', 'contact') then
    v_place := null;
  end if;
  if v_host is not null and v_host !~ '^[a-z0-9.-]+$' then
    v_host := null;
  end if;
  if v_country is not null and v_country !~ '^[A-Z0-9]{2}$' then
    v_country := null;
  end if;

  select id into v_entry from public.directory_entries
    where category = p_category and slug = p_slug;
  if v_entry is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_entry');
  end if;

  select count(*) into v_n from public.directory_clicks
    where visitor_id = p_visitor and created_at >= v_today;
  if v_n >= 60 then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'rate_limited');
  end if;

  if exists (select 1 from public.directory_clicks
             where visitor_id = p_visitor and entry_id = v_entry and link_kind = v_kind
               and created_at >= now() - interval '30 seconds') then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'duplicate');
  end if;

  insert into public.directory_clicks (entry_id, link_kind, placement, target_host, page, country, asn, visitor_id)
    values (v_entry, v_kind, v_place, v_host, v_page, v_country, v_asn, p_visitor);
  return jsonb_build_object('ok', true, 'counted', true);
end;
$function$;

revoke execute on function public.record_directory_click(text, text, text, text, uuid, text, text, text, bigint) from public, anon, authenticated;
grant  execute on function public.record_directory_click(text, text, text, text, uuid, text, text, text, bigint) to service_role;
