-- scripts/sql/80-classifier-scaffold.sql
-- Архив миграций session 80 (применены через MCP 2026-08-22).
-- Каркас классификатора смесей: design-doc §9 шаг 5 + карточки №103, №99.
--
-- ДО:    в `clp_generic_limits` 115 строк; таблиц `data_release`,
--        `api_rate_limit`, `classifier_share` нет; RPC классификатора нет.
-- ПОСЛЕ: 117 строк правил (добраны `3.1.3.6.1` и `3.1.3.6.1b-NONHAZARD`);
--        три новые таблицы, ВСЕ закрыты для anon/authenticated;
--        шесть SECURITY DEFINER RPC, все закрыты для anon/authenticated —
--        их зовёт только Pages Function service-ключом.
--
-- ОТКАТ (в обратном порядке):
--   drop function public.classifier_share_get(text);
--   drop function public.classifier_share_put(jsonb, text, text);
--   drop table public.classifier_share;
--   drop function public.api_rate_limit_hit(text, integer, integer);
--   drop table public.api_rate_limit;
--   drop function public.classifier_lookup(text, integer);
--   drop function public.get_classifier_profile(text[]);
--   drop function public.get_classifier_reference();
--   drop table public.data_release;
--   delete from public.clp_generic_limits
--    where rule_key in ('3.1.3.6.1', '3.1.3.6.1b-NONHAZARD');
--
-- ⚠ ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ — под ролью anon все шесть RPC и три таблицы
--   обязаны отдать 42501, а `substances` и `get_acute_tox_profile` работать
--   как раньше (сделано в s80: все восемь строк сошлись).
--
-- Три миграции, применённые ИМЕННО в этом порядке:
--   1. s80_classifier_rules_and_data_release
--   2. s80_classifier_rpc_and_rate_limit
--   3. s80_classifier_share_links


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. s80_classifier_rules_and_data_release
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ Найдено при сборке каркаса: `RULE_KEYS.formula = '3.1.3.6.1'` печатался в
--   результате движка, но строки с таким `rule_key` в `clp_generic_limits`
--   НЕ БЫЛО — контракт «у каждой строки результата есть дословный raw»
--   пробивался молча. Тексты — дословно из консолидации 02008R1272-20260501.
--   Формула в источнике напечатана КАРТИНКОЙ (jpg base64), как и у 3.1.3.6.2.3
--   (№91): транскрипция в `formula_raw`, оговорка в `note`.

insert into public.clp_generic_limits
  (rule_key, kind, class_code, catalog_codes, ghs_chapter, ingredient_category,
   formula_raw, raw, source_ref, source_section, marker, note, needs_review, source)
values
  ('3.1.3.6.1', 'SPECIAL', 'ACUTE_TOX',
   array['ACUTE_TOX_ORAL','ACUTE_TOX_DERMAL','ACUTE_TOX_INHAL'], '3.1',
   'all relevant ingredients with a known ATE',
   '100 / ATE_mix = Σ (C_i / ATE_i)',
   'The ATE of the mixture is determined by calculation from the ATE values for all relevant ingredients according to the following formula for Oral, Dermal or Inhalation Toxicity: [the equation is printed as an image in the Official Journal] where: Ci = concentration of ingredient i ( % w/w or % v/v); i = the individual ingredient from 1 to n; n = the number of ingredients; ATEi = Acute Toxicity Estimate of ingredient i.',
   '3.1.3.6.1', 'Annex I 3.1.3.6.1', 'B',
   'The equation itself is an image in the consolidated text; the transcription in formula_raw is the same equation as 3.1.3.6.2.3 with the numerator 100 (that row carries the corrected numerator verbatim).',
   false, 'CLP 02008R1272 consolidated 2026-05-01, Annex I'),
  ('3.1.3.6.1b-NONHAZARD', 'SPECIAL', 'ACUTE_TOX',
   array['ACUTE_TOX_ORAL','ACUTE_TOX_DERMAL','ACUTE_TOX_INHAL'], '3.1',
   'ingredients presumed not acutely toxic',
   null,
   '(b) ignore ingredients that are presumed not acutely toxic (e.g., water, sugar);',
   '3.1.3.6.1(b)', 'Annex I 3.1.3.6.1', 'B',
   'Legal basis of the component state "nonhazard" in the engine: such an ingredient is kept out of the additivity formula AND out of the sum of unknowns. Point (a) of the same paragraph is under marker M12, point (c) under M2; (b) is base text.',
   false, 'CLP 02008R1272 consolidated 2026-05-01, Annex I');

