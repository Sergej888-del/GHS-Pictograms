/**
 * Блок «частые вопросы» на странице вещества.
 *
 * ⚠⚠ КАЖДЫЙ ответ собирается из СВОИХ данных: CAS, формула, масса, коды
 * Annex VI, число из LCSS. Ни один вопрос не отвечается общими словами. Если
 * факта нет — вопроса нет. Это то же правило, что и у прозы (substanceIntro.ts):
 * пустая секция честнее выдуманного текста.
 *
 * ⚠⚠⚠ ОТСУТСТВИЕ КОДА — НЕ ДОКАЗАТЕЛЬСТВО БЕЗОПАСНОСТИ. Соблазн ответить
 * «No, acetone is not a carcinogen» огромен, и это была бы ложь: Annex VI —
 * список гармонизированных классификаций, а не список всех проверенных
 * веществ. Формулировка везде одна: «в CLP Annex VI такой классификации нет»,
 * а не «вещество не опасно». В блоке про безопасность цена ошибки другая, чем
 * в блоке про молекулярную массу.
 *
 * ⚠ Ответ — ПРОСТОЙ ТЕКСТ без разметки: он уходит и в JSON-LD (FAQPage), и в
 * тело страницы. Один источник на два места — иначе они разъезжаются, и
 * разметка начинает обещать поиску не то, что видит человек.
 */
import { factSources, formatFact, formatFactF, type ConsensusFact, type Facts } from './lcssFacts.ts'

export type FaqItem = { q: string; a: string }

export type FaqInput = {
  name: string
  cas: string
  ec: string | null
  formula: string | null
  weight: number | null
  signalWord: string | null
  hCodes: string[]
  /** код → формулировка. Нужна, чтобы ответ был фразой, а не набором кодов. */
  hText: Record<string, string>
  pictogramNames: string[]
  /**
   * Подтверждённые числа LCSS (lcssFacts.ts). ⚠⚠ До session 86 FAQ брал первую
   * строку таблицы — у кадмия это была битая «32.07 °C (HSDB)», и она уезжала в
   * JSON-LD как ответ на «What is the melting point of Cadmium?». Теперь в ответ
   * идёт только число, на котором сходятся ≥ 2 источника; иначе вопроса нет.
   */
  facts: Facts
  /** Текст «Storage conditions» из LCSS, если он есть. */
  storageText: { t: string; s: string } | undefined
  /** Коды раздела Storage из Annex VI, если они есть. */
  storageCodes: string[]
  /** Группа IARC, если вещество в ней есть: { group: 'Group 1', label: '…' }. */
  iarc: { group: string; label: string } | undefined
  /** Первый предел воздействия PEL со своим источником. */
  pel: { t: string; s: string } | undefined
}

/** Коды воспламеняемости во всех агрегатных состояниях. */
const FLAMMABLE = new Set([
  'H220', 'H221', 'H222', 'H223', 'H224', 'H225', 'H226', 'H227', 'H228',
  'H230', 'H231', 'H232', 'H241', 'H242', 'H250', 'H251', 'H252', 'H260', 'H261',
])

const CARC_PROVEN = new Set(['H350', 'H350i'])
const CARC_SUSPECT = new Set(['H351'])

/** Перечисление через запятую с «and» перед последним. */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * Фраза кода без плейсхолдера регламента.
 * ⚠ H350 в базе хранится вместе с угловой скобкой: «May cause cancer <state
 * route of exposure…>». Скобка — инструкция составителю этикетки, а не часть
 * ответа; в FAQ она читается как брак данных.
 */
function statement(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;])/g, '$1')
    .trim()
    .replace(/\.$/, '')
}

/**
 * Число с °F и с теми, кто его подтверждает: «321 °C (610 °F), a figure on
 * which NIOSH and CAMEO agree». Источники названы в самом ответе — ответ
 * уходит в JSON-LD один, без таблицы рядом.
 */
function factPhrase(fact: ConsensusFact | null): string | null {
  if (!fact) return null
  const f = formatFactF(fact)
  return `${formatFact(fact)}${f ? ` (${f})` : ''}, a figure on which ${factSources(fact)} agree`
}

