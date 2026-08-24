-- scripts/sql/84-report-stamp-and-counts.sql
-- Архив миграции session 84 (применяется в SQL Editor Сергеем).
-- Карточки №110 (штамп версии данных) и №116 (числа релиза в ответе).
--
-- ЗАЧЕМ. С этой сессии инструмент печатает АУДИТОРСКИЙ ОТЧЁТ (№118), и штамп
-- версии данных стоит в нём на самом заметном месте. А штамп врал:
--   · `annex6_classification.parser_version` = 'a0-parser 1.0 (s78)' на всех
--     13 512 парах, тогда как ДАННЫЕ в таблице — это выдача парсера 1.1;
--   · `data_release.engine_version` = 'classifier 1.0 (ate 1.2)', а движок с
--     s82–s83 считает 16 классов из 20 и в коде объявлен как 'classifier 1.1'.
--
-- ⭐ ПОЧЕМУ ПЕРЕШТАМПОВАТЬ ЧЕСТНО, А НЕ ПЕРЕСОБИРАТЬ ТАБЛИЦУ. Проверено в s84
-- двумя замерами: (1) прогон текущего парсера по снимку `annex6-table3.json`
-- даёт 13 512 пар, ровно столько же, сколько лежит в базе; (2) поклассные числа
-- совпадают ВСЕ 31 из 31 (AQUATIC_CHRONIC 2320, ACUTE_TOX_ORAL 1553, …, OZONE 4),
-- а строка 602-091-00-8 несёт три пары без AQUATIC_CHRONIC — то есть семантику
-- 1.1. Миграция s79 (`s79_602_091_00_8_class_missing`) починила данные и
-- перештамповала ОДНУ строку в `annex6_classification_row`, а пары оставила со
-- старой отметкой. Здесь мы приводим отметку к данным, а не данные к отметке.
-- ⛔ Если бы числа не сошлись, правильным был бы `npm run build:annex6-classification`
--    (полная пересборка A0 service-ключом), а не UPDATE.
--
-- ДО:    annex6_classification: 13 512 пар, все 'a0-parser 1.0 (s78)';
--        annex6_classification_row: 4 419 строк, 4 418 из них 'a0-parser 1.0 (s78)';
--        data_release (is_current): parser_version 'a0-parser 1.0 (s78)',
--        engine_version 'classifier 1.0 (ate 1.2)', note про «A1 acute toxicity»;
--        get_classifier_reference() не отдаёт числа релиза.
-- ПОСЛЕ: везде 'a0-parser 1.1 (s79: class-omitted retired)';
--        engine_version 'classifier 1.1' — как в `src/lib/classifier/version.ts`;
--        note описывает ДАННЫЕ (они не устаревают от нового модуля движка);
--        get_classifier_reference() отдаёт annex6Rows / classificationPairs /
--        registryCategories — их печатает отчёт (№116). Числа НЕ меняются:
--        4 419 · 13 512 · 121 уже стоят в строке релиза и сверены post-check-ом.
--
-- ⚠ ПОРЯДОК: миграция ПЕРЕД деплоем кода. Старый код этих полей не читает, а
--   новый при расхождении штампов напечатает предупреждение в отчёте
--   (ENGINE_STAMP_DRIFT / PARSER_STAMP_DRIFT) — оно и задумано как сторож.
--
-- ОТКАТ:
--   update public.annex6_classification set parser_version = 'a0-parser 1.0 (s78)';
--   update public.annex6_classification_row set parser_version = 'a0-parser 1.0 (s78)'
--    where index_number <> '602-091-00-8';
--   update public.data_release set parser_version = 'a0-parser 1.0 (s78)',
--          engine_version = 'classifier 1.0 (ate 1.2)',
--          note = 'First release of the mixture classifier scaffold (session 80). Engine modules live: A1 acute toxicity.'
--    where is_current;
--   -- и вернуть прежнее тело get_classifier_reference() из
--   -- scripts/sql/80-classifier-scaffold.sql

begin;

-- ── 1. предварительная проверка ─────────────────────────────────────────────
do $$
declare
  v_pairs int;
  v_rows int;
  v_release int;
  v_table3 int;
  v_cats int;
begin
  select count(*) into v_pairs from public.annex6_classification;
  select count(*) into v_rows from public.annex6_classification_row;
  select count(*) into v_table3 from public.annex6_table3;
  select count(*) into v_cats from public.hazard_category_mapping;
  select count(*) into v_release from public.data_release where is_current;

  if v_pairs <> 13512 then
    raise exception 'ожидалось 13512 пар A0, найдено %', v_pairs;
  end if;
  if v_rows <> 4419 then
    raise exception 'ожидалось 4419 строк A0, найдено %', v_rows;
  end if;
  if v_table3 <> 4419 then
    raise exception 'ожидалось 4419 строк annex6_table3, найдено %', v_table3;
  end if;
  if v_cats <> 121 then
    raise exception 'ожидалась 121 категория реестра, найдено %', v_cats;
  end if;
  if v_release <> 1 then
    raise exception 'ожидалась ровно одна текущая строка релиза, найдено %', v_release;
  end if;
