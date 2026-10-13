-- Session 107 (2026-10-13) — третья заявка в каталоге: SQ Label (entry 113, Priber d.o.o.)
-- Источник: письмо владельца 13.10 через тикет-систему Priber [#73941] (с общего адреса info@priber.com), подпись Luka Viktor Rogac,
-- в копии Bernard Primozic (bernard.primozic@priber.com; его автоответ — «out of office until 9 Oct 2026», просрочен).
-- Право на заявку: домен priber.com; sqlabel.com принадлежит Priber d.o.o. (подвал «Copyright © 2026 Priber d.o.o.»,
-- legal notice priber.com: «SQ Label … are trademarks of Priber d.o.o.»).
-- Владелец дал: согласие, описание (55 слов), цены Original 397 / Original Plus 697 / Professional 597 / Professional Plus 897 («from»),
-- «perpetual, one-time», «no limit on printers», логотип (6 PNG), предложение партнёрской программы (ссылок до договора нет).
-- Построчного подтверждения карточки владельцем ещё не было (пять вопросов отправлены 13.10) → verified_at пусто, ставится после ответа.
-- Должность не названа. Время письма не записано — requested_at = дата письма.

insert into directory_claims (entry_id, owner_email, owner_domains, owner_name, owner_role, requested_at, verified_at, note)
values (113, 'info@priber.com', '{priber.com}', 'Luka Viktor Rogac', null,
        '2026-10-13 12:00:00+00', null,
        'Owner email via Priber ticket system [#73941], sent from the shared address info@priber.com (Bernard Primozic, Managing Director, in cc: bernard.primozic@priber.com). Owner supplied: consent, 55-word description, four edition prices (from), perpetual one-time licence, no printer limit, logo files, reseller-programme offer (no affiliate link until a signed agreement). Seed updated same day. Five questions sent 13.10 (Plus prices per workstation/VAT, updates and support, download = trial or limited, public EULA, role); verified_at after the answer.');
-- → id 3

-- Отчётный SELECT
-- select c.id, e.slug, c.owner_email, c.owner_name, c.requested_at, c.verified_at from directory_claims c join directory_entries e on e.id = c.entry_id order by c.requested_at;
