/**
 * Транспортные знаки опасности — единственный источник соответствий «код → файл».
 *
 * ⚠⚠ ДВА КОМПЛЕКТА, И ОНИ НЕ ВЗАИМОЗАМЕНЯЕМЫ. У США на знаке напечатано слово
 * (§172.419 называется «FLAMMABLE LIQUID label», §172.442 — «CORROSIVE label»),
 * у ADR надписи нет. Один и тот же номер ООН в Европе и в Штатах маркируется
 * разными картинками. Ставить знак ADR в панель 49 CFR — та же ошибка, что
 * слить спецположения двух систем в одну таблицу.
 *
 * ⚠ ПУНКТИРНОЙ РАМКИ В ФАЙЛАХ НЕТ, И ЭТО ПО РЕГЛАМЕНТУ. 49 CFR 172.407(b)(2):
 * «The dotted line border shown on each label is not part of the label
 * specification». Следствие: у белых знаков (2.3, 6.1, 6.2, 7A, 7E, 8, 9, 9A)
 * внешнего контура нет вовсе, и границу обязана давать подложка — за это
 * отвечает TransportLabel.astro, а не файл.
 *
 * ⚠ КЛАСС 1 У ADR ПЕЧАТАЕТСЯ С ЗАПОЛНИТЕЛЕМ. На образце стоит «*» вместо буквы
 * группы совместимости — ADR 5.2.2.2.2, примечание к модели 1. Поэтому файлов
 * ровно шесть (1.1…1.6), а букву подставляет компонент из classification_code.
 * У 49 CFR наоборот: там 34 готовых файла с уже впечатанным кодом.
 *
 * ⚠ НИЧЕГО НЕ УГАДЫВАЕМ. Код `7X` в ADR означает «категория зависит от самой
 * упаковки» (I-WHITE / II-YELLOW / III-YELLOW) — по номеру ООН её определить
 * нельзя, поэтому возвращаются все три знака, а не один наугад. Код
 * `See 5.2.2.1.12` и пустые значения возвращают null: страница показывает код
 * текстом и говорит, почему картинки нет.
 *
 * Происхождение файлов и лицензии — public/pictograms/transport/README.md.
 */

export type LabelPick = {
  /** путь к SVG от корня сайта */
  src: string
  /** alt для картинки — читается вслух, поэтому по-человечески */
  alt: string
  /** подпись под знаком */
  caption: string
  /** буква группы совместимости, которую печатает сам компонент (только класс 1 ADR) */
  group?: string
}

const ADR_DIR = '/pictograms/transport/adr'
const DOT_DIR = '/pictograms/transport/dot'

/** Названия моделей знаков ADR — ADR 5.2.2.2.2, колонка «Division or Category». */
export const ADR_LABEL_NAME: Record<string, string> = {
  '1.1': 'Explosive, division 1.1',
  '1.2': 'Explosive, division 1.2',
  '1.3': 'Explosive, division 1.3',
  '1.4': 'Explosive, division 1.4',
  '1.5': 'Explosive, division 1.5',
  '1.6': 'Explosive, division 1.6',
  '2.1': 'Flammable gas',
  '2.2': 'Non-flammable, non-toxic gas',
  '2.3': 'Toxic gas',
  '3': 'Flammable liquid',
  '4.1': 'Flammable solid',
  '4.2': 'Substance liable to spontaneous combustion',
  '4.3': 'Substance which emits flammable gas on contact with water',
  '5.1': 'Oxidizing substance',
  '5.2': 'Organic peroxide',
  '6.1': 'Toxic substance',
  '6.2': 'Infectious substance',
  '7A': 'Radioactive, category I — WHITE',
  '7B': 'Radioactive, category II — YELLOW',
  '7C': 'Radioactive, category III — YELLOW',
  '7E': 'Fissile material',
  '8': 'Corrosive substance',
  '9': 'Miscellaneous dangerous substance',
  '9A': 'Lithium batteries',
}

/** Названия ярлыков 49 CFR — §§172.411–172.448, как они озаглавлены в самом тексте. */
export const DOT_LABEL_NAME: Record<string, string> = {
  '1': 'EXPLOSIVE label (§172.411)',
  '1.1': 'EXPLOSIVE 1.1 label (§172.411)',
  '1.2': 'EXPLOSIVE 1.2 label (§172.411)',
  '1.3': 'EXPLOSIVE 1.3 label (§172.411)',
  '1.4': 'EXPLOSIVE 1.4 label (§172.411)',
  '1.5': 'BLASTING AGENT 1.5 label (§172.411)',
  '1.6': 'EXPLOSIVE 1.6 label (§172.411)',
  '2.1': 'FLAMMABLE GAS label (§172.417)',
  '2.2': 'NON-FLAMMABLE GAS label (§172.415)',
  '2.3': 'INHALATION HAZARD label (§172.416)',
  '3': 'FLAMMABLE LIQUID label (§172.419)',
  '4.1': 'FLAMMABLE SOLID label (§172.420)',
  '4.2': 'SPONTANEOUSLY COMBUSTIBLE label (§172.422)',
  '4.3': 'DANGEROUS WHEN WET label (§172.423)',
  '5.1': 'OXIDIZER label (§172.426)',
  '5.2': 'ORGANIC PEROXIDE label (§172.427)',
  '6.1': 'POISON label (§172.430)',
  '6.2': 'INFECTIOUS SUBSTANCE label (§172.432)',
  '7': 'RADIOACTIVE label (§§172.436–172.440)',
  '8': 'CORROSIVE label (§172.442)',
  '9': 'CLASS 9 label (§172.446)',
}