create table if not exists public.data_release (
  release_key           text primary key,
  annex6_consolidation  text not null,
  atp                   text not null,
  engine_version        text not null,
  parser_version        text,
  gcl_md5               text,
  limits_md5            text,
  classification_md5    text,
  annex6_rows           integer,
  classification_pairs  integer,
  registry_categories   integer,
  is_current            boolean not null default false,
  released_at           timestamptz not null default now(),
  note                  text
);

-- Ровно один «текущий» релиз: частичный уникальный индекс, а не триггер.
create unique index if not exists data_release_one_current
  on public.data_release ((is_current)) where (is_current);

alter table public.data_release enable row level security;
revoke all on table public.data_release from anon, authenticated;

insert into public.data_release
  (release_key, annex6_consolidation, atp, engine_version, parser_version,
   gcl_md5, limits_md5, classification_md5,
   annex6_rows, classification_pairs, registry_categories, is_current, note)
select
  'r-2026-05-01',
  '02008R1272-20260501',
  'ATP 21 (2024/2564) + Official Journal errata documented in sessions 76-79',
  'classifier 1.0 (ate 1.2)',
  (select parser_version from public.annex6_classification limit 1),
  (select md5(string_agg(g::text, '|' order by g.rule_key)) from public.clp_generic_limits g),
  (select md5(string_agg(l::text, '|' order by l.index_number, l.seq)) from public.annex6_limits l),
  (select md5(string_agg(c::text, '|' order by c.index_number, c.seq)) from public.annex6_classification c),
  (select count(*)::int from public.annex6_table3),
  (select count(*)::int from public.annex6_classification),
  (select count(*)::int from public.hazard_category_mapping),
  true,
  'First release of the mixture classifier scaffold (session 80). Engine modules live: A1 acute toxicity.'
where not exists (select 1 from public.data_release where release_key = 'r-2026-05-01');


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. s80_classifier_rpc_and_rate_limit
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 2.1 справочник: 117 правил + 121 строка реестра + текущий релиз ─────────
create or replace function public.get_classifier_reference()
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object(
    'release', (
      select jsonb_build_object(
        'releaseKey', d.release_key, 'annex6Consolidation', d.annex6_consolidation,
        'atp', d.atp, 'engineVersion', d.engine_version, 'parserVersion', d.parser_version,
        'gclMd5', d.gcl_md5, 'limitsMd5', d.limits_md5, 'classificationMd5', d.classification_md5,
        'releasedAt', d.released_at, 'note', d.note)
      from data_release d where d.is_current limit 1),
    'generic', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ruleKey', g.rule_key, 'kind', g.kind, 'classCode', g.class_code,
        'catalogCodes', g.catalog_codes, 'ghsChapter', g.ghs_chapter,
        'ingredientCategory', g.ingredient_category, 'resultCategory', g.result_category,
        'physicalState', g.physical_state, 'operator', g.operator,
        'limitLow', g.limit_low, 'limitHigh', g.limit_high, 'unit', g.unit,
        'weightFactor', g.weight_factor, 'value', g.value, 'valueUnit', g.value_unit,
        'formulaRaw', g.formula_raw, 'raw', g.raw, 'sourceRef', g.source_ref,
        'sourceSection', g.source_section, 'marker', g.marker, 'note', g.note,
        'needsReview', g.needs_review) order by g.rule_key), '[]'::jsonb)
      from clp_generic_limits g),
    'registry', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'classCode', c.class_code, 'className', c.name_en, 'groupType', c.group_type,
        'euOnly', coalesce(c.eu_only, false), 'displayOrder', c.display_order,
        'ghsChapter', c.ghs_chapter, 'categoryCode', m.category_code,
        'hCode', m.h_statement_code, 'pictogramCode', m.pictogram_code,
        'signalWord', m.signal_word) order by c.display_order, m.category_code), '[]'::jsonb)
      from hazard_class_catalog c
      join hazard_category_mapping m on m.hazard_class_id = c.id));
$$;

