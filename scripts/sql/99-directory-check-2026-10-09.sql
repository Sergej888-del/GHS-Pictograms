-- Session 99 (2026-10-09), check:directory после правок посева по письмам четвёртой волны
-- (claude/directory-outreach-wave4-s99.md) и ответу Chemius. Отчёт: directory-check-2026-10-09.json.
--
-- Найдены сторожем (страница ok, evidence найден) — новые/изменённые факты:
--   #255–#258 ALMEGO и #445–#448 EcoOnline Chemical Manager — Terms of Service 11.2, 15.5, 15.3, 7.2 (обещано в письме);
--   #850 RegSurance §1.2 «These Terms govern Website use only…» (обещано в письме);
--   #1879 CODESOFT «from USD 591» — shop.teklynx.com/products (обещано в письме).
--
-- Подтверждены ВРУЧНУЮ (страницы store.general-data.com отдают сторожу заглушку Cloudflare — verdict blocked;
-- прочитаны WebFetch 09.10, текст совпал дословно; сторож на blocked-страницах подтверждение не снимает):
--   #1325 «DISTRIBUTED PRODUCTS AND ANY OTHER NON-GDC MFG. PRODUCTS ARE NOT WARRANTED BY GDC AND ARE SOLD TO THE
--         CUSTOMER ON AN AS IS BASIS.» — store.general-data.com/terms/;
--   #1326 «…shall be limited to the amount paid to GDC for the products which caused the damages» — там же (обрывок
--         фразы «The liability of GDC, its suppliers, and independent contractors … shall be limited to…»);
--   #1327 «The CUSTOMER agrees with respect to products, to accept the responsibility of (1) their selection to
--         achieve the CUSTOMER’s intended results, (2) their use, and (3) the results obtained therefrom.» — там же;
--   #1880 Epson ColorWorks CW-C6500A $3,965.00 и #1881 CW-C6500P $4,305.00 — категория Color Inkjet Label Printers
--         (Gloss и Matte по одной цене). Источник в посеве и здесь — страница категории, не главная магазина
--         (на главной цен нет: «discounted pricing after signing in»).
--
-- НЕ подтверждаем: #528, #529 TEKLYNX — цитаты из PDF лицензии (сторож PDF не читает; письмо просит владельца);
--   #235 ALMEGO US OSHA, #428–#430 и #441 Chemical Manager — на страницах не названы (письмо спрашивает EcoOnline).
-- ВЫПОЛНИТЬ В SQL EDITOR.

update directory_facts
   set source_url = 'https://store.general-data.com/printers/color-inkjet-label-printers/', checked_on = '2026-10-09'
 where id in (1880, 1881);

update directory_facts
   set confirmed = true, confirmed_on = '2026-10-09'
 where id in (255, 256, 257, 258, 445, 446, 447, 448, 850, 1879, 1325, 1326, 1327, 1880, 1881)
   and confirmed is distinct from true;

-- проверка: должно быть 15 строк, все confirmed = true
-- select id, entry_id, kind, left(coalesce(quote, value), 60) as v, confirmed, confirmed_on, source_url
--   from directory_facts where id in (255, 256, 257, 258, 445, 446, 447, 448, 850, 1879, 1325, 1326, 1327, 1880, 1881) order by id;
