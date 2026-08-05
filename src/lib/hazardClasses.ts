/**
 * Класс и категория опасности вещества, выведенные из его H-кодов.
 *
 * ⚠⚠⚠ ГЛАВНОЕ ОГРАНИЧЕНИЕ, КОТОРОЕ НЕЛЬЗЯ ЗАМАЗЫВАТЬ.
 * Таблица `hazard_classifications` в базе ПУСТА: своей записи «вещество →
 * класс, категория» у нас нет. Здесь мы выводим класс из H-кода по
 * `hazard_category_mapping`, и это вывод, а не выписка из Annex VI.
 *
 * Вывод точен не всегда, и молчать об этом нельзя. Замер по 65 кодам, которые
 * реально стоят у наших веществ:
 *
 *   · 47 кодов → ровно один класс и одна категория. Показываем как факт.
 *   · 13 кодов → один класс, НЕСКОЛЬКО категорий. H350 — это Carc. 1A или
 *     1B; H314 — Skin Corr. 1A, 1B или 1C. Какая именно, знает только сам
 *     Annex VI, а его колонки у нас нет.
 *   · 5 кодов → НЕСКОЛЬКО классов. H272 — окисляющая жидкость ИЛИ твёрдое
 *     вещество; H241 — саморазлагающееся вещество ИЛИ органический пероксид.
 *     Различает их агрегатное состояние, которого мы не знаем.
 *   · 9 суффиксных кодов (H350i, H360F, H361fd…) в таблице отсутствуют
 *     вовсе — строки для них не будет.
 *
 * ⚠ Поэтому неоднозначность ПОКАЗЫВАЕТСЯ («Category 1A or 1B»), а не
 * прячется выбором первой строки. Правило session 35 про числа действует и
 * здесь: подтверждения нет — значит рядом обязана стоять оговорка.
 *
 * ⚠ Пиктограмма и сигнальное слово печатаются ТОЛЬКО когда они одинаковы у
 * всех подошедших строк. У H221 категория 1B даёт «Danger», категория 2 —
 * «Warning»; напечатать одно из двух значило бы соврать ровно в половине
 * случаев. Настоящее сигнальное слово вещества лежит в `substances.signal_word`
 * и показано отдельно — здесь оно не нужно.
 */

/** Строка `hazard_category_mapping` в том виде, в каком её берёт страница. */
export type CategoryMapRow = {
  hazard_class_id: string
  category_code: string | null
  pictogram_code: string | null
  signal_word: string | null
  h_statement_code: string | null
}

/** Строка `hazard_class_catalog`. */
export type ClassCatalogRow = {
  id: string
  class_code: string
  name_en: string
  ghs_chapter: string | null
  display_order: number | null
}

export type HazardClassEntry = {
  /** H-код, из которого выведена строка. */
  hCode: string
  /** Имя класса. Несколько — соединены «or», см. шапку файла. */
  className: string
  classAmbiguous: boolean
  ghsChapter: string | null
  /** Категории как в CLP: «2», «1A», «Type C and D». */
  categories: string[]
  categoryAmbiguous: boolean
  /** Показывается, только если совпала у всех строк кода. */
  pictogram: string | null
  displayOrder: number
}

/** Порядок вывода: как в каталоге классов, физические опасности первыми. */
const LAST = 9999

/**
 * Собрать строки «класс — категория» для набора H-кодов вещества.
 *
 * ⚠ Одна строка на H-КОД, а не на класс. У вещества с H314 и H315 класс один
 * (Skin corrosion/irritation), но категории разные (1A/1B/1C против 2), и
 * схлопывание в одну строку потеряло бы именно то, ради чего секция заводится.
 */
export function buildHazardClasses(
  hCodes: string[] | null | undefined,
  maps: CategoryMapRow[],
  catalog: ClassCatalogRow[],
): HazardClassEntry[] {
  if (!hCodes?.length) return []

  const classById = new Map(catalog.map((c) => [c.id, c]))
  const byCode = new Map<string, CategoryMapRow[]>()
  for (const row of maps) {
    if (!row.h_statement_code) continue
    if (!byCode.has(row.h_statement_code)) byCode.set(row.h_statement_code, [])
    byCode.get(row.h_statement_code)!.push(row)
  }

  const entries: HazardClassEntry[] = []
  for (const code of [...new Set(hCodes)]) {
    const rows = byCode.get(code)
    if (!rows?.length) continue

    const classes = [...new Set(rows.map((r) => r.hazard_class_id))]
      .map((id) => classById.get(id))
      .filter((c): c is ClassCatalogRow => Boolean(c))
    if (!classes.length) continue

    // ⚠ Сортировка имён нужна ДО склейки: без неё «Oxidising solids or
    // oxidising liquids» и «Oxidising liquids or oxidising solids» — две
    // разные строки на разных страницах, и проверка уникальности description
    // ловит их как расхождение данных, хотя это порядок строк из PostgREST.
    const names = [...new Set(classes.map((c) => c.name_en))].sort()
    const categories = [...new Set(rows.map((r) => r.category_code).filter((c): c is string => Boolean(c)))].sort()

    const picts = [...new Set(rows.map((r) => r.pictogram_code).filter(Boolean))]
    const chapters = [...new Set(classes.map((c) => c.ghs_chapter).filter(Boolean))]

    entries.push({
      hCode: code,
      className: names.join(' or '),
      classAmbiguous: names.length > 1,
      ghsChapter: chapters.length === 1 ? (chapters[0] as string) : null,
      categories,
      categoryAmbiguous: categories.length > 1,
      pictogram: picts.length === 1 ? (picts[0] as string) : null,
      displayOrder: Math.min(...classes.map((c) => c.display_order ?? LAST)),
    })
  }

  // ⚠ Второй ключ — сам код: у двух классов бывает один display_order, и без
  // добора порядок строк зависел бы от того, как база вернула mapping.
  return entries.sort((a, b) => a.displayOrder - b.displayOrder || a.hCode.localeCompare(b.hCode))
}

/** Подпись категории для таблицы. Пусто — когда категории в mapping нет. */
export function categoryLabel(entry: HazardClassEntry): string {
  if (!entry.categories.length) return ''
  if (entry.categories.length === 1) return `Category ${entry.categories[0]}`
  return `Category ${entry.categories.join(' or ')}`
}

/** Нужна ли под таблицей оговорка про вывод. Считается по данным, не по флагу. */
export function hasAmbiguity(entries: HazardClassEntry[]): boolean {
  return entries.some((e) => e.classAmbiguous || e.categoryAmbiguous)
}

/** Коды, для которых строки не нашлось: их надо честно перечислить. */
export function unmappedCodes(hCodes: string[] | null | undefined, entries: HazardClassEntry[]): string[] {
  const known = new Set(entries.map((e) => e.hCode))
  return [...new Set(hCodes ?? [])].filter((c) => !known.has(c)).sort()
}
