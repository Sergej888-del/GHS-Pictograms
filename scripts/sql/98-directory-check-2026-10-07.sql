-- Session 98 (2026-10-07, вечер), check:directory после правок посева по письмам третьей волны
-- (claude/directory-outreach-wave3-s98.md). Найдены сторожем все 12 изменённых/новых фактов:
--   #1204 EHS Insight «USD 5,000 / year» (страница: «Starting at $5k per year») — обещано в письме;
--   #1376–#1378 ChemicalSafety, три цитаты Terms с написанием «ChemicalSafety» — обещано в письме;
--   #1778 ALM, п. 8.7 целиком — обещано в письме;
--   #1875–#1878 Nexreg, четыре цитаты из consultant services agreement (§1.4, §6.1, §6.2, §8.2) — обещано в письме;
--   #1805, #1813, #1814 GLTaC, ISO 17100 / 9001 по FAQ.
-- НЕ снимаем #1331, #1332, #1335 SQ Label (были подтверждены, сейчас не найдены): страница рисует цены скриптом и
--   отдаёт разный текст от раза к разу (s93, s97) — пустой ответ один из нескольких, это мигание, не смена цены.
-- #12 ghsmixtures.com ENOTFOUND — локальный DNS машины Сергея (s97: из облака открывается), не closed.
-- #1216 EHS Insight ToS §3.2 — дословно есть на странице (WebFetch 07.10), но сторож не находит; не подтверждаем
--   руками: при следующем прогоне он бы снял подтверждение. Разобрать по случаю.
-- ВЫПОЛНИТЬ В SQL EDITOR.

update directory_facts
   set confirmed = true, confirmed_on = '2026-10-07'
 where id in (1204, 1376, 1377, 1378, 1778, 1805, 1813, 1814, 1875, 1876, 1877, 1878)
   and confirmed is distinct from true;

-- проверка: должно быть 12 строк, все confirmed = true
-- select id, entry_id, kind, left(coalesce(quote, value), 60) as v, confirmed, confirmed_on
--   from directory_facts where id in (1204, 1376, 1377, 1378, 1778, 1805, 1813, 1814, 1875, 1876, 1877, 1878) order by id;
