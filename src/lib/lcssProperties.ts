/**
 * Физико-химические свойства из PubChem LCSS: показ значений с УСЛОВИЯМИ.
 *
 * ⚠⚠⚠ Главное правило (session 35, урок «триангуляция не подойдёт»).
 * CAS-номер не различает форму вещества: 7647-01-0 — это и газообразный
 * хлороводород (кипение −85 °C), и водный раствор (50,6 °C). Оба источника
 * правы, сверить их между собой нельзя. Поэтому число НИКОГДА не показывается
 * голым: рядом обязаны стоять условия и источник.
 *
 *   было:  Density  0.7845 g/cm³
 *   стало: Density  0.7845 g/cm³   at 20 °C · HSDB
 *
 * Именно в момент нормализации `0.7899 g/cu cm at 20 °C` → `0.7845` число
 * становится способным соврать. Здесь мы это возвращаем обратно.
 *
 * Данные: src/data/lcss-values.json (1 380 веществ, до 3 значений на свойство).
 * Разбор: claude/substance-hub-decisions.md §2 и §3.
 */

/** Одно значение свойства так, как оно лежит в lcss-values.json. */
export type LcssValue = {
  /** Исходная строка источника целиком. Главное поле: если разбор не удался, показываем её. */
  raw: string
  /** Источник, полное имя. */
  src: string
  /** Нормализованное число, строкой. Может отсутствовать: «Miscible», «Not applicable». */
  v?: string
  /** Единица нормализованного числа: C | mmHg | g/cm3 | pct | air1 */
  u?: string
  /** Условие: температура, °C. */
  t?: string
  /** Условие: давление, мм рт. ст. */
  p?: string
  /** exact | lt | gt | range | approx | decomposes | sublimes */
  q?: string
  /** Значение снято в вакууме — как температура кипения при 760 мм оно не годится. */
  vac?: 1
  /** Источник второго ранга (не государственный). */
  r2?: 1
}

export type LcssRecord = Record<string, LcssValue[]>

/**
 * ⚠⚠⚠ Очистка одного значения ДО любого показа (аудит фактов, session 86).
 *
 * `lcss-values.json` собран разовым разбором, который в репозитории не лежит,
 * и в нём есть классы ошибок, найденные чтением 1 882 выпадающих значений:
 *
 *   · «FP: -30 °C» лежит в разделе ТОЧКИ ПЛАВЛЕНИЯ (7 строк) — источник
 *     подписал строку сам, разбор подпись проигнорировал. Это не значение
 *     этого свойства → строка выбрасывается целиком (return null);
 *   · «Density at 20 °C/20 °C = 1.119-1.123» дало плотность **20** — разбор
 *     взял первое число, и это была температура условия. Ловится границами
 *     правдоподобия и совпадением числа с `t` → число снимается, строка
 *     остаётся текстом с исходной формулировкой;
 *   · «Bulk density: 6.8 lb/gal», «Critical density», «Apparent density» —
 *     ДРУГОЕ свойство под той же подписью (76 строк) → число снимается;
 *   · «No autoflammability up to 500 °C» стало температурой самовоспламенения
 *     500 °C → число снимается;
 *   · «240 °C (explodes)», «657 °C, decomp», «Sublimes at 200 °C» со
 *     статусом `exact` (33 строки) → статус исправляется на decomposes /
 *     sublimes: в таблице появится условие, в прозу число не пойдёт.
 *
 * ⚠ Ни одна строка не исчезает без причины, названной здесь: выбрасывается
 * только то, что заведомо принадлежит другому свойству. Всё остальное
 * остаётся в таблице — но уже не может выдать себя за число.
 *
 * Пересборка JSON исключена сознательно: старый разбор восстановлен не
 * полностью (см. scripts/build-lcss-text.mjs), а правило, живущее в коде,
 * читается глазами и проверяется сторожем `check:facts`.
 */
