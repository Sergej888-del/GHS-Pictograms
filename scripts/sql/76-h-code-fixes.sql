-- scripts/sql/76-h-code-fixes.sql
-- Session 76 (2026-08-21). Применено через MCP execute_sql, здесь — архив.
--
-- №87: из «346 расхождений H-кодов» между annex6_table3 и substances после
-- нормализации (убрать скобки с органами, звёздочки, порядок) осталось 8:
-- 6 — ошибки самого регламента (класс ≠ H-код, см. src/lib/annex6RowErrata.ts),
-- 2 — наши дефекты, исправленные ниже.

-- 613-259-00-5 имипротрин: импорт потерял H410 (в источнике Aquatic Chronic 1,
-- H410, M = 10; строка под ▼M23 = 2020/1182). Пиктограммы и P-фразы уже были.
update substances
   set h_statement_codes = array['H351','H332','H302','H371','H400','H410'],
       updated_at = now()
 where index_number = '613-259-00-5'
   and h_statement_codes = array['H351','H332','H302','H371','H400'];

-- 649-378-00-4 бензин: H224 + GHS02 + P210/P233/P241/P242/P403 добавлены в
-- session 8 как «коррекция» без первоисточника. Консолидация (23 редакции) и
-- акт 2018/669: Carc. 1B, Muta. 1B, Asp. Tox. 1 → H350 H340 H304, GHS08, Dgr.
-- Воспламеняемость бензина — самоклассификация поставщика (CLP Art. 4);
-- плашка об этом на /sds/gasoline/ уже была в коде (uvcbLacksFlam).
-- P-фразы — как у соседних записей той же классификации (649-261…264).
update substances
   set h_statement_codes = array['H350','H340','H304'],
       ghs_pictogram_codes = array['GHS08'],
       signal_word = 'Danger',
       p_statement_codes = array['P201','P280','P308','P313'],
       updated_at = now()
 where index_number = '649-378-00-4'
   and 'H224' = any(h_statement_codes);

-- Проверка (ожидание: 0 строк, кроме шести из annex6RowErrata.ts):
-- with src as (
--   select a.index_number,
--          (select array_agg(distinct m[1] order by m[1])
--             from unnest(a.hazard_h_raw) h, regexp_matches(h, '(H\d{3}[A-Za-z]*)', 'g') m) as src_h
--   from annex6_table3 a
-- ), ours as (
--   select index_number, (select array_agg(distinct x order by x) from unnest(h_statement_codes) x) as our_h
--   from substances
-- )
-- select index_number from src join ours using (index_number) where src_h is distinct from our_h;