-- ── 2.2 профиль компонентов запроса (≤ 50 index_number за вызов) ────────────
-- Обобщение `get_acute_tox_profile` (s79) на все классы: пары A0, пределы
-- Annex VI (SCL / M / ATE / «*»), личность вещества и ноты строки.
create or replace function public.get_classifier_profile(p_index text[])
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(jsonb_object_agg(i.ix, jsonb_build_object(
    'substance', (
      select jsonb_build_object(
        'name', coalesce(s.display_name_short, s.common_name, s.iupac_name),
        'iupacName', s.iupac_name, 'casPrimary', s.cas_primary, 'ecPrimary', s.ec_primary,
        'hCodes', s.h_statement_codes, 'euhCodes', s.euh_codes,
        'lc50Fish', s.lc50_fish, 'ec50Daphnia', s.ec50_daphnia, 'ec50Algae', s.ec50_algae,
        'readilyBiodegradable', s.readily_biodegradable)
      from substances s where s.index_number = i.ix limit 1),
    'pairs', (
      select jsonb_agg(jsonb_build_object(
        'classCode', c.class_code, 'categoryCode', c.category_code,
        'categoryRaw', c.category_raw, 'hCode', c.h_code, 'hCodeFull', c.h_code_full,
        'organs', c.organs, 'hMarker', c.h_marker, 'star', c.star,
        'testRequired', c.test_required, 'raw', c.raw, 'flags', c.flags) order by c.seq)
      from annex6_classification c where c.index_number = i.ix),
    'scl', (
      select jsonb_agg(jsonb_build_object(
        'raw', l.raw, 'classCat', l.class_cat, 'hCode', l.h_code,
        'conditionText', l.condition_text, 'limitLow', l.limit_low, 'limitHigh', l.limit_high,
        'needsReview', l.needs_review) order by l.seq)
      from annex6_limits l where l.index_number = i.ix and l.kind = 'SCL'),
    'mFactors', (
      select jsonb_agg(jsonb_build_object(
        'raw', l.raw, 'value', l.m_value, 'scope', l.m_scope,
        'needsReview', l.needs_review) order by l.seq)
      from annex6_limits l where l.index_number = i.ix and l.kind = 'M' and l.m_value is not null),
    'ate', (
      select jsonb_agg(jsonb_build_object(
        'route', l.ate_route, 'value', l.ate_value, 'unit', l.ate_unit,
        'form', l.ate_form, 'raw', l.raw) order by l.seq)
      from annex6_limits l where l.index_number = i.ix and l.kind = 'ATE' and l.ate_value > 0),
    'star', (
      select jsonb_agg(jsonb_build_object('raw', l.raw) order by l.seq)
      from annex6_limits l where l.index_number = i.ix and l.kind = 'STAR'),
    'notes', (select a.notes_raw from annex6_table3 a where a.index_number = i.ix limit 1),
    'rowFlags', (select r.row_flags from annex6_classification_row r where r.index_number = i.ix limit 1)
  )), '{}'::jsonb)
  from (
    select distinct btrim(x) as ix
    from unnest(p_index[1:50]) as x
    where x is not null and btrim(x) <> ''
  ) as i;
$$;

-- ── 2.3 поиск компонента: CAS / EC / index / имя, ≤ 25 кандидатов ───────────
-- ⚠ Коллизия CAS (кадмий, №82): `.single()` запрещён — возвращаем ВСЕ формы и
--   считаем, сколько записей делят один CAS, чтобы интерфейс дал выбрать.
create or replace function public.classifier_lookup(p_q text, p_limit integer default 10)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  with n as (
    select nullif(btrim(p_q), '') as q,
           upper(regexp_replace(coalesce(p_q, ''), '\s', '', 'g')) as compact
  ),
  hits as (
    select s.index_number,
           coalesce(s.display_name_short, s.common_name, s.iupac_name) as name,
           s.cas_primary, s.ec_primary, s.h_statement_codes,
           case
             when upper(s.index_number) = n.compact then 0
             when replace(coalesce(s.cas_primary, ''), ' ', '') = n.compact then 1
             when replace(coalesce(s.ec_primary, ''), ' ', '') = n.compact then 2
             else 3
           end as rank
    from substances s cross join n
    where n.q is not null
      and s.index_number is not null
      and (upper(s.index_number) = n.compact
        or replace(coalesce(s.cas_primary, ''), ' ', '') = n.compact
        or replace(coalesce(s.ec_primary, ''), ' ', '') = n.compact
        or coalesce(s.display_name_short, s.common_name, s.iupac_name) ilike '%' || n.q || '%')
    order by rank, name
    limit least(coalesce(p_limit, 10), 25)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'indexNumber', h.index_number, 'name', h.name,
    'casPrimary', h.cas_primary, 'ecPrimary', h.ec_primary, 'hCodes', h.h_statement_codes,
    'formsSharingCas', (
      select count(*) from substances s2
      where h.cas_primary is not null and s2.cas_primary = h.cas_primary),
    'pairs', (select count(*) from annex6_classification c where c.index_number = h.index_number)
  ) order by h.rank, h.name), '[]'::jsonb)
  from hits h;
