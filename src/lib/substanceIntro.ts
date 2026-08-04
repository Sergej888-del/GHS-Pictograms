/**
 * Проза страницы вещества: шаблон + факты (решение Сергея, session 35).
 *
 * ⚠ Не цитируем чужой текст целиком и не выдумываем. Берём короткие факты —
 * цвет, запах, класс, числа — и складываем СВОЮ фразу. Факты у 3 650 веществ
 * разные, поэтому текст получается разный, а не 3 650 копий одного абзаца.
 *
 * ⚠ ИМЯ ВЕЩЕСТВА — ПЕРВОЕ СЛОВО ПЕРВОГО ПРЕДЛОЖЕНИЯ (просьба Сергея).
 * Так страница отвечает на «what is acetone» в том виде, в каком Google берёт
 * ответ в блок с выдержкой.
 *
 * ⚠ Пустая секция честнее чужого текста: если фактов нет, абзац не выводится
 * вовсе, а не заполняется водой.
 */
import type { LcssRecord } from './lcssProperties'

export type TextFact = { t: string; s: string }
export type TextRecord = Partial<
  Record<
    'color' | 'odor' | 'phys' | 'classes' | 'taste' | 'storage' | 'incompat' | 'airwater' |
    'reactivity' | 'decomp' | 'stability' | 'fire' | 'physdanger' | 'chemdanger' | 'peroxide' | 'corrosivity',
    TextFact
  >
>

export type IntroInput = {
  name: string
  formula: string | null
  weight: number | null
  signal: string | null
  texts: TextRecord | undefined
  lcss: LcssRecord | undefined
}

export type Intro = {
  /** Одно предложение для подзаголовка героя. */
  lead: string
  /** Готовый HTML абзацев для тела страницы. */
  paragraphs: string
  /** Одно предложение для meta description и JSON-LD. */
  metaSentence: string
}

const VOWELS = /^[aeiou]/i
const article = (word: string) => (VOWELS.test(word.trim()) ? 'an' : 'a')

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * ⚠ Служебная разметка источников в прозе читается как брак.
 * HSDB заключает уточнение в слэши, NIOSH — в «[Note: …]»:
 *   «Yellow orthorhombic crystals /Sulfur (rhombic) (alpha)/»
 *   «Nearly colorless gas [Note: Often used in an aqueous solution].»
 * В таблице такая пометка уезжает в колонку условий, а во фразе она лишняя.
 */
function stripSourceMarkup(s: string): string {
  return s
    .replace(/\s*\/[^/]{2,120}\/\s*/g, ' ') // /Sulfur (rhombic) (alpha)/
    .replace(/\s*\[Note:[^\]]*\]\s*/gi, ' ') // [Note: Often used in an aqueous solution]
    .replace(/\.\.\.+/g, ' ') // многоточие пропуска в цитате HSDB
    .replace(/\s+/g, ' ')
    .replace(/\s+([;,.])/g, '$1')
    .replace(/^[\s.,;:/-]+/, '')
    .trim()
}

/**
 * Фрагмент источника к виду, пригодному для середины своей фразы.
 * ⚠ Порядок важен: сначала снять разметку, потом взять первое предложение,
 * и только потом опускать регистр — иначе «(tech.)» обрывает предложение
 * в неожиданном месте, а КАПС остаётся КАПСОМ.
 */
function lower(fragment: string, maxLen = 110): string {
  let t = stripSourceMarkup(fragment)
  if (!t) return ''

  // Первое предложение: у 34681-10-2 внешний вид — это два предложения подряд.
  const sent = /^(.{10,}?[.!?])(\s|$)/.exec(t)
  if (sent) t = sent[1]
  t = t.replace(/[.;:,]+$/, '').trim()

  // ⚠ «COLORLESS LIQUID with a NAUSEATING ODOR» у NIOSH написано капсом целиком.
  // Аббревиатуру от крика отличаем по наличию пробела: «DDT» трогать нельзя.
  if (t.length > 4 && t === t.toUpperCase() && /\s/.test(t)) t = t.toLowerCase()

  // Длинный хвост режем по запятой: «…odor, discernable at 0.5 to 5 ppm» в лид не нужен.
  if (t.length > maxLen) {
    const cut = t.slice(0, maxLen)
    const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '))
    t = (at > maxLen * 0.4 ? cut.slice(0, at) : cut.replace(/\s+\S*$/, '')).trim()
  }
  if (!t) return ''

  // Аббревиатуры и формулы не трогаем: «DDT», «pH», «UV».
  const first = t.split(/\s+/)[0]
  if (first.length > 1 && first === first.toUpperCase()) return t
  return t.charAt(0).toLowerCase() + t.slice(1)
}

