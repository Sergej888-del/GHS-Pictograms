/**
 * P-фразы вещества, разложенные по роли на этикетке.
 *
 * ⚠ Зачем группы, а не один список. На этикетке P-фразы никогда не идут
 * сплошняком: CLP Annex IV делит их на пять разделов, и раздел отвечает на
 * СВОЙ вопрос читателя. «P280 Wear protective gloves» — это ответ на «что
 * надеть ДО работы», а «P305+P351+P338» — на «что делать, когда уже попало
 * в глаз». Свалить их в одну строку значит заставить человека сортировать
 * сорок фраз глазами в тот момент, когда сортировать некогда.
 *
 * ⚠ Порядок разделов — регламентный (general → prevention → response →
 * storage → disposal), а не по числу фраз. Внутри раздела — по коду.
 *
 * ⚠⚠ Категорию берём ИЗ БАЗЫ (`p_statements.category`), а не из первой цифры
 * кода. Соблазн написать `code[1] === '2' ? 'prevention' : …` велик и почти
 * работает, но комбинированные коды CLP ломают правило: `P301+P330+P331`
 * начинается с тройки, а «P103 Read the label before use» — общая, не
 * профилактическая. База — единственный источник, который знает это точно.
 */

/** Одна фраза так, как она нужна карточке. */
export type PStatementItem = {
  code: string
  /** Читаемая формулировка. Пусто быть не должно — см. `must` в getStaticPaths. */
  text: string
}

export type PStatementGroup = {
  /** Ключ раздела CLP: general | prevention | response | storage | disposal. */
  key: string
  /** Подпись раздела для заголовка H4. */
  label: string
  /** Одна строка о том, на какой вопрос отвечает раздел. */
  blurb: string
  items: PStatementItem[]
}

/**
 * ⚠ Порядок разделов CLP Annex IV. Незнакомая категория (появится новая — в
 * базе она уже возможна) не теряется: она уезжает в конец под своим именем,
 * а не выбрасывается. Молча потерянная фраза на странице про безопасность —
 * худший из возможных исходов.
 */
const GROUP_ORDER = ['general', 'prevention', 'response', 'storage', 'disposal'] as const

const GROUP_LABEL: Record<string, string> = {
  general: 'General',
  prevention: 'Prevention',
  response: 'Response',
  storage: 'Storage',
  disposal: 'Disposal',
}

const GROUP_BLURB: Record<string, string> = {
  general: 'Statements that belong on the label whoever handles the product.',
  prevention: 'What to do before and during handling so the hazard never happens.',
  response: 'What to do once exposure, spillage or fire has already happened.',
  storage: 'How the container has to be kept between uses.',
  disposal: 'What has to happen to the contents and the empty container.',
}

/** Подпись незнакомого раздела: «other» → «Other». Заглушек не выдумываем. */
function labelFor(key: string): string {
  return GROUP_LABEL[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

/**
 * Разложить коды вещества по разделам.
 *
 * @param codes  `substances.p_statement_codes` как есть.
 * @param meta   код → { text, category } из `p_statements`.
 *
 * ⚠ Код, которого нет в `meta`, пропускается СОЗНАТЕЛЬНО: карточка без текста
 * — это тот же голый код, ради ухода от которого всё и затевалось. Проверка
 * `subs-p-cards` в check:dist ловит расхождение счётчиков, поэтому пропуск не
 * останется незамеченным.
 */
export function groupPStatements(
  codes: string[] | null | undefined,
  meta: Record<string, { text: string; category: string } | undefined>,
): PStatementGroup[] {
  const byKey = new Map<string, PStatementItem[]>()

  for (const code of [...new Set(codes ?? [])].sort()) {
    const m = meta[code]
    if (!m?.text) continue
    const key = m.category || 'other'
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push({ code, text: m.text })
  }

  const known = GROUP_ORDER.filter((k) => byKey.has(k))
  const unknown = [...byKey.keys()].filter((k) => !GROUP_ORDER.includes(k as never)).sort()

  return [...known, ...unknown].map((key) => ({
    key,
    label: labelFor(key),
    blurb: GROUP_BLURB[key] ?? '',
    items: byKey.get(key)!,
  }))
}

/** Сколько фраз попало в карточки. Нужен и странице, и проверке. */
export function countPStatements(groups: PStatementGroup[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0)
}
