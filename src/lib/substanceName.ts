/**
 * Единое правило имени вещества. Session 34.
 *
 * Порядок чтения:  common_name  ->  display_name_short  ->  iupac_name
 *
 * ⚠ Почему не «первый кусок iupac_name до ;»: колонка Annex VI
 * «International Chemical Identification» — это СПИСОК синонимов через
 * точку с запятой, и резать его в коде нельзя: у 68 записей это
 * «reaction mass of: A; B; C» (компоненты смеси, а не синонимы), а
 * квадратные скобки встречаются и внутри самих имён IUPAC.
 * Разрез сделан один раз в базе функцией public.annex_vi_first()
 * и лежит в display_name_short.
 *
 * ⚠ display_name_short заполнен правилом, безопасным по построению:
 * имя PubChem принято только там, где его подтверждает имя регламента.
 * Разбор: claude/session-34-display-name-findings.md
 */

/** Предел длины подписи в списках и карточках. */
export const NAME_MAX = 55

export type NameFields = {
  common_name?: string | null
  display_name_short?: string | null
  iupac_name?: string | null
}

/** Полное имя без обрезки — для title=, JSON-LD, <h1> и страницы вещества. */
export function substanceNameFull(s: NameFields): string {
  const curated = s.common_name?.trim()
  if (curated) return curated
  const short = s.display_name_short?.trim()
  if (short) return short
  return (s.iupac_name ?? '').trim()
}

/** Обрезка по границе слова с многоточием. */
export function truncateName(name: string, max: number = NAME_MAX): string {
  if (name.length <= max) return name
  const cut = name.slice(0, max)
  const space = cut.lastIndexOf(' ')
  const base = space > max * 0.6 ? cut.slice(0, space) : cut
  return base.replace(/[\s,;:–-]+$/, '') + '…'
}

/** Имя для списка. Полное имя класть в title=, иначе оно теряется. */
export function substanceName(s: NameFields, max: number = NAME_MAX): string {
  return truncateName(substanceNameFull(s), max)
}

/**
 * Колонки, которые обязан запрашивать каждый select имени.
 * ⚠ Забыть display_name_short — значит тихо откатиться на сырую строку Annex VI.
 */
export const NAME_COLUMNS = 'common_name, display_name_short, iupac_name'

/**
 * Ключи для Fuse.
 * ⚠ Индексировать надо ВСЕ три: display_name_short даёт «Phenol»,
 * а iupac_name — «carbolic acid». Выкинуть iupac_name из индекса —
 * значит потерять поиск по синонимам.
 */
export const NAME_SEARCH_KEYS = ['common_name', 'display_name_short', 'iupac_name'] as const