/**
 * ⚠ Артикль ставим только там, где он не спорит с числом.
 * «a yellow orthorhombic crystals» — так выходило у серы: описания внешнего вида
 * у источников сплошь во множественном («crystals», «needles», «leaflets»).
 *
 * ⚠ Существительное ищем в ГЛАВНОЙ части фрагмента, до первого уточнения.
 * «monoclinic needles (crystalized from alcohol and toluene)» — если смотреть на
 * последнее слово, получится «toluene», и артикль вернётся.
 */
const SINGULAR_IN_S = /^(gas|glass|mass|grass|molasses|phosphorus|asbestos)$/i
/** Формы вещества, которые источники называют только во множественном числе. */
const FORM_PLURAL =
  /\b(crystals|needles|plates|flakes|granules|prisms|leaflets|pieces|scales|rods|lumps|pellets|chips|shavings|fib(?:re|er)s|beads|globules|droplets|grains|nodules)\b/i

/**
 * ⚠ Источник иногда даёт не описание вида, а целое предложение с глаголом:
 * «Exists in three main allotropic forms: white, black, red». Подстановка в
 * шаблон `<имя> is <фрагмент>` давала «Phosphorus is an exists in three main…».
 * Такой фрагмент вставляем БЕЗ связки и без артикля: «Phosphorus exists in…».
 */
const LEADING_VERB =
  /^(exists?|occurs?|appears?|forms?|consists?|comes?|varies|ranges?|sublimes?|decomposes?|turns?|becomes?|burns?|melts?|boils?|reacts?|dissolves?)\b/i
function startsWithVerb(fragment: string): boolean {
  return LEADING_VERB.test(fragment.trim())
}