export function buildFaq(input: FaqInput): FaqItem[] {
  const { name, cas } = input
  const items: FaqItem[] = []

  // ── 1. Идентификаторы. Единственный вопрос, который есть у всех 3 650. ──
  items.push({
    q: `What is the CAS number of ${name}?`,
    a: input.ec
      ? `The CAS number of ${name} is ${cas}. Its EC number is ${input.ec}.`
      : `The CAS number of ${name} is ${cas}.`,
  })

  if (input.formula) {
    items.push({
      q: `What is the chemical formula of ${name}?`,
      a: input.weight
        ? `The molecular formula of ${name} is ${input.formula} and its molecular weight is ${input.weight} g/mol.`
        : `The molecular formula of ${name} is ${input.formula}.`,
    })
  }

  if (input.weight && !input.formula) {
    items.push({
      q: `What is the molecular weight of ${name}?`,
      a: `The molecular weight of ${name} is ${input.weight} g/mol.`,
    })
  }

  // ── 2. Этикетка ──
  if (input.pictogramNames.length || input.signalWord) {
    const parts: string[] = []
    if (input.pictogramNames.length) {
      parts.push(
        `Under CLP Annex VI the label for ${name} carries ${input.pictogramNames.length === 1 ? 'the pictogram' : 'the pictograms'} ${list(input.pictogramNames)}`,
      )
    }
    if (input.signalWord) {
      parts.push(
        parts.length
          ? `the signal word is ${input.signalWord}`
          : `Under CLP Annex VI the signal word for ${name} is ${input.signalWord}`,
      )
    }
    items.push({ q: `What does a ${name} label have to show?`, a: `${parts.join(' and ')}.` })
  }

  // ── 3. Воспламеняемость ──
  const flam = input.hCodes.filter((c) => FLAMMABLE.has(c))
  const fp = factPhrase(input.facts.fp)
  if (flam.length) {
    const phrase = statement(input.hText[flam[0]] ?? '')
    items.push({
      q: `Is ${name} flammable?`,
      a:
        `Yes. CLP Annex VI assigns ${name} ${list(flam)}` +
        (phrase ? ` — ${phrase.toLowerCase()}.` : '.') +
        (fp ? ` Its flash point is ${fp}.` : ''),
    })
  } else {
    items.push({
      q: `Is ${name} flammable?`,
      a:
        `CLP Annex VI assigns ${name} no flammability hazard class. ` +
        `That is not a statement that it cannot burn: the harmonised list only records the hazards that were assessed for it.` +
        (fp ? ` Its flash point is ${fp}.` : ''),
    })
  }

  // ── 4. Канцерогенность ──
  // ⚠ Два независимых ответа на один вопрос: CLP Annex VI (право ЕС) и IARC
  // (научная оценка ВОЗ). Они не обязаны совпадать и часто не совпадают, поэтому
  // приводятся оба, а не выбирается «правильный».
  const proven = input.hCodes.filter((c) => CARC_PROVEN.has(c))
  const suspect = input.hCodes.filter((c) => CARC_SUSPECT.has(c))
  const iarcTail = input.iarc
    ? ` IARC places it in ${input.iarc.group}: ${input.iarc.label.toLowerCase()}.`
    : ''
  if (proven.length) {
    items.push({
      q: `Is ${name} a carcinogen?`,
      a:
        `Yes. CLP Annex VI classifies ${name} as a category 1A or 1B carcinogen and assigns it ` +
        `${list(proven)}: ${statement(input.hText[proven[0]] ?? 'may cause cancer').toLowerCase()}.` +
        iarcTail,
    })
  } else if (suspect.length) {
    items.push({
      q: `Is ${name} a carcinogen?`,
      a:
        `CLP Annex VI assigns ${name} H351 — suspected of causing cancer. That is category 2: ` +
        `the evidence points that way but is not conclusive.` + iarcTail,
    })
  } else {
    items.push({
      q: `Is ${name} a carcinogen?`,
      a:
        `CLP Annex VI records no harmonised carcinogenicity classification for ${name}. ` +
        `Annex VI is a list of agreed classifications, not a list of substances found safe, so this is an absence of a classification rather than a clean bill of health.` +
        iarcTail,
    })
  }

  // ── 4b. Предел воздействия ──
  // ⚠ Предел американский, и это сказано в ответе. В ЕС свои значения (IOELV,
  // директива 98/24/EC), у нас их нет — молчаливая подмена одного другим была бы
  // ошибкой того же рода, что «CAS не различает форму вещества».
  if (input.pel) {
    items.push({
      q: `What is the exposure limit for ${name}?`,
      a:
        `The US occupational exposure limit reported for ${name} is ${input.pel.t.replace(/\s+/g, ' ').trim()} ` +
        `(${input.pel.s}). Limits differ by country: the EU sets its own indicative and binding values, and the ` +
        `figure that applies at a given workplace is the one in the local regulation.`,
    })
  }

  // ── 5. Числа, за которыми чаще всего и приходят ──
  // ⚠ Только подтверждённые числа. Один источник — вопроса нет, число остаётся
  // в таблице свойств с условиями и подписью. Три полиморфа серы — тоже нет.
  const bp = factPhrase(input.facts.bp)
  if (bp) items.push({ q: `What is the boiling point of ${name}?`, a: `The boiling point of ${name} is ${bp}.` })

  const mp = factPhrase(input.facts.mp)
  if (mp) items.push({ q: `What is the melting point of ${name}?`, a: `The melting point of ${name} is ${mp}.` })

  // ── 6. Хранение ──
  if (input.storageCodes.length || input.storageText) {
    const parts: string[] = []
    if (input.storageCodes.length) {
      parts.push(`CLP Annex VI assigns ${name} the storage statement${input.storageCodes.length > 1 ? 's' : ''} ${list(input.storageCodes)}.`)
    }
    if (input.storageText) {
      // ⚠ Чужой текст — единственное место в FAQ, где он есть, поэтому подпись
      // источника стоит прямо в ответе, а не под блоком.
      parts.push(`${input.storageText.t.replace(/\s+/g, ' ').trim()} (${input.storageText.s})`)
    }
    items.push({ q: `How should ${name} be stored?`, a: parts.join(' ') })
  }

  return items
}
