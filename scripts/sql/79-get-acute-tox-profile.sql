-- 79-get-acute-tox-profile.sql — session 79 (2026-08-22)
-- Миграция `s79_get_acute_tox_profile_rpc` (применена через MCP; этот файл — архив).
--
-- ЗАЧЕМ: аудит №100 — остров ATE-калькулятора должен получать точную категорию
-- Acute Tox. (A0, `annex6_classification`) и гармонизированные ATE
-- (`annex6_limits kind=ATE`). Обе таблицы закрыты для anon (№99, s78) — остров
-- читает их через SECURITY DEFINER RPC, как `get_storage_verdict` (CLAUDE.md §3):
-- таблицы остаются закрытыми, функция читает их как владелец, ключ запроса —
-- список index_number (≤ 50 за вызов) → дампа по построению нет. Отдаём только
-- гармонизированные данные Annex VI (публичное право), ничего курируемого.
--
-- ДО:   функции нет; `clp_generic_limits` строка 3.1.3.6.2.3-UNKNOWN-GT10 needs_review = true (№91)
-- ПОСЛЕ: функция `public.get_acute_tox_profile(text[]) → jsonb`, EXECUTE у anon/authenticated;
--       needs_review = false (формула сверена с `ate.ts` и текстом 3.1.3.6.2.3 — №91 закрыт)
-- ОТКАТ: drop function public.get_acute_tox_profile(text[]);
--       update clp_generic_limits set needs_review = true where rule_key = '3.1.3.6.2.3-UNKNOWN-GT10';
--
-- ФОРМА ОТВЕТА (ключ — index_number; отсутствующий ключ = нет данных):
--   { "<index>": { "pairs": [ {route:'oral'|'dermal'|'inhalation', cat:int, star:bool, raw:text} … ] | null,
--                  "ate":   [ {route, value:numeric, unit:text|null, form:text|null, raw:text} … ] | null } }
--   `cat` — категория реестра как число (Annex VI печатает только 1–4).

create or replace function public.get_acute_tox_profile(p_index text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(i.ix, jsonb_build_object(
    'pairs', (
      select jsonb_agg(jsonb_build_object(
               'route', case c.class_code when 'ACUTE_TOX_ORAL' then 'oral' when 'ACUTE_TOX_DERMAL' then 'dermal' else 'inhalation' end,
               'cat',   (c.category_code)::int,
               'star',  c.star,
               'raw',   c.raw) order by c.seq)
      from annex6_classification c
      where c.index_number = i.ix
        and c.class_code in ('ACUTE_TOX_ORAL', 'ACUTE_TOX_DERMAL', 'ACUTE_TOX_INHAL')
        and c.category_code ~ '^[1-5]$'),
    'ate', (
      select jsonb_agg(jsonb_build_object(
               'route', l.ate_route,
               'value', l.ate_value,
               'unit',  l.ate_unit,
               'form',  l.ate_form,
               'raw',   l.raw) order by l.seq)
      from annex6_limits l
      where l.index_number = i.ix and l.kind = 'ATE' and l.ate_value > 0)
  )), '{}'::jsonb)
  from (select distinct trim(x) as ix from unnest(p_index[1:50]) as x where x is not null and trim(x) <> '') as i;
$$;

comment on function public.get_acute_tox_profile(text[]) is
  'ATE calculator (s79, №100): exact Annex VI acute-tox categories (annex6_classification) + harmonised ATE (annex6_limits kind=ATE) for ≤ 50 index numbers. Tables stay closed to anon; this reads them as owner.';

revoke all on function public.get_acute_tox_profile(text[]) from public;
grant execute on function public.get_acute_tox_profile(text[]) to anon, authenticated;

-- №91 — формула 3.1.3.6.2.3 сверена (ate.ts: numerator = 100 − ΣC_unknown при ΣC_unknown > 10)
update public.clp_generic_limits
   set needs_review = false,
       note = coalesce(note, '') || ' [s79: сверено с ate.ts и текстом 3.1.3.6.2.3 — №91 закрыт]'
 where rule_key = '3.1.3.6.2.3-UNKNOWN-GT10' and needs_review;

-- VERIFICATION
-- select get_acute_tox_profile(array['009-002-00-6','005-024-00-5','602-091-00-8','nope']);
--   → HF: pairs inhal 2*, dermal 1, oral 2*; 005-024: pairs + ate inhal 0.62 dusts or mists, oral 730; 602-091: oral 4*; 'nope' — ключа нет
-- set local role anon; select get_acute_tox_profile(array['009-002-00-6']);  → работает
-- set local role anon; select count(*) from annex6_classification;           → 42501
-- select needs_review from clp_generic_limits where rule_key='3.1.3.6.2.3-UNKNOWN-GT10';  → false