function withArticle(fragment: string): string {
  // ⚠ Источник нередко уже начинает с артикля: «a faintly colored, viscous liquid».
  // Второй артикль давал «an a faintly colored…».
  if (/^(a|an|the)\s/i.test(fragment)) return fragment

  // Главная часть — до придаточного: «… or powder WITH a camphor-like odor».
  const main = fragment.split(/\s+(?:with|having|which|that|when|turning)\s+/i)[0]
  // Достаточно одного множественного в главной части: «white cubic crystals or powder».
  if (FORM_PLURAL.test(main)) return fragment

  const head = main.split(/\s*[(,;]/)[0].trim().split(/\s+/).pop() ?? ''
  const plural = /[a-z]s$/i.test(head) && !SINGULAR_IN_S.test(head)
  return plural ? fragment : `${article(fragment)} ${fragment}`
}

/** Первое предложение длинного описания — остальное для интро избыточно. */
function firstSentence(text: string): string {
  const t = stripSourceMarkup(text)
  const m = /^(.{20,220}?[.!?])(\s|$)/.exec(t)
  return (m ? m[1] : t.slice(0, 220)).trim()
}

/** Лучшее числовое значение свойства с единицей — для фразы, не для таблицы. */
function bestNumber(lcss: LcssRecord | undefined, key: string): string | null {
  const vals = lcss?.[key]
  if (!vals?.length) return null
  // Атмосферные и государственные вперёд: вакуумная точка кипения в прозе соврёт.
  const pick =
    vals.find((v) => v.v && v.vac !== 1 && v.r2 !== 1) ?? vals.find((v) => v.v && v.vac !== 1)
  if (!pick?.v) return null
  const num = Number(pick.v)
  if (!Number.isFinite(num)) return null
  const rounded = Math.abs(num) >= 100 ? Math.round(num) : Math.round(num * 10) / 10
  const unit = pick.u === 'C' ? '°C' : pick.u === 'g/cm3' ? 'g/cm³' : pick.u === 'mmHg' ? 'mmHg' : ''
  return unit ? `${rounded} ${unit}` : String(rounded)
}

/** Растворимость словами, если источник выразился коротко: «Miscible with water». */
function solubilityPhrase(lcss: LcssRecord | undefined): string | null {
  const vals = lcss?.solubility
  if (!vals?.length) return null
  const short = vals.find((v) => v.raw.length <= 60 && /water|miscible|soluble/i.test(v.raw))
  if (!short) return null
  const t = short.raw.trim().replace(/\.$/, '')
  if (/^miscible/i.test(t)) return 'miscible with water'
  if (/^insoluble/i.test(t)) return 'practically insoluble in water'
  if (/^very soluble/i.test(t)) return 'very soluble in water'
  if (/^slightly soluble/i.test(t)) return 'slightly soluble in water'
  if (/^soluble/i.test(t)) return 'soluble in water'
  return null
}

export function buildIntro(input: IntroInput): Intro {
  const { name, formula, weight, signal, texts, lcss } = input

  // ——— Предложение 1: что это такое. Имя первым словом. ———
  const appearance = texts?.color ? lower(texts.color.t, 92) : null
  const odor = texts?.odor ? lower(texts.odor.t, 80) : null

  // ⚠ Связка «is» уместна только перед описанием вида. Перед готовым сказуемым
  // («exists in three main allotropic forms») она даёт «is an exists».
  const predicate = Boolean(appearance && startsWithVerb(appearance))
  const beVerb = predicate ? '' : ' is'
  const appearancePart = appearance && (predicate ? appearance : withArticle(appearance))

  // ⚠ Источник часто даёт запах одним прилагательным: «Garlic-like», «Pungent».
  // Без существительного выходило «with a garlic-like» — фраза обрывается.
  const odorPhrase = odor && (/\bodou?r|\bsmell/i.test(odor) ? odor : `${odor} odor`)

  let lead: string
  if (appearance && odor && !/odorless/i.test(odor)) {
    // ⚠ После готового сказуемого запах идёт ОТДЕЛЬНЫМ предложением: приклеить
    // «with a garlic-like odor» к «exists in three allotropic forms» нельзя —
    // получится, что запах у форм, а не у вещества.
    lead = predicate
      ? `${name} ${appearancePart}. It has ${withArticle(odorPhrase!)}.`
      : `${name} is ${appearancePart} with ${withArticle(odorPhrase!)}.`
  } else if (appearance && odor) {
    lead = predicate
      ? `${name} ${appearancePart}. It is odorless.`
      : `${name} is ${appearancePart} and is odorless.`
  } else if (appearance) {
    lead = `${name}${beVerb} ${appearancePart}.`
  } else if (odor && !/odorless/i.test(odor)) {
    lead = `${name} has ${withArticle(odorPhrase!)}.`
  } else if (texts?.phys) {
    // Описание PubChem уже начинается с имени вещества — берём как есть.
    // ⚠⚠ Сравниваем строками, а НЕ регулярным выражением. Имя вещества — не шаблон:
    // `new RegExp('^' + 'bis(2-ethylh')` падает с «Unterminated group» и валит всю
    // сборку. Скобки в имени по Annex VI — норма, а не исключение: из 246 веществ,
    // доходящих до этой ветки, 54 роняли сборку. Проверено, session 36.
    const s = firstSentence(texts.phys.t)
    const head = name.slice(0, 12).toLowerCase()
    lead = s.toLowerCase().startsWith(head) ? s : `${name}: ${lower(s)}.`
  } else if (formula) {
    lead = `${name} is a chemical substance with the molecular formula ${formula}.`
  } else {
    lead = `${name} is a substance with a harmonised classification under EU CLP.`
  }

  // ——— Предложение 2: идентификация. ———
  // ⚠ Глагол обязателен. Без него выходило «Its molecular formula C3H6O and its
  // molecular weight 58.08 g/mol.» — предложение без сказуемого на 3 653 страницах.
  const idBits: string[] = []
  if (formula) idBits.push(`molecular formula is ${formula}`)
  if (weight) idBits.push(`molecular weight is ${weight} g/mol`)
  const idSentence = idBits.length
    ? `Its ${idBits.join(' and its ')}.`
    : ''

  // ——— Предложение 3: чем опасно. ———
  const hazardSentence = signal
    ? `Under the GHS it carries the signal word ${signal}.`
    : ''

  // ——— Предложение 4: физхим одной строкой. ———
  const bp = bestNumber(lcss, 'bp')
  const mp = bestNumber(lcss, 'mp')
  const solubility = solubilityPhrase(lcss)
  const physBits: string[] = []
  if (bp) physBits.push(`boils at ${bp}`)
  if (mp) physBits.push(`melts at ${mp}`)
  if (solubility) physBits.push(`is ${solubility}`)
  const physSentence = physBits.length
    ? `It ${physBits.join(', ')}.`
    : ''

  // ——— Абзац про класс вещества. ———
  const classSentence =
    texts?.classes && texts.classes.t.length <= 90
      ? `It is classed as ${lower(texts.classes.t)}.`
      : ''

  const p1 = [lead, idSentence, physSentence].filter(Boolean).join(' ')
  const p2 = [hazardSentence, classSentence].filter(Boolean).join(' ')

  const paragraphs = [p1, p2]
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('\n')

  // Для meta description: самое информативное в пределах одного-двух предложений.
  const metaSentence = [lead, physSentence || idSentence].filter(Boolean).join(' ')

  return { lead, paragraphs, metaSentence }
}
