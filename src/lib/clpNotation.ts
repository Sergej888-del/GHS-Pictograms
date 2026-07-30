/**
 * Разбор типографской нотации CLP/GHS в официальных формулировках.
 *
 * В тексте регламента три знака, и все три без пояснения читаются как мусор
 * или как обрыв строки:
 *   …      — пропуск, который заполняет поставщик («Wash … thoroughly after handling»)
 *   [ … ]  — необязательная часть («Immerse in cool water [or wrap in wet bandages]»)
 *   /      — выбор одного из вариантов («Call a POISON CENTER/doctor/…»)
 *
 * Функция возвращает куски текста с пометкой, чтобы страница могла отрисовать
 * знаки визуально отдельно. ⚠ Возвращаем массив, а не HTML-строку: разметка
 * собирается на стороне шаблона, никакого set:html с данными из базы.
 */

export type ClpPiece = {
  /** text — обычный текст · blank — пропуск «…» · opt — часть в квадратных скобках */
  kind: 'text' | 'blank' | 'opt'
  value: string
}

const OPT = /\[[^\]]*\]/g
const BLANK = /…/g

/** Внутри куска без скобок выделяем многоточия. */
function splitBlanks(s: string): ClpPiece[] {
  const out: ClpPiece[] = []
  let last = 0
  BLANK.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = BLANK.exec(s)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: s.slice(last, m.index) })
    out.push({ kind: 'blank', value: m[0] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ kind: 'text', value: s.slice(last) })
  return out
}

export function splitClpNotation(input: string): ClpPiece[] {
  const s = input ?? ''
  const out: ClpPiece[] = []
  let last = 0
  OPT.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = OPT.exec(s)) !== null) {
    if (m.index > last) out.push(...splitBlanks(s.slice(last, m.index)))
    out.push({ kind: 'opt', value: m[0] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(...splitBlanks(s.slice(last)))
  return out.length ? out : [{ kind: 'text', value: s }]
}

/** Есть ли в формулировке хоть один знак нотации — нужно, чтобы не печатать легенду зря. */
export function hasClpNotation(input: string): boolean {
  return /…|\[[^\]]*\]/.test(input ?? '')
}
