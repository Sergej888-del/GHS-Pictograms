-- ============================================================================
-- 74-cas-ec-primary-normalize.sql · session 74, 2026-08-21
-- №79 путь ③: нормализованные идентификаторы cas_primary / ec_primary
--
-- ⚠ УЖЕ ПРИМЕНЕНО В ПРОД через MCP как миграцию
--   `substances_cas_ec_primary_normalize_v1` (2026-08-21).
--   Файл лежит здесь для истории и воспроизводимости — повторный запуск
--   безопасен (add column if not exists; update идемпотентен).
--
-- Правило формы зеркалит src/lib/substanceIdentifiers.ts (CAS_SHAPE, EC_SHAPE).
-- Контрольная цифра EC не проверяется — решение session 44 (ELINCS 4xx).
-- Исходные cas_number / ec_number НЕ меняются.
-- Откат: alter table public.substances drop column cas_primary, drop column ec_primary;
-- ============================================================================

alter table public.substances
  add column if not exists cas_primary varchar(12),
  add column if not exists ec_primary varchar(11);

comment on column public.substances.cas_primary is
  'Первая форма CAS из cas_number (Annex VI), строго по CAS_SHAPE. cas_number испорчен импортом (обрезка 20 знаков, склейка форм) — поиск .eq() вести по этой колонке. Session 74, №79 путь ③.';
comment on column public.substances.ec_primary is
  'Первая форма EC из ec_number, строго по EC_SHAPE (без контрольной цифры — ELINCS 4xx, session 44). Session 74, №79 путь ③.';

update public.substances set
  cas_primary = case
    when btrim(coalesce(cas_number,'')) ~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$'
      then btrim(cas_number)
    when btrim(split_part(coalesce(cas_number,''),'[',1)) ~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$'
      then btrim(split_part(cas_number,'[',1))
  end,
  ec_primary = case
    when btrim(coalesce(ec_number,'')) ~ '^[0-9]{3}-[0-9]{3}-[0-9]$'
      then btrim(ec_number)
    when btrim(split_part(coalesce(ec_number,''),'[',1)) ~ '^[0-9]{3}-[0-9]{3}-[0-9]$'
      then btrim(split_part(ec_number,'[',1))
  end;

-- Две склейки БЕЗ маркеров [n] — разложены вручную, контрольные цифры CAS
-- проверены (session 74): nonylphenol ethoxylates и pyrithione sodium.
update public.substances set cas_primary = '127087-87-0'
  where index_number = '604-100-00-0' and cas_primary is null;
update public.substances set cas_primary = '3811-73-2'
  where index_number = '613-344-00-7' and cas_primary is null;

create index if not exists idx_substances_cas_primary on public.substances (cas_primary);
create index if not exists idx_substances_ec_primary on public.substances (ec_primary);

-- ============================================================================
-- ВЕРИФИКАЦИЯ (прогнано 2026-08-21, все значения сошлись):
--   cas_filled = 3 807 (3 650 чистых + 155 из склеек + 2 ручные)
--   ec_filled  = 3 865 (3 716 чистых + 149 из склеек)
--   нарушений формы 0 · расхождений с чистыми cas_number 0
--   '71-41-0'   → 603-200-00-1 (пентанол, кейс №79)
--   '7440-43-9' → 2 строки (048-002-00-0 и 048-011-00-X — коллизия кадмия,
--                 приёмники обязаны НЕ использовать .single())
-- ============================================================================
-- select
--   count(*) filter (where cas_primary is not null) as cas_filled,
--   count(*) filter (where ec_primary is not null) as ec_filled,
--   count(*) filter (where cas_primary is not null and cas_primary !~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$') as cas_bad_shape,
--   count(*) filter (where ec_primary is not null and ec_primary !~ '^[0-9]{3}-[0-9]{3}-[0-9]$') as ec_bad_shape,
--   count(*) filter (where btrim(cas_number) ~ '^[0-9]{2,7}-[0-9]{2}-[0-9]$' and cas_primary is distinct from btrim(cas_number)) as clean_mismatch
-- from substances;
