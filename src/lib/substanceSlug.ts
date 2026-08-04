/**
 * Адреса страниц справочника веществ: /substances/<имя>-<cas>/
 *
 * ⚠ Почему CAS в хвосте, а не чистое имя (решение session 35).
 * 707 имён ещё не курированы (522 `annex-vi-first-pending` + 185 `reaction-mass-auto`).
 * При схеме «чистое имя» каждая правка имени ломала бы адрес проиндексированной
 * страницы. CAS работает как вечный ключ — как ID у Stack Overflow в
 * `/questions/12345/any-title`: имя правится сколько угодно, приёмник узнаёт
 * страницу по CAS и ведёт на актуальный адрес.
 *
 * ⚠ Уникален ПОЛНЫЙ слаг, а не CAS-суффикс. У разных форм одного вещества CAS
 * общий: `hydrochloric-acid-7647-01-0` и `hydrogen-chloride-7647-01-0` — это две
 * страницы с одним CAS, и так задумано.
 *
 * Полный разбор: claude/substance-hub-decisions.md §1.
 */

/** Максимум знаков у именной части. Полное имя доходит до 378 знаков — в адрес такое не кладём. */
export const SLUG_NAME_MAX = 60

/**
 * CAS в конце слага. Форма по стандарту: 2–7 цифр, дефис, 2 цифры, дефис, контрольная цифра.
 * Якорь на конец обязателен — иначе `1,1,1-trichloroethane` отдаст «1-1-1» из середины имени.
 */
const CAS_TAIL = /-(\d{2,7}-\d{2}-\d)$/

/** Имя → безопасная для адреса основа. Регистр вниз, всё лишнее в дефис. */
function nameToSlugBase(name: string): string {
  const flat = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (flat.length <= SLUG_NAME_MAX) return flat

  // Режем по границе сегмента, а не по букве: обрубок вида `2-ethylhexyl-2-eth`
  // читается как другое вещество.
  const cut = flat.slice(0, SLUG_NAME_MAX + 1)
  const lastDash = cut.lastIndexOf('-')
  return (lastDash > 20 ? cut.slice(0, lastDash) : flat.slice(0, SLUG_NAME_MAX)).replace(/-+$/, '')
}

/**
 * Адресный слаг вещества.
 * @param name человекочитаемое имя (substanceNameFull)
 * @param cas  CAS без квадратных скобок — многосоставные записи сюда не попадают
 */
export function substanceSlug(name: string, cas: string): string {
  const base = nameToSlugBase(name)
  // Имени может не остаться вовсе (например, имя целиком из символов) — тогда адрес несёт только CAS.
  return base ? `${base}-${cas}` : cas
}

/** Полный путь страницы. Всегда с завершающим слэшем — иначе Cloudflare редиректит, и canonical смотрит на редирект. */
export function substanceHref(name: string, cas: string): string {
  return `/substances/${substanceSlug(name, cas)}/`
}

/**
 * Обратный разбор: из слага достать CAS.
 * Нужен редиректу с ghssymbols и проверкам в check:dist.
 * Возвращает null, если хвост не похож на CAS.
 */
export function casFromSlug(slug: string): string | null {
  const m = CAS_TAIL.exec(slug)
  if (m) return m[1]
  // Слаг без имени — сам CAS целиком.
  return /^\d{2,7}-\d{2}-\d$/.test(slug) ? slug : null
}

/**
 * Контрольная сумма CAS по правилу CAS Registry: сумма цифр с весами справа налево mod 10.
 * ⚠ Используется ТОЛЬКО для отсева мусора в проверках, не для правки данных.
 * У 155 записей CAS обрезан на 20 знаках (дефект B) — они не пройдут и не должны.
 */
export function isValidCas(cas: string): boolean {
  const m = /^(\d{2,7})-(\d{2})-(\d)$/.exec(cas)
  if (!m) return false
  const digits = (m[1] + m[2]).split('').reverse()
  const sum = digits.reduce((acc, d, i) => acc + Number(d) * (i + 1), 0)
  return sum % 10 === Number(m[3])
}
