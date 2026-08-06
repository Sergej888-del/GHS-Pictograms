/**
 * Транспортная секция страницы вещества — связка «CAS → номер ООН».
 *
 * ⚠⚠ СВЯЗЬ ИДЁТ ТОЛЬКО ПО CAS И ТОЛЬКО ЧЕРЕЗ `substance_un_link`. Колонка
 * `substances.un_number` пуста ВСЯ (проверено запросом: 0 непустых значений из
 * 4 178), и `dg_substances.cas_number` тоже пуста вся (0 из 2 939). Единственный
 * готовый мост между справочником и Таблицей A — таблица `substance_un_link`,
 * 519 строк, собранная в session 30. Любая попытка связать «по имени» уже
 * ломалась: имя `acetone` находит `acetone cyanohydrin`, а это другой класс
 * опасности и другая группа упаковки (правило записано на странице /un/).
 *
 * ⚠⚠ ОДИН CAS — НЕ ОДИН НОМЕР. У 57 веществ справочника номеров больше одного
 * (`match_type = 'exact_multi'`, confidence 80): кислород едет и как UN 1072
 * (сжатый), и как UN 1073 (охлаждённый жидкий), алюминиевый порошок — UN 1309
 * и UN 1396. Схлопывать их в «UN номер вещества» НЕЛЬЗЯ: выбор строки зависит
 * от формы и концентрации груза, и это решение отправителя, а не наше.
 * Поэтому entries — массив, и на странице печатаются все.
 *
 * ⚠ ДВЕ ЮРИСДИКЦИИ НЕ СЛИВАЮТСЯ. Тот же инвариант, что на /un/<номер>/:
 * у ADR и 49 CFR свои строки, свои коды знаков и свои картинки. Здесь они лежат
 * в РАЗНЫХ полях (`adr` / `dot`) именно затем, чтобы их нельзя было случайно
 * сложить в одну строку разметки.
 *
 * ⚠ Полные данные (спецположения, инструкции по упаковке, предельные
 * количества, оранжевая табличка) живут на /un/<номер>/. Здесь — только то,
 * что отвечает на вопрос «под каким номером это едет и каким знаком метится»,
 * плюс ссылка. Дубль страницы /un/ здесь был бы каннибализацией собственной
 * выдачи.
 */

/** Строка Таблицы A ADR — ровно те поля, которые печатает страница вещества. */
export type UnAdrRow = {
  un_number: string
  proper_shipping_name: string
  transport_class: string | null
  classification_code: string | null
  packing_group: string | null
  label_codes: string[] | null
  adr_status: string | null
}

/** Строка §172.101 — ровно те поля, которые печатает страница вещества. */
export type UnDotRow = {
  un_number: string
  row_order: number
  id_prefix: string | null
  proper_shipping_name: string
  hazard_class: string | null
  packing_group: string | null
  label_codes: string[] | null
}

/** Строка моста CAS → UN. */
export type UnLinkRow = {
  cas_number: string
  un_number: string
  match_type: string
}

/** Готовая запись для разметки: один номер ООН со всеми своими строками. */
export type UnEntry = {
  /** номер без префикса: «1090» */
  un: string
  /** адрес страницы номера; null — страницы нет, тогда номер печатается без ссылки */
  href: string | null
  /** exact_1to1 | exact_multi | manual — см. шапку */
  matchType: string
  adr: UnAdrRow[]
  dot: UnDotRow[]
}

/**
 * Сортировка номеров ООН. ⚠ Числом, а не строкой: строковое сравнение ставит
 * «UN 1090» после «UN 10», и у веществ с номерами 1090 / 1993 порядок на
 * странице разошёлся бы с порядком в Таблице A.
 */
function byUnNumber(a: UnEntry, b: UnEntry): number {
  const na = Number(a.un)
  const nb = Number(b.un)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a.un.localeCompare(b.un)
}

/** Группировка строк по номеру ООН — один проход вместо фильтра на каждой странице. */
function groupByUn<T extends { un_number: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const list = m.get(r.un_number)
    if (list) list.push(r)
    else m.set(r.un_number, [r])
  }
  return m
}

/**
 * Строит записи транспортной секции для ВСЕХ веществ разом.
 *
 * ⚠ Считается один раз в getStaticPaths на всю сборку. Раскладывать 519 связей
 * фильтром внутри каждой из 3 650 страниц — 1,9 млн лишних сравнений при
 * нулевой пользе.
 *
 * @param pages номера, у которых РЕАЛЬНО есть страница (`un_page_index`).
 *              Номер вне этого множества показывается текстом без ссылки:
 *              ссылка в 404 хуже, чем номер без ссылки.
 */
export function buildUnEntriesByCas(input: {
  links: UnLinkRow[]
  adr: UnAdrRow[]
  dot: UnDotRow[]
  pages: Set<string>
}): Map<string, UnEntry[]> {
  const adrByUn = groupByUn(input.adr)
  const dotByUn = groupByUn(input.dot)
  const out = new Map<string, UnEntry[]>()

  for (const link of input.links) {
    const adr = adrByUn.get(link.un_number) ?? []
    const dot = dotByUn.get(link.un_number) ?? []
    // ⚠ Ни одной строки ни в одной системе — показывать нечего. Такой связи
    // сейчас нет (все 389 номеров моста лежат в un_page_index), но связь,
    // добавленная будущим импортом на номер вне обеих таблиц, дала бы пустой
    // заголовок «UN 1234» без единой строки под ним.
    if (!adr.length && !dot.length) continue

    const entry: UnEntry = {
      un: link.un_number,
      href: input.pages.has(link.un_number) ? `/un/${link.un_number}/` : null,
      matchType: link.match_type,
      // ⚠ Порядок строк ADR приходит из запроса (по группе упаковки), 49 CFR —
      // по `row_order`, то есть в порядке печати самой таблицы. Пересортировка
      // здесь сломала бы соответствие с /un/<номер>/, где порядок тот же.
      adr,
      dot: [...dot].sort((x, y) => x.row_order - y.row_order),
    }

    const list = out.get(link.cas_number)
    if (list) list.push(entry)
    else out.set(link.cas_number, [entry])
  }

  for (const [cas, list] of out) out.set(cas, list.sort(byUnNumber))
  return out
}

/**
 * Подпись под секцией, когда у вещества больше одного номера.
 * ⚠ Текст обязан сказать, ПОЧЕМУ номеров несколько, иначе читатель прочтёт это
 * как ошибку данных. Причина всегда одна: разные формы или концентрации.
 */
export const MULTI_UN_NOTE =
  'The same CAS number is shipped under more than one UN number. Which entry applies follows from ' +
  'the form and the concentration of the consignment — read the proper shipping name, not the CAS.'
