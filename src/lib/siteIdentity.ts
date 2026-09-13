// Публичные идентичности сайта и автора — один источник для JSON-LD (/about/),
// подвала и сторожа `about-page` в check-dist. Session 89 (№136 беклинки, LinkedIn).
//
// ⚠ Адрес LinkedIn — кастомный слуг, закреплён 13.09.2026 (решение Сергея: хотели `sergejs-sevcenko`,
// слуг оказался занят; взят `sergejssevcenko` — как почтовый адрес sergejssevcenko@ghslabels.com;
// имя в профиле — Sergejs, та же форма, что на /about/, в статье и в подписи писем). Менять слуг в LinkedIn после
// этого нельзя: старый адрес перестаёт работать, а он уже стоит в sameAs и в письмах.

export const AUTHOR_NAME = 'Sergejs Sevcenko'
export const AUTHOR_LINKEDIN = 'https://www.linkedin.com/in/sergejssevcenko/'

/** Профили автора для `Person.sameAs` — только те, что реально существуют. */
export const AUTHOR_SAME_AS: readonly string[] = [AUTHOR_LINKEDIN]
