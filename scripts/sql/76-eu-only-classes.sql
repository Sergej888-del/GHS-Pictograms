-- scripts/sql/76-eu-only-classes.sql
-- Session 76, №90. Четыре класса опасности, которых нет в UN GHS, а есть только
-- в CLP (Reg. (EU) 2023/707, ▼M32 консолидации): Annex I 3.11 ED HH, 4.2 ED ENV,
-- 4.3 PBT/vPvB, 4.4 PMT/vPvM. Применено через MCP; здесь — архив.
-- Источник текстов: clp-consolidated.html (CELEX 02008R1272-20260501):
-- Tables 3.11.1/3.11.3, 4.2.1/4.2.3, 4.3.1, 4.4.1, разделы 4.3.2, 4.4.2;
-- Annex III (переводы уже лежали в statement_translations с 2026-08-07).

-- 1. Миграция hazard_class_catalog_eu_only_v1
alter table public.hazard_class_catalog add column if not exists eu_only boolean not null default false;
comment on column public.hazard_class_catalog.eu_only is
  'true — класс существует только в EU CLP (Reg. 2023/707: ED HH, ED ENV, PBT/vPvB, PMT/vPvM), в UN GHS его нет';

-- 2. Озон: Annex I Part 5 «Additional EU hazard class», section 5.1 (4.2 с 2023/707 занят ED ENV)
update hazard_class_catalog set ghs_chapter = '5.1', display_order = 55 where class_code = 'OZONE' and ghs_chapter = '4.2';

-- 3. Каталог
insert into hazard_class_catalog (class_code, group_type, name_en, endpoint_key, ghs_chapter, display_order, eu_only) values
 ('ED_HH',    'HEALTH',        'Endocrine disruption for human health',  'ed_human_health', '3.11', 43, true),
 ('ED_ENV',   'ENVIRONMENTAL', 'Endocrine disruption for the environment', 'ed_environment', '4.2', 52, true),
 ('PBT_VPVB', 'ENVIRONMENTAL', 'Persistent, bioaccumulative and toxic or very persistent, very bioaccumulative properties', 'pbt_vpvb', '4.3', 53, true),
 ('PMT_VPVM', 'ENVIRONMENTAL', 'Persistent, mobile and toxic or very persistent, very mobile properties', 'pmt_vpvm', '4.4', 54, true);

-- 4. Фразы EUH380–EUH451 (text_ru — наш перевод для интерфейса, не текст регламента)
--    (см. выполненный INSERT в h_statements: code, category='eu_specific', text_en = Annex III,
--     text_de/text_lv = Annex III, ghs_revision null, status 'current',
--     source_ref 'CLP Annex III; Reg. 2023/707; Table 3.11.3' и т.д.)

-- 5. Юрисдикции: EU_CLP current; UN_GHS_11, US_HAZCOM_2012, US_OSHA absent
insert into h_statement_jurisdiction (code, jurisdiction, status)
select c, j, case when j = 'EU_CLP' then 'current' else 'absent' end
from unnest(array['EUH380','EUH381','EUH430','EUH431','EUH440','EUH441','EUH450','EUH451']) c,
     unnest(array['EU_CLP','UN_GHS_11','US_HAZCOM_2012','US_OSHA']) j;

-- 6. Прецеденция (Annex III Part 1, принципы (c) и (d))
insert into h_statement_precedence (if_h_code, then_omit_h_code, explanation_en, legal_reference, is_active) values
 ('EUH441','EUH440','EUH441 (strongly accumulates) assigned: EUH440 may be omitted.','CLP Annex III Part 1, principle (c) — Reg. (EU) 2023/707',true),
 ('EUH451','EUH450','EUH451 (very long-lasting contamination of water resources) assigned: EUH450 may be omitted.','CLP Annex III Part 1, principle (d) — Reg. (EU) 2023/707',true);

-- 7. Элементы этикетки (Tables 3.11.3, 4.2.3, 4.3.1, 4.4.1): без пиктограмм
insert into hazard_category_mapping (hazard_class_id, category_code, pictogram_code, signal_word, h_statement_code, ghs_revision, notes, endpoint_key, clp_status)
select c.id, v.cat, null, v.sw, v.h, 10, 'EU-only hazard class (Reg. (EU) 2023/707, Annex I ' || v.tbl || '); not in UN GHS. No pictogram.', c.endpoint_key, 'in_clp'
from (values
 ('ED_HH','1','Danger','EUH380','Table 3.11.3'), ('ED_HH','2','Warning','EUH381','Table 3.11.3'),
 ('ED_ENV','1','Danger','EUH430','Table 4.2.3'), ('ED_ENV','2','Warning','EUH431','Table 4.2.3'),
 ('PBT_VPVB','PBT','Danger','EUH440','Table 4.3.1'), ('PBT_VPVB','vPvB','Danger','EUH441','Table 4.3.1'),
 ('PMT_VPVM','PMT','Danger','EUH450','Table 4.4.1'), ('PMT_VPVM','vPvM','Danger','EUH451','Table 4.4.1')
) v(cls, cat, sw, h, tbl)
join hazard_class_catalog c on c.class_code = v.cls;

-- 8. Связка порогов s75 с каталогом
update clp_generic_limits g set catalog_codes = array[g.class_code]
 where g.class_code in ('ED_HH','ED_ENV','PBT_VPVB','PMT_VPVM') and coalesce(array_length(g.catalog_codes,1),0) = 0;

-- 9. P-фразы из тех же таблиц Annex I (не Annex IV): ED HH — P201 P202 P263 P280 / P308+P313 / P405 / P501;
--    ED ENV — P201 P202 P273 / P391 / P405 / P501; PBT, PMT — P201 P202 P273 / P391 / P501.
--    (см. выполненный INSERT в clp_precautionary_matrix; P201 с condition_id 2, как у REPRO_TOX)

-- 10. Критерии (clp_category_criteria): 8 строк, label_status 'ok', source_ref Table 3.11.1 /
--     Table 4.2.1 / 4.3.2.1 / 4.3.2.2 / 4.4.2.1 / 4.4.2.2 — текст сжат из Annex I.

-- Проверка:
-- select class_code, category_code, signal_word, h_codes, count(*) from clp_matrix_full
--  where class_code in ('ED_HH','ED_ENV','PBT_VPVB','PMT_VPVM') group by 1,2,3,4 order by 1,2;
-- Откат: delete из clp_category_criteria, clp_precautionary_matrix, hazard_category_mapping
-- (по class_code / hazard_class_id), hazard_class_catalog (4 кода), h_statement_precedence,
-- h_statement_jurisdiction, h_statements (8 кодов); OZONE обратно 4.2/52; drop column eu_only.
