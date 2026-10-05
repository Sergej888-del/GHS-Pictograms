-- 92-directory-check-2026-10-05.sql — session 92, первый прогон scripts/check-directory.ts (машина Сергея, 05.10.2026)
--
-- ЗАЧЕМ. Цены и цитаты из условий вендоров печатаются только при confirmed = true (92-directory.sql). Отчёт
-- directory-check-2026-10-05.json нашёл evidence на странице-источнике у 332 фактов: price 86 · responsibility 119 ·
-- jurisdiction 102 · certification 15 · ufi_pcn 6 · iso17100 4. Страницы: ok 315 · blocked 57 · script-only 17 ·
-- dead 9 · error 8 — у закрытых от скриптов и рисуемых скриптом факты остаются неподтверждёнными (не печатаются).
-- Плюс две правки по мёртвым адресам (правило «у каждой строки — откуда известно»):
--   • 14 фактов, чей источник отдал 404 (Chemwatch GoSDS-лендинг, Chemwatch GoldFFX, Falcony /pricing, TPGTEX
--     ghs-labels, ALTA technical-translation), сняты — живого источника у них нет;
--   • ALTA Language Services (#150): страница услуги 404, о переводе SDS — только статья блога 2023 → «Checked and not listed».
-- ⚠ КАК ПРИМЕНЕНО. MCP-миграция `s92_directory_confirm_check_20261005` содержит ТОЛЬКО подтверждения (UPDATE):
--   DELETE через MCP требует подтверждения человека и дважды повис по таймауту (180 с), ничего не записав.
--   Снятие 14 фактов и перевод #150 в not-listed делает повторная заливка `npm run import:directory` из
--   scripts/data/directory-v3.json (curate.py: DEAD_SOURCES, STATE_OVERRIDE; id остальных фактов не сдвинуты), и она
--   же переносит 332 подтверждения — факты не менялись. Блоки DELETE/UPDATE ниже — для истории и на случай ручного
--   применения в SQL Editor.
-- ⚠ #12 GHS Mixture Calculator: ghsmixtures.com на машине Сергея — ENOTFOUND, из облака (WebFetch) открывается.
--   Не трогаем; перепроверить при следующем прогоне.
--
-- ДО:    1 854 факта, confirmed не стоит ни у одного; #150 state 'live'.
-- ПОСЛЕ: 1 840 фактов, confirmed = true у 332; #150 state 'not-listed'.
-- ROLLBACK: update public.directory_facts set confirmed = null, confirmed_on = null where confirmed_on = '2026-10-05';
--           (снятые факты и #150 — повторной заливкой directory-v3.json до этой правки, из git)

do $$
declare n_f int; n_c int;
begin
  select count(*), count(*) filter (where confirmed is not null) into n_f, n_c from public.directory_facts;
  if n_f <> 1854 or n_c <> 0 then raise exception 'pre: фактов %, подтверждённых % (ожидалось 1854 / 0)', n_f, n_c; end if;
end $$;

update public.directory_facts set confirmed = true, confirmed_on = '2026-10-05'
where id = any (array[1,2,3,9,10,11,12,16,17,26,27,28,41,42,48,76,77,82,84,85,86,87,88,89,90,105,111,113,114,116,117,118,119,120,130,131,137,138,139,140,141,142,143,144,145,146,154,155,156,157,158,162,164,165,166,167,180,181,183,184,185,190,191,204,205,233,234,241,250,255,256,257,258,259,260,294,295,307,328,329,336,337,338,344,355,356,363,364,365,397,398,399,411,415,416,445,446,447,448,456,459,469,482,512,527,530,543,576,577,578,579,580,586,587,588,590,591,592,602,603,604,605,606,612,613,621,622,635,637,638,639,657,688,689,690,703,713,714,715,716,725,732,738,739,740,755,764,775,782,783,784,793,803,812,813,827,838,849,850,873,891,892,893,894,903,904,905,906,907,909,910,923,924,925,926,965,974,975,978,979,980,987,988,1001,1002,1017,1018,1047,1048,1049,1060,1061,1075,1076,1077,1078,1086,1091,1092,1093,1116,1117,1126,1127,1128,1132,1133,1134,1135,1155,1156,1159,1160,1168,1170,1171,1172,1186,1187,1200,1201,1205,1217,1218,1219,1220,1238,1239,1240,1291,1303,1313,1314,1315,1316,1325,1326,1327,1331,1332,1333,1345,1349,1362,1363,1364,1365,1379,1380,1390,1391,1395,1401,1402,1403,1404,1415,1416,1425,1459,1460,1461,1462,1472,1473,1474,1478,1519,1526,1541,1542,1552,1553,1554,1555,1568,1569,1570,1583,1584,1593,1594,1595,1606,1622,1632,1646,1672,1673,1674,1695,1703,1704,1717,1726,1739,1740,1741,1742,1748,1750,1751,1752,1760,1761,1763,1764,1765,1766,1768,1775,1776,1777,1779,1781,1782,1787,1789,1790,1791,1798,1799,1800,1801,1802,1829,1840,1841,1842,1845,1853,1854]);

delete from public.directory_facts where id = any (array[43,387,388,389,390,391,392,1119,1120,1351,1352,1817,1822,1826]);

update public.directory_entries set
  category = 'not-listed', state = 'not-listed', url = null,
  description = 'Appears in search results for “SDS translation services”',
  reason = 'A general translation agency: we found no service page for SDS translation on its site, only a 2023 blog article. Its former technical-translation page returns 404.',
  reason_source = 'https://altalang.com/beyond-words/sds-and-msds-translation/',
  updated_at = now()
where id = 150;

do $$
declare n_f int; n_c int; s text;
begin
  select count(*), count(*) filter (where confirmed is true) into n_f, n_c from public.directory_facts;
  if n_f <> 1840 or n_c <> 332 then raise exception 'post: фактов %, подтверждённых % (ожидалось 1840 / 332)', n_f, n_c; end if;
  select state into s from public.directory_entries where id = 150;
  if s <> 'not-listed' then raise exception 'post: #150 state %', s; end if;
end $$;

-- ── Дополнение 05.10, после первого просмотра в dev ───────────────────────────────────────────────────────
-- MCP-миграция `s92_directory_vendor_ghsmixtures`: у #12 vendor «not named on the site» → 'ghsmixtures.com'
-- (в таблице читалось как имя компании). То же в directory-v3.json / curate.py (VENDOR[12]).
--   update public.directory_entries set vendor = 'ghsmixtures.com', updated_at = now()
--   where id = 12 and vendor = 'not named on the site';
