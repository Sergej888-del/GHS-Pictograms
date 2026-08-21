-- ============================================================================
-- Session 78 · №102 · «Skin Corr. 1» (Category 1 без подкатегории) в реестр
-- Применено через Supabase MCP как миграция s78_skin_corr_category_1_registry (2026-08-21)
-- ============================================================================
--
-- ДО: hazard_category_mapping у SKIN_CORR_IRRIT знал только 1A/1B/1C/2/3 (120 строк всего);
--     clp_category_criteria SKIN_CORR_IRRIT/1 — label_status 'parent_category', mapping null;
--     9 пар annex6_classification («Skin Corr. 1» в Annex VI) несли флаг REGISTRY_GAP;
--     /hazard-classes/ не показывал Категорию 1, страницы веществ с H314 печатали
--     «Category 1A or 1B or 1C».
-- ПОСЛЕ: строка реестра SKIN_CORR_IRRIT/1 — GHS05 · Danger · H314 · in_clp (121 строка);
--     критерий '1' → label_status 'ok', mapping_category_code '1' (view clp_matrix_full
--     отдаёт элементы этикетки 7 строкам матрицы с категорией «1»);
--     REGISTRY_GAP снят у 9 пар; мост matrixCategoryBridge.ts питает «1» из 1A/1B/1C и «1»
--     (23 P-фразы, как у подкатегорий).
-- Основание: Annex I 3.2.2.1 (Category 1 — родительская), Table 3.2.5 (элементы этикетки
--     общие для 1/1A/1B/1C), 3.2.3.3.4 (смесь → «Category 1» при неизвестных подкатегориях);
--     Annex IV печатает «1, 1A, 1B, 1C» только у P301 и P501.

do $$
declare v_class uuid; v_before int; v_after int;
begin
  select id into v_class from public.hazard_class_catalog where class_code = 'SKIN_CORR_IRRIT';
  if v_class is null then raise exception 'SKIN_CORR_IRRIT not in catalog'; end if;
  select count(*) into v_before from public.hazard_category_mapping where hazard_class_id = v_class;
  if v_before <> 5 then raise exception 'expected 5 SKIN_CORR_IRRIT rows before, got %', v_before; end if;
  if exists (select 1 from public.hazard_category_mapping where hazard_class_id = v_class and category_code = '1') then
    raise exception 'category 1 already present';
  end if;

  insert into public.hazard_category_mapping
    (hazard_class_id, category_code, pictogram_code, signal_word, h_statement_code, ghs_revision, notes, endpoint_key, clp_status)
  values
    (v_class, '1', 'GHS05', 'Danger', 'H314', 10,
     'Category 1 without sub-categorisation (Annex I 3.2.2.1; Table 3.2.5 label elements shared with 1A/1B/1C). Mixtures: Annex I 3.2.3.3.4. Annex VI prints "Skin Corr. 1" on 9 entries. Added s78 (№102).',
     'skin_corrosion', 'in_clp');

  update public.clp_category_criteria
     set mapping_category_code = '1',
         label_status = 'ok',
         label_status_note = 'Annex I задаёт критерий для категории 1 целиком; элементы этикетки (GHS05, Danger, H314) общие с подкатегориями 1A/1B/1C (Table 3.2.5). Строка реестра добавлена s78 (№102).'
   where class_code = 'SKIN_CORR_IRRIT' and category_code = '1' and label_status = 'parent_category';
  if not found then raise exception 'criteria row SKIN_CORR_IRRIT/1 (parent_category) not found'; end if;

  select count(*) into v_after from public.hazard_category_mapping where hazard_class_id = v_class;
  if v_after <> 6 then raise exception 'expected 6 rows after, got %', v_after; end if;
end $$;

-- флаг дыры реестра у 9 пар A0 (то же сделает build:annex6-classification при следующем прогоне)
update public.annex6_classification set flags = array_remove(flags, 'REGISTRY_GAP'), updated_at = now()
 where 'REGISTRY_GAP' = any(flags);   -- 9 строк: 050-034-00-5, 603-023-00-X, 604-020-00-6, 607-103-00-5,
                                      -- 612-294-00-3, 613-112-00-5, 613-335-00-8, 613-339-00-X, 615-013-00-2

-- ── Контроль ─────────────────────────────────────────────────────────────────
-- select count(*) from hazard_category_mapping;                                   -- 121
-- select category_code from hazard_category_mapping m join hazard_class_catalog c on c.id=m.hazard_class_id
--  where c.class_code='SKIN_CORR_IRRIT' order by 1;                                -- 1, 1A, 1B, 1C, 2, 3
-- select count(*) from annex6_classification where 'REGISTRY_GAP' = any(flags);   -- 0

-- ── Откат ────────────────────────────────────────────────────────────────────
-- delete from hazard_category_mapping m using hazard_class_catalog c
--  where c.id = m.hazard_class_id and c.class_code='SKIN_CORR_IRRIT' and m.category_code='1';
-- update clp_category_criteria set mapping_category_code = null, label_status = 'parent_category',
--   label_status_note = 'Annex I задаёт критерий для категории 1 целиком, а элементы этикетки и P-фразы прописаны для подкатегорий 1A, 1B и 1C.'
--  where class_code='SKIN_CORR_IRRIT' and category_code='1';
-- update annex6_classification set flags = array_append(flags,'REGISTRY_GAP')
--  where class_code='SKIN_CORR_IRRIT' and category_code='1';
-- + вернуть matrixCategoryBridge.ts к «'1' → ['1A','1B','1C']».
