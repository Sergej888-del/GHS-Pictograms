-- Session 97 (2026-10-07) — подтверждения по отчёту check:directory (directory-check-2026-10-07.json)
-- Прогон после заливки посева s97 (GTS → claimed; #351 источник → sdsmanager.com/us/ из-за гео-редиректа /lv/).
-- Найдены на страницах вендоров и ранее не были подтверждены: 4 фактов.
-- unconfirm по отчёту: [] (пусто — ничего не снимаем).
-- Мёртвые адреса #12 ghsmixtures.com (ENOTFOUND) и #20 sdspro.com (ECONNREFUSED) — с машины Сергея; из облака #12 открывается,
-- #20 — см. заметку в хендоффе. Не трогаем.
-- ВЫПОЛНИТЬ В SQL EDITOR (UPDATE через MCP виснет, s97).

update directory_facts
   set confirmed = true, confirmed_on = '2026-10-07'
 where id in (351, 1334, 1335, 1785)
   and confirmed is distinct from true;

-- Заявка GTS: владелец подтвердил факты построчно 07.10 11:36 CET
update directory_claims
   set verified_at = '2026-10-07 10:40:00+00',
       note = note || '; owner confirmed line by line 07.10 11:36 CET (davidg@gts-translation.com): languages 100, per-word 0.09-0.19, Word+PDF, see terms-of-use; seed updated, tier=claimed'
 where id = 1 and verified_at is null;

-- Проверка: должно вернуть 4 строк с confirmed = true и одну заявку с verified_at
-- select id, entry_id, kind, value, confirmed, confirmed_on from directory_facts where id in (351, 1334, 1335, 1785);
-- select id, entry_id, owner_email, requested_at, verified_at from directory_claims;