/**
 * «None» в колонке (6) §172.101 — это напечатанное значение, а не пропуск:
 * ярлык не требуется (UN1845 сухой лёд, UN0012 патроны 1.4S и т. д.).
 *
 * ⚠ «Empty» сюда НЕ входит. Это ярлык EMPTY по §172.450 (UN2908, порожняя
 * упаковка радиоактивного материала). Картинки для него у нас пока нет, поэтому
 * функция вернёт пустой список — но код останется на странице текстом, и это
 * честно, а не «ярлык не нужен».
 */
const NO_LABEL = new Set(['none', ''])

/**
 * ⚠⚠ ДЕФЕКТ ПУБЛИКАЦИИ eCFR, а не наш разбор. В XML 49 CFR 172.101 две ячейки
 * колонки (6) напечатаны через точку вместо запятой:
 *
 *   UN1052 Hydrogen fluoride, anhydrous → `<ENT>8.6.1</ENT>`   должно быть `8, 6.1`
 *   UN3535 Toxic solid, flammable, …    → `<ENT>6.1. 4.1</ENT>` должно быть `6.1, 4.1`
 *
 * Соседние записи разделены правильно (UN1051 → `6.1, 3`), так что это опечатка
 * источника. В базе значение лежит как напечатано — мы источник не правим.
 * Разворачиваем только здесь, при показе, и код в исходном виде остаётся на
 * странице рядом со знаками.
 */
const CFR_TYPO: Record<string, string[]> = {
  '8.6.1': ['8', '6.1'],
  '6.1. 4.1': ['6.1', '4.1'],
}

/** Буквы групп совместимости класса 1 — ADR 2.2.1.1.6 / 49 CFR 173.52. */
const COMPAT_GROUP = /^([A-HJ-NP-S])$/

/**
 * Разбирает `1.1D` на подразделение и букву группы совместимости.
 * Возвращает null, если это не код класса 1.
 */
export function splitDivision(code: string): { division: string; group?: string } | null {
  const m = /^(1\.[1-6])\s*([A-Z])?$/.exec(code.trim())
  if (!m) return null
  const group = m[2] && COMPAT_GROUP.test(m[2]) ? m[2] : undefined
  return { division: m[1], group }
}

/**
 * Знак ADR по коду из колонки (5) Таблицы A.
 *
 * @param code               значение из `dg_substances.label_codes`
 * @param classificationCode колонка (3b) — оттуда берётся подразделение и буква
 *                           для класса 1, потому что в колонке (5) стоит просто «1»
 */
export function adrLabels(code: string, classificationCode?: string | null): LabelPick[] {
  const raw = (code ?? '').trim()
  if (NO_LABEL.has(raw.toLowerCase())) return []

  // ⚠ Категория радиоактивной упаковки по номеру ООН не определяется —
  // показываем все три и говорим об этом прямо.
  if (raw === '7X') {
    return ['7A', '7B', '7C'].map((c) => ({
      src: `${ADR_DIR}/adr-${c}.svg`,
      alt: `ADR label model ${c} — ${ADR_LABEL_NAME[c]}`,
      caption: c,
    }))
  }

  // ⚠ Ссылка на положение, а не знак. Картинки нет и быть не должно.
  if (/^see\b/i.test(raw)) return []

  // Класс 1: код в колонке (5) — «1» или «1.4»; подразделение и буква живут в (3b)
  if (raw === '1' || /^1\.[1-6]$/.test(raw)) {
    const fromClassification = classificationCode ? splitDivision(classificationCode) : null
    const division = raw === '1' ? fromClassification?.division ?? '1.1' : raw
    const group = fromClassification?.group
    return [{
      src: `${ADR_DIR}/adr-${division}.svg`,
      alt: `ADR label model 1 — ${ADR_LABEL_NAME[division] ?? 'Explosive'}${group ? `, compatibility group ${group}` : ''}`,
      caption: group ? `${division}${group}` : division,
      group,
    }]
  }

  const name = ADR_LABEL_NAME[raw]
  if (!name) return []
  return [{
    src: `${ADR_DIR}/adr-${raw}.svg`,
    alt: `ADR label model ${raw} — ${name}`,
    caption: raw,
  }]
}

/**
 * Ярлык 49 CFR по коду из колонки (6) §172.101.
 * Здесь подстановка не нужна: 34 кода класса 1 лежат готовыми файлами.
 */
export function dotLabels(code: string): LabelPick[] {
  const raw = (code ?? '').trim()
  if (NO_LABEL.has(raw.toLowerCase())) return []

  const typo = CFR_TYPO[raw]
  if (typo) return typo.flatMap((c) => dotLabels(c))

  const direct = `${DOT_DIR}/dot-${raw}.svg`
  const known = DOT_LABEL_NAME[raw]
  if (known) {
    return [{ src: direct, alt: `US DOT ${known}`, caption: raw }]
  }

  // 1.1A … 1.6N — файл лежит под полным кодом
  const split = splitDivision(raw)
  if (split?.group) {
    const name = DOT_LABEL_NAME[split.division] ?? 'EXPLOSIVE label (§172.411)'
    return [{
      src: direct,
      alt: `US DOT ${name}, compatibility group ${split.group}`,
      caption: raw,
    }]
  }

  return []
}

/** Полный список файлов комплекта — для проверки check:dist. */
export const TRANSPORT_LABEL_FILES = {
  adr: Object.keys(ADR_LABEL_NAME).map((c) => `${ADR_DIR}/adr-${c}.svg`),
  dot: Object.keys(DOT_LABEL_NAME).map((c) => `${DOT_DIR}/dot-${c}.svg`),
}
