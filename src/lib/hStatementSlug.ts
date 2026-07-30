/**
 * URL-слаги для суффиксных H-кодов CLP Annex VI §1.1.2.1.2.
 *
 * ⚠ Причина существования этого файла: `H360Fd` и `H360FD` — РАЗНЫЕ коды,
 * различающиеся только регистром последней буквы. Заглавная означает «эффект
 * доказан», строчная — «подозревается»:
 *   H360FD — may damage fertility. May damage the unborn child.
 *   H360Fd — may damage fertility. Suspected of damaging the unborn child.
 * На регистронезависимой файловой системе (NTFS, APFS по умолчанию) две такие
 * страницы пишутся в одну папку, и вторая молча затирает первую — ровно это
 * и случилось на первой сборке session 21: в dist оказалось 107 страниц из 108,
 * а на странице H360Fd лежало содержимое H360FD.
 *
 * Даже там, где сборка проходит (Linux на Cloudflare Pages), два адреса,
 * различающиеся регистром, — плохая идея: их путает человек, набирающий адрес
 * руками, и они рискуют быть склеены как дубликат в поиске.
 *
 * Решение Сергея (session 21): девять суффиксных кодов получают читаемый слаг
 * с расшифровкой. Остальные 99 кодов используют сам код без изменений.
 */

/** code → slug. Только для кодов, у которых слаг отличается от кода. */
const SUFFIXED_SLUGS: Record<string, string> = {
  H350i: 'H350i-cancer-by-inhalation',
  H360F: 'H360F-may-damage-fertility',
  H360D: 'H360D-may-damage-unborn-child',
  H360FD: 'H360FD-fertility-and-unborn-child',
  H360Fd: 'H360Fd-fertility-and-suspected-unborn-child',
  H360Df: 'H360Df-unborn-child-and-suspected-fertility',
  H361f: 'H361f-suspected-damaging-fertility',
  H361d: 'H361d-suspected-damaging-unborn-child',
  H361fd: 'H361fd-suspected-fertility-and-unborn-child',
}

/** slug → code, построена из той же таблицы, чтобы не разъехалась. */
const CODE_BY_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SUFFIXED_SLUGS).map(([code, slug]) => [slug, code])
)

/** Слаг для URL. Для обычного кода возвращает сам код. */
export function hSlug(code: string): string {
  return SUFFIXED_SLUGS[code] ?? code
}

/** Обратное преобразование: из слага в URL получаем код. */
export function hCodeFromSlug(slug: string): string {
  return CODE_BY_SLUG[slug] ?? slug
}

/** Путь страницы кода. Одно место на весь сайт, чтобы ссылки не разъехались. */
export function hHref(code: string): string {
  return `/h-statements/${hSlug(code)}/`
}

/**
 * ⚠ Инвариант, который и был нарушен: слаги должны быть уникальны БЕЗ учёта
 * регистра. Проверяется на сборке — падение здесь лучше, чем молча потерянная
 * страница в dist.
 */
const seen = new Set<string>()
for (const slug of Object.values(SUFFIXED_SLUGS)) {
  const key = slug.toLowerCase()
  if (seen.has(key)) {
    throw new Error(`hStatementSlug: слаг ${slug} повторяется без учёта регистра`)
  }
  seen.add(key)
}

export { SUFFIXED_SLUGS }