$$;

-- ── 2.4 лимит анонима: 30 расчётов в час на IP (design-doc §3.1) ────────────
-- ⚠ Счётчик в базе, а не в Cache API: у Cloudflare кэш локален для колоцентра,
--   и лимит «30 в час» превратился бы в «30 на каждый город».
create table if not exists public.api_rate_limit (
  bucket_key   text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0,
  updated_at   timestamptz not null default now()
);
alter table public.api_rate_limit enable row level security;
revoke all on table public.api_rate_limit from anon, authenticated;

create or replace function public.api_rate_limit_hit(
  p_key text, p_limit integer, p_window_seconds integer)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_hits  integer;
  v_start timestamptz;
begin
  insert into api_rate_limit as a (bucket_key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (bucket_key) do update set
    hits = case when a.window_start < now() - make_interval(secs => p_window_seconds)
                then 1 else a.hits + 1 end,
    window_start = case when a.window_start < now() - make_interval(secs => p_window_seconds)
                        then now() else a.window_start end,
    updated_at = now()
  returning a.hits, a.window_start into v_hits, v_start;

  -- Уборка примерно раз в сто вызовов: таблица не должна расти вечно.
  if random() < 0.01 then
    delete from api_rate_limit where updated_at < now() - interval '1 day';
  end if;

  return jsonb_build_object(
    'allowed', v_hits <= p_limit,
    'hits', v_hits,
    'limit', p_limit,
    'remaining', greatest(0, p_limit - v_hits),
    'resetAt', v_start + make_interval(secs => p_window_seconds));
end;
$$;

-- ── 2.5 закрыть всё от anon/authenticated (правило №99) ─────────────────────
revoke all on function public.get_classifier_reference() from public, anon, authenticated;
revoke all on function public.get_classifier_profile(text[]) from public, anon, authenticated;
revoke all on function public.classifier_lookup(text, integer) from public, anon, authenticated;
revoke all on function public.api_rate_limit_hit(text, integer, integer) from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. s80_classifier_share_links
-- ═══════════════════════════════════════════════════════════════════════════
-- Решение Сергея s80: «пусть короткая ссылка будет».
-- ⭐⭐⭐ Хранится ВХОД и ключ релиза, а не результат: при открытии ссылки расчёт
-- повторяется по ТЕКУЩЕМУ релизу, а `result_hash` того, что видел автор, лежит
-- рядом. Значит открывший узнаёт не «релиз другой», а «результат тот же» либо
-- «результат изменился». Для аудита это и есть ответ на вопрос «что человек
-- видел в тот день».

create table if not exists public.classifier_share (
  share_token  text primary key,
  payload      jsonb not null,
  release_key  text not null,
  result_hash  text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  hits         integer not null default 0
);
alter table public.classifier_share enable row level security;
revoke all on table public.classifier_share from anon, authenticated;

-- Токен: 10 символов из url-safe base64 случайных байт. Повтор крайне
-- маловероятен, но цикл всё равно есть: молча перезаписать чужой расчёт нельзя.
create or replace function public.classifier_share_put(
  p_payload jsonb, p_release_key text, p_result_hash text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_token text;
  i integer := 0;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a json object';
  end if;
  if pg_column_size(p_payload) > 65536 then
    raise exception 'payload too large';
  end if;

  loop
    i := i + 1;
    v_token := substr(translate(encode(gen_random_bytes(12), 'base64'), '+/=', '-_'), 1, 10);
    begin
      insert into classifier_share (share_token, payload, release_key, result_hash)
      values (v_token, p_payload, p_release_key, p_result_hash);
      return jsonb_build_object('shareToken', v_token, 'releaseKey', p_release_key);
    exception when unique_violation then
      if i > 8 then raise; end if;
    end;
  end loop;
end;
$$;

create or replace function public.classifier_share_get(p_token text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  update classifier_share
     set hits = hits + 1, last_seen_at = now()
   where share_token = p_token
  returning jsonb_build_object(
    'shareToken', share_token, 'payload', payload, 'releaseKey', release_key,
    'resultHash', result_hash, 'createdAt', created_at, 'hits', hits) into v;
  return coalesce(v, 'null'::jsonb);
end;
$$;

revoke all on function public.classifier_share_put(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.classifier_share_get(text) from public, anon, authenticated;