end $$;

-- ── 2. штамп парсера на данные, которые он и произвёл (№110) ────────────────
update public.annex6_classification
   set parser_version = 'a0-parser 1.1 (s79: class-omitted retired)'
 where parser_version is distinct from 'a0-parser 1.1 (s79: class-omitted retired)';

update public.annex6_classification_row
   set parser_version = 'a0-parser 1.1 (s79: class-omitted retired)'
 where parser_version is distinct from 'a0-parser 1.1 (s79: class-omitted retired)';

-- ── 3. строка релиза: версии и честная заметка ──────────────────────────────
update public.data_release
   set parser_version = 'a0-parser 1.1 (s79: class-omitted retired)',
       engine_version = 'classifier 1.1',
       note = 'Annex VI Table 3: 4419 rows parsed into 13512 harmonised class/category pairs. Annex I: 117 generic limit rows. Registry: 37 hazard classes, 121 categories. The note describes the DATA; which engine modules are live is a property of the code, and the report prints the engine version beside this release.'
 where is_current;

-- ── 4. числа релиза уезжают в ответ (№116) ──────────────────────────────────
-- ⚠ Тело функции — прежнее из 80-classifier-scaffold.sql плюс три поля в
--    объекте `release`. Ничего другого здесь не меняется.
create or replace function public.get_classifier_reference()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'release', (
      select jsonb_build_object(
        'releaseKey', d.release_key, 'annex6Consolidation', d.annex6_consolidation,
        'atp', d.atp, 'engineVersion', d.engine_version, 'parserVersion', d.parser_version,
        'gclMd5', d.gcl_md5, 'limitsMd5', d.limits_md5, 'classificationMd5', d.classification_md5,
        'releasedAt', d.released_at, 'note', d.note,
        'annex6Rows', d.annex6_rows, 'classificationPairs', d.classification_pairs,
        'registryCategories', d.registry_categories)
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
$function$;

-- ── 5. проверка после ───────────────────────────────────────────────────────
do $$
declare
  v_old_pairs int;
  v_old_rows int;
  v_pairs int;
  v_rows int;
  r record;
  j jsonb;
begin
  select count(*) into v_old_pairs from public.annex6_classification
   where parser_version is distinct from 'a0-parser 1.1 (s79: class-omitted retired)';
  select count(*) into v_old_rows from public.annex6_classification_row
   where parser_version is distinct from 'a0-parser 1.1 (s79: class-omitted retired)';
  if v_old_pairs <> 0 or v_old_rows <> 0 then
    raise exception 'остались строки со старым штампом: пар %, строк %', v_old_pairs, v_old_rows;
  end if;

  -- ⛔ Ни одна строка не должна была ПРОПАСТЬ: это UPDATE, а не пересборка.
  select count(*) into v_pairs from public.annex6_classification;
  select count(*) into v_rows from public.annex6_classification_row;
  if v_pairs <> 13512 or v_rows <> 4419 then
    raise exception 'счётчики поехали: пар % (ждали 13512), строк % (ждали 4419)', v_pairs, v_rows;
  end if;

  select * into r from public.data_release where is_current;
  if r.parser_version <> 'a0-parser 1.1 (s79: class-omitted retired)'
     or r.engine_version <> 'classifier 1.1' then
    raise exception 'строка релиза не обновилась: % / %', r.parser_version, r.engine_version;
  end if;

  -- ⚠ Числа релиза обязаны совпадать с реальностью, иначе отчёт напечатает
  --    объём данных, которого нет. Не меняем их молча — падаем.
  if r.annex6_rows <> (select count(*) from public.annex6_table3)
     or r.classification_pairs <> (select count(*) from public.annex6_classification)
     or r.registry_categories <> (select count(*) from public.hazard_category_mapping) then
    raise exception 'числа релиза разошлись с таблицами: % / % / %',
      r.annex6_rows, r.classification_pairs, r.registry_categories;
  end if;

  -- RPC обязан отдать их наружу — иначе отчёт печатать нечем.
  select public.get_classifier_reference() -> 'release' into j;
  if (j ->> 'classificationPairs') is null or (j ->> 'annex6Rows') is null
     or (j ->> 'registryCategories') is null then
    raise exception 'get_classifier_reference() не отдаёт числа релиза: %', j;
  end if;
  if (j ->> 'parserVersion') <> 'a0-parser 1.1 (s79: class-omitted retired)' then
    raise exception 'RPC отдаёт старую версию парсера: %', j ->> 'parserVersion';
  end if;
end $$;

commit;

-- ── ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ (выполнить отдельно, ожидаемые числа справа) ──
-- select parser_version, count(*) from public.annex6_classification group by 1;
--   → 'a0-parser 1.1 (s79: class-omitted retired)' | 13512
-- select release_key, engine_version, parser_version, annex6_rows,
--        classification_pairs, registry_categories
--   from public.data_release where is_current;
--   → r-2026-05-01 | classifier 1.1 | a0-parser 1.1 (…) | 4419 | 13512 | 121
-- select public.get_classifier_reference() -> 'release';
--   → объект с annex6Rows/classificationPairs/registryCategories