const PROPERTY_LABEL_PREFIX: Array<[RegExp, string]> = [
  [/^\s*(FP|flash\s*point|flash\s*pt)\b/i, 'fp'],
  [/^\s*(BP|boiling\s*point|boiling\s*pt)\b/i, 'bp'],
  [/^\s*(MP|melting\s*point|melting\s*pt)\b/i, 'mp'],
  [/^\s*(VP|vapou?r\s*pressure)\b/i, 'vapor_pressure'],
  [/^\s*(density|specific\s*gravity|sp\.?\s*gr\.?)\b/i, 'density'],
  [/^\s*(autoignition|auto-ignition|ignition\s*temp)/i, 'autoignition'],
]

/** Границы правдоподобия числа в единице разбора. За ними число — ошибка разбора, не факт. */
const PLAUSIBLE: Record<string, [number, number]> = {
  bp: [-273.15, 6000],
  mp: [-273.15, 4000],
  fp: [-150, 700],
  autoignition: [50, 1500],
  density: [0.00005, 25],
  vapor_density: [0.05, 30],
  lel: [0, 100],
  uel: [0, 100],
  vapor_pressure: [0, 1e6],
}

const LABELLED = new Set(PROPERTY_LABEL_PREFIX.map(([, prop]) => prop))
const OTHER_DENSITY = /\b(bulk|apparent|critical|tap|packing|pour)\s+density|cric?itical\s+density/i
const NOT_A_TEMPERATURE = /\bno\s+autoflammab|not\s+autoflammab|does\s+not\s+(ignite|burn)|non-?flammable/i
const SUBLIMES = /\bsublim/i
const DECOMPOSES = /\bdecompos|\bdecomp\b|\bdec\.|\bexplodes?\b|\bexplosive\s+decomp/i

export function sanitizeValue(key: string, val: LcssValue): LcssValue | null {
  const raw = val.raw ?? ''

  // 1. Строка подписана как ДРУГОЕ свойство — она не отсюда.
  // ⚠ Только среди свойств, у которых есть своя подпись в списке: строка
  // «Density (air = 1)…» в vapor_density — не чужая, а своя.
  if (LABELLED.has(key)) {
    for (const [re, prop] of PROPERTY_LABEL_PREFIX) {
      if (re.test(raw)) {
        if (prop !== key) return null
        break
      }
    }
  }

  // 1b. ⛔ NFPA — запрещённое содержимое (решение D5, см. BANNED_ROW в
  // scripts/build-lcss-text.mjs): строка уходит целиком, а не чистится.
  // В lcss-values.json это 18 точек вспышки CAMEO с пометкой «(NFPA, 2010)».
  if (/\(NFPA[,\s]/.test(raw)) return null

  if (!val.v) return val
  const num = Number(val.v)
  let out: LcssValue = val

  // 2. Число за границами правдоподобия — ошибка разбора: снимаем число, строку оставляем.
  const range = PLAUSIBLE[key]
  if (!Number.isFinite(num) || (range && (num < range[0] || num > range[1]))) {
    out = stripNumber(out)
    return out
  }

  // 2b. Число совпало с температурой условия: «Density at 20 °C/20 °C = 1.119-1.123»
  // дало плотность 20 при t = 20. Разбор взял первое число строки, и это была
  // температура. Для температурных свойств такое совпадение невозможно по смыслу.
  if (key !== 'bp' && key !== 'mp' && key !== 'fp' && key !== 'autoignition' && val.t && Number(val.t) === num) {
    return stripNumber(out)
  }

  // 3. Другое свойство под той же подписью и «нет такого свойства» словами.
  if (key === 'density' && OTHER_DENSITY.test(raw)) return stripNumber(out)
  if (key === 'autoignition' && NOT_A_TEMPERATURE.test(raw)) return stripNumber(out)

  // 4. Разложение и возгонка, записанные как точное значение.
  if ((key === 'bp' || key === 'mp') && (!val.q || val.q === 'exact')) {
    if (SUBLIMES.test(raw)) out = { ...out, q: 'sublimes' }
    else if (DECOMPOSES.test(raw)) out = { ...out, q: 'decomposes' }
  }
  return out
}

function stripNumber(val: LcssValue): LcssValue {
  const out: LcssValue = { raw: val.raw, src: val.src }
  if (val.t) out.t = val.t
  if (val.p) out.p = val.p
  if (val.q) out.q = val.q
  if (val.vac) out.vac = val.vac
  if (val.r2) out.r2 = val.r2
  return out
}

/** Порядок свойств в таблице. Сначала то, что чаще всего ищут. */
export const PROPERTY_ORDER = [
  'bp',
  'mp',
  'density',
  'solubility',
  'vapor_pressure',
  'fp',
  'autoignition',
  'lel',
  'uel',
  'vapor_density',
  'odor_threshold',
  'critical_temp_pressure',
  'corrosivity',
] as const

export const PROPERTY_LABEL: Record<string, string> = {
  bp: 'Boiling point',
  mp: 'Melting point',
  fp: 'Flash point',
  density: 'Density',
  vapor_pressure: 'Vapor pressure',
  vapor_density: 'Vapor density',
  autoignition: 'Autoignition temperature',
  lel: 'Lower explosive limit (LEL)',
  uel: 'Upper explosive limit (UEL)',
  solubility: 'Solubility',
  odor_threshold: 'Odor threshold',
  critical_temp_pressure: 'Critical temperature and pressure',
  corrosivity: 'Corrosivity',
}

/**
 * Хвост заголовка H3 над свойством: «Acetone boiling point».
 *
 * ⚠⚠ Карта ЯВНАЯ, а не `PROPERTY_LABEL[key].toLowerCase()`. Автоматический
 * вариант даёт «acetone lower explosive limit (lel)» — аббревиатура в скобках
 * уезжает в нижний регистр вместе со всей строкой, и заголовок читается как
 * опечатка. Плюс здесь встают формулировки, под которыми свойство реально
 * ищут: «vapour pressure» пишется в UK-варианте у трети запросов, а
 * «water solubility» — частотнее голого «solubility».
 *
 * ⚠ Ключи обязаны совпадать с PROPERTY_ORDER. Незнакомый ключ падает на
 * PROPERTY_LABEL — заголовок будет некрасивым, но страница не сломается.
 */
export const PROPERTY_HEADING: Record<string, string> = {
  bp: 'boiling point',
  mp: 'melting point',
  fp: 'flash point',
  density: 'density',
  vapor_pressure: 'vapor pressure',
  vapor_density: 'vapor density',
  autoignition: 'autoignition temperature',
  lel: 'lower explosive limit (LEL)',
  uel: 'upper explosive limit (UEL)',
  solubility: 'solubility',
  odor_threshold: 'odor threshold',
  critical_temp_pressure: 'critical temperature and pressure',
  corrosivity: 'corrosivity',
}

/**
 * Короткие имена источников. Полные строки нечитаемы в таблице
 * («Hazardous Substances Data Bank (HSDB)» занимает всю ячейку).
 * ⚠ Порядок важен: первое совпадение по вхождению и выигрывает.
 */
const SOURCE_SHORT: Array<[RegExp, string]> = [
  [/Hazardous Substances Data Bank/i, 'HSDB'],
  [/National Institute for Occupational Safety/i, 'NIOSH'],
  [/International Chemical Safety Cards|ILO-WHO/i, 'ICSC'],
  [/CAMEO Chemicals/i, 'CAMEO'],
  [/Emergency Response Guidebook/i, 'ERG'],
  [/National Toxicology Program/i, 'NTP'],
  [/Occupational Safety and Health Administration/i, 'OSHA'],
  [/Agency for Toxic Substances/i, 'ATSDR'],
  [/International Agency for Research on Cancer/i, 'IARC'],
  [/NJDOH|New Jersey/i, 'NJ DOH'],
  [/Department of Energy|PAC Chemical/i, 'DOE PAC'],
  [/Environmental Protection Agency|^EPA |EPA /i, 'EPA'],
  [/Haz-Map/i, 'Haz-Map'],
  [/Human Metabolome/i, 'HMDB'],
  [/Toxin and Toxin Target/i, 'T3DB'],
  [/JECFA|FAO\/WHO/i, 'JECFA'],
  [/U\.?S\.? Geological Survey|USGS/i, 'USGS'],
]

export function shortSource(src: string): string {
  for (const [re, short] of SOURCE_SHORT) if (re.test(src)) return short
  // Незнакомый источник показываем как есть, но без хвоста в скобках.
  return src.replace(/\s*\(.*$/, '').trim() || src
}

/** Государственный ли источник — влияет только на порядок, не на показ. */
export function isPrimarySource(val: LcssValue): boolean {
  return val.r2 !== 1
}

/**
 * ⚠⚠ Ключи обязаны совпадать с тем, что РЕАЛЬНО лежит в lcss-values.json.
 * Было написано `pct` и `air1`, а импорт кладёт `%vol` и `air=1` — и 2 747
 * значений печатались служебным ключом: «2.5 %vol», «1.02 air=1».
 * Незнакомая единица падает в `?? val.u`, то есть молча, без ошибки.
 * Проверено по данным: встречаются ровно пять — C, g/cm3, mmHg, %vol, air=1.
 */
const UNIT_SUFFIX: Record<string, string> = {
  C: '°C',
  mmHg: 'mmHg',
  'g/cm3': 'g/cm³',
  '%vol': '% by volume',
  'air=1': '(air = 1)',
}

/** Число к виду, пригодному для чтения: убрать хвостовые нули, не терять точность. */
function trimNumber(n: number): string {
  if (!Number.isFinite(n)) return ''
  if (Math.abs(n) >= 1000 || (Math.abs(n) < 0.001 && n !== 0)) {
    return String(Number(n.toPrecision(4)))
  }
  return String(Number(n.toFixed(4)))
}

/**
 * Значение в том виде, в каком оно встанет в таблицу.
 * Для температур сразу даём °F — половина аудитории в США, и запрос
 * «boiling point of hexane in fahrenheit» приходит именно за этим.
 */
export function formatValue(val: LcssValue): string {
  // ⚠ Значение словами показываем без служебных пометок HSDB: они уезжают в
  // колонку условий, а в ячейке значения читаются как часть текста и путают.
  if (!val.v) return val.raw.replace(/\s\/[^/]{2,80}\/(?=$|[\s;,.])/g, '').trim() || val.raw
  const num = Number(val.v)
  if (!Number.isFinite(num)) return val.raw

  const unit = val.u ? UNIT_SUFFIX[val.u] ?? val.u : ''
  const main = `${trimNumber(num)} ${unit}`.trim()

  if (val.u === 'C') {
    // ⚠ Пересчёт точность НЕ создаёт. 56.08 °C — четыре значащих цифры, а
    // 132.944 °F их шесть: три последних знака выдуманы арифметикой.
    // Округляем до десятых — это и честнее, и читается как у NIOSH: «133 °F».
    const f = Math.round((num * 9 / 5 + 32) * 10) / 10
    return `${main} (${String(f)} °F)`
  }
  return main
}

/**
 * Пометка источника, стоящая рядом с числом в исходной строке.
 *
 * ⚠⚠ Без неё три точки плавления серы выглядят как разнобой в данных, хотя это
 * три полиморфа. HSDB подписывает их своим синтаксисом со слэшами:
 *   `95.3 °C /(Sulfur rhombic transforms to monoclinic)/; 115.21 °C /Sulfur (monoclinic)/`
 * Парсер вытащил число и выбросил подпись — ровно то, что правило §2 запрещает.
 *
 * ⚠ Берём подпись, стоящую ПОСЛЕ нашего числа и до следующей точки с запятой:
 * в одной строке источника бывает несколько значений со своими подписями.
 * Не нашли своё число в строке (значение пересчитано из °F) — молчим.
 */
function annotationFromRaw(val: LcssValue): string | null {
  let tail: string
  if (val.v) {
    const idx = val.raw.indexOf(val.v)
    if (idx < 0) return null
    tail = val.raw.slice(idx + val.v.length).split(';')[0]
  } else {
    // Значение словами: пометка стоит в хвосте всей строки.
    tail = val.raw
  }

  // ⚠ Слэш перед пометкой обязан идти после пробела. Без этого условия дробная
  // единица «2.07 g/cu cm /Sulfur (rhombic)/» отдаёт мусор «cu cm (Sulfur (rhombic»:
  // первым слэшем оказывается тот, что внутри «g/cu cm».
  // ⚠ У значения словами скобку не трогаем: там она часть самой фразы
  // («Not Flammable (EPA, 1998)»), а не подпись формы вещества.
  const slash = /\s\/([^/]{2,80})\/(?=$|[\s;,.])/.exec(tail)
  const m = slash ?? (val.v ? /\(([^()]{2,80})\)/.exec(tail) : null)
  if (!m) return null

  // ⚠ HSDB заворачивает пометку и в скобку внутри слэшей:
  // `/(Sulfur rhombic transforms to monoclinic)/`. Снимаем обёртку целиком,
  // иначе проверка на баланс скобок выбросит хорошую подпись.
  const note = m[1]
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\((.*)\)$/, '$1')
    .trim()
  // Отсекаем то, что подписью не является.
  if (!/[a-z]{3}/i.test(note)) return null // без слова — не подпись
  if (/[()]/.test(note)) return null // скобки не сошлись, источник битый
  if (/^(at\s|\d)/i.test(note)) return null // «at 20», «25 °C» — это условие, а не форма
  if (/^(NTP|USCG|EPA|NIOSH|HSDB|CRC|ICSC)[,\s]/i.test(note)) return null // ссылка на источник
  if (/mmHg|°\s?[CF]|kPa|\bPa\b|\batm\b/i.test(note)) return null
  // ⚠ «Air = 1» повторяет единицу измерения, которую мы и так печатаем.
  if (/^(air|water)\s*=?\s*1?$/i.test(note.replace(/[=\s]+/g, ' ').trim())) return null
  return note
}

/**
 * ⚠ Навигационная заглушка PubChem, а не данные: «For more Solubility (Complete)
 * data for Maneb (6 total), please visit the HSDB record page.» Ссылка на чужой
 * сайт в колонке значения — это не значение. 15 штук на 21 830.
 */
function isNavigationStub(raw: string): boolean {
  return /please visit the (HSDB|full) record|For more .{3,40} data for .{2,60}\(\d+ total\)/i.test(raw)
}

/**
 * Условия и оговорки — то, без чего число врёт.
 * Возвращает готовую подпись или null, если сказать нечего.
 */
export function formatCondition(val: LcssValue): string | null {
  const parts: string[] = []

  if (val.q === 'range') parts.push('range, midpoint shown')
  if (val.q === 'lt') parts.push('below this value')
  if (val.q === 'gt') parts.push('above this value')
  if (val.q === 'approx') parts.push('approximate')
  if (val.q === 'decomposes') parts.push('decomposes')
  if (val.q === 'sublimes') parts.push('sublimes')

  if (val.t) parts.push(`at ${val.t} °C`)
  if (val.p) {
    // ⚠ Вакуумная точка кипения — не то же самое, что обычная. 380 таких значений.
    parts.push(val.vac === 1 ? `at ${val.p} mmHg (reduced pressure)` : `at ${val.p} mmHg`)
  } else if (val.vac === 1) {
    parts.push('under vacuum')
  }

  // Подпись источника идёт последней: она объясняет, о какой форме вещества речь.
  const note = annotationFromRaw(val)
  if (note) parts.push(note)

  return parts.length ? parts.join(', ') : null
}

export type PropertyRow = {
  key: string
  label: string
  /** Первая строка — главное значение. Остальные показываются под ней. */
  values: Array<{
    display: string
    condition: string | null
    source: string
    raw: string
    /** Значение словами, а не числом: «Sublimes», «Not flammable». Переносится по словам. */
    isText: boolean
  }>
}

/**
 * ⚠⚠ Порог, за которым строка перестаёт быть значением и становится текстом.
 *
 * У перекиси водорода в поле `lel` лежит абзац на 2 056 знаков про то, с чем
 * она взрывается. Это не нижний предел воспламенения, это рассказ. Подпись
 * «Lower explosive limit» над таким абзацем — неправда, а `white-space: nowrap`
 * в ячейке рвёт таблицу по горизонтали.
 *
 * ⚠ Но резать по признаку «нет числа» нельзя: «Sublimes» в точке кипения,
 * «Decomposes without melting» в точке плавления, «Not flammable» в точке
 * вспышки — это полноценные ответы на вопрос свойства, просто словами.
 * Разделяет их длина, а не наличие цифры. Замер по 21 830 значениям:
 * за 160 знаков уходит 293 строки у 237 веществ — ровно абзацы.
 */
export const VALUE_MAX_CHARS = 160

/**
 * Текст источника, который не поместился в таблицу.
 * ⚠ Несёт ТЕМУ, а не подпись свойства: у 69 строк из `lel` это рассказ о взрыве,
 * а не предел воспламенения. Утверждать «это LEL» мы не имеем права.
 */
export type SourceNote = { topic: string; text: string; source: string }

const NOTE_TOPIC: Record<string, string> = {
  lel: 'Fire and explosion',
  uel: 'Fire and explosion',
  autoignition: 'Fire and explosion',
  fp: 'Fire and explosion',
  bp: 'Physical behaviour',
  mp: 'Physical behaviour',
  density: 'Physical behaviour',
  vapor_pressure: 'Physical behaviour',
  vapor_density: 'Physical behaviour',
  critical_temp_pressure: 'Physical behaviour',
  solubility: 'Solubility',
  odor_threshold: 'Odor',
  corrosivity: 'Corrosivity',
}

/** Порядок тем в блоке заметок: опасность вперёд. */
const TOPIC_ORDER = ['Fire and explosion', 'Corrosivity', 'Physical behaviour', 'Solubility', 'Odor']

/** Строка вообще ни о чём: одиночный апостроф в vapor_density у 101-14-4. */
function isJunk(raw: string): boolean {
  return !/[a-z0-9]/i.test(raw)
}

/**
 * Порядок значений внутри свойства.
 * ⚠ Не «выбрать одно правильное», а «показать сначала самое применимое».
 * Выбирать одно нельзя: у серы 95,3 °C, 115,2 °C и 120 °C — это три разных
 * полиморфа, и любое единственное число было бы враньём об остальных двух.
 */
function rankValue(val: LcssValue): number {
  let score = 0
  if (!val.v) score += 100 // нечисловые строки вниз
  if (val.vac === 1) score += 50 // вакуумные ниже атмосферных
  if (val.r2 === 1) score += 10 // негосударственные ниже
  if (val.q && val.q !== 'exact') score += 5
  // Условия, близкие к комнатным, применимее прочих.
  if (val.t) {
    const t = Number(val.t)
    if (Number.isFinite(t)) score += Math.min(Math.abs(t - 22) / 10, 4)
  }
  return score
}

/**
 * Подтверждённое число свойства — то, что печатает проза (см. lcssFacts.ts).
 * Здесь оно нужно только для ПОРЯДКА: строка, согласная с подтверждённым
 * числом, встаёт первой. У кадмия иначе первой шла битая строка HSDB «32 °C»
 * при 321 °C у NIOSH и CAMEO — просто потому, что HSDB в файле первый.
 * ⚠ Тип импортируется как type: lcssFacts.ts зависит от этого файла, а не наоборот.
 */
export type FactHint = { value: number; tolerance: number }
export type FactHints = Partial<Record<string, FactHint | null>>

function agreesWithFact(val: LcssValue, hint: FactHint | null | undefined): boolean {
  if (!hint || !val.v) return false
  const n = Number(val.v)
  return Number.isFinite(n) && Math.abs(n - hint.value) <= hint.tolerance
}

/** Готовые строки таблицы свойств для одного вещества. */
export function buildPropertyRows(record: LcssRecord | undefined, facts: FactHints = {}): PropertyRow[] {
  if (!record) return []
  const rows: PropertyRow[] = []

  for (const key of PROPERTY_ORDER) {
    const raw = record[key]
    if (!raw?.length) continue

    // ⚠ Очистка — до ранжирования и до показа. Разбор: sanitizeValue.
    const clean = raw.map((v) => sanitizeValue(key, v)).filter((v): v is LcssValue => v !== null)
    const hint = facts[key]
    const sorted = [...clean].sort(
      (a, b) =>
        rankValue(a) - (agreesWithFact(a, hint) ? 20 : 0) - (rankValue(b) - (agreesWithFact(b, hint) ? 20 : 0)),
    )
    // Дубли по одинаковому показу схлопываем: три источника с «56.08 °C» — одна строка.
    const seen = new Set<string>()
    const values: PropertyRow['values'] = []
    for (const val of sorted) {
      // ⚠ Абзацы и мусор в таблицу не попадают — см. VALUE_MAX_CHARS.
      // Абзацы не пропадают: их забирает buildSourceNotes и показывает под таблицей.
      if (isJunk(val.raw) || isNavigationStub(val.raw)) continue
      if (!val.v && val.raw.length > VALUE_MAX_CHARS) continue
      const display = formatValue(val)
      const condition = formatCondition(val)
      const dedupeKey = `${display}|${condition ?? ''}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      values.push({ display, condition, source: shortSource(val.src), raw: val.raw, isText: !val.v })
    }
    if (values.length) rows.push({ key, label: PROPERTY_LABEL[key] ?? key, values })
  }

  return rows
}

/**
 * Тексты источника, не поместившиеся в таблицу значений.
 *
 * ⚠⚠ Это НЕ выбрасывание данных ради вёрстки. Ни одна строка не пропадает: то,
 * что длиннее VALUE_MAX_CHARS, переезжает сюда и показывается целиком, но под
 * темой, а не под подписью свойства. Молчание страницы про то, что вещество
 * взрывается при контакте со спиртом, человек прочтёт как «не взрывается».
 */
export function buildSourceNotes(record: LcssRecord | undefined): SourceNote[] {
  if (!record) return []
  const notes: SourceNote[] = []
  const seen = new Set<string>()

  for (const [key, arr] of Object.entries(record)) {
    const topic = NOTE_TOPIC[key]
    if (!topic || !Array.isArray(arr)) continue
    for (const rawVal of arr) {
      const val = sanitizeValue(key, rawVal)
      if (!val) continue
      if (isJunk(val.raw) || isNavigationStub(val.raw)) continue
      if (val.v || val.raw.length <= VALUE_MAX_CHARS) continue
      const text = val.raw.trim()
      if (seen.has(text)) continue
      seen.add(text)
      notes.push({ topic, text, source: shortSource(val.src) })
    }
  }

  return notes.sort((a, b) => {
    const d = TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic)
    return d !== 0 ? d : a.text.length - b.text.length
  })
}

/** Есть ли чем наполнить таблицу. Пустая секция честнее пустой таблицы с прочерками. */
export function hasProperties(record: LcssRecord | undefined): boolean {
  return buildPropertyRows(record).length > 0
}
