/**
 * Разбор типографской нотации CLP/GHS в официальных формулировках.
 *
 * У P-фраз (Annex IV) три знака, и все три без пояснения читаются как мусор
 * или как обрыв строки:
 *   …      — пропуск, который заполняет поставщик («Wash … thoroughly after handling»)
 *   [ … ]  — необязательная часть («Immerse in cool water [or wrap in wet bandages]»)
 *   /      — выбор одного из вариантов («Call a POISON CENTER/doctor/…»)
 *
 * ⚠ У H-фраз (Annex III) нотация ДРУГАЯ — угловые скобки:
 *   <state route of exposure if it is conclusively proven that no other routes
 *    of exposure cause the hazard>
 * Квадратных скобок и многоточий там не бывает, а угловые скобки в P-фразах
 * не встречаются. Поэтому режим передаётся явно, а не угадывается по тексту:
 * молчаливое угадывание однажды съест текст, в котором знак стоит законно.
 *
 * Функция возвращает куски текста с пометкой, чтобы страница могла отрисовать
 * знаки визуально отдельно. ⚠ Возвращаем массив, а не HTML-строку: разметка
 * собирается на стороне шаблона, никакого set:html с данными из базы.
 */

export type ClpPiece = {
  /** text — обычный текст · blank — пропуск («…» у P, «<…>» у H) · opt — часть в квадратных скобках */
  kind: 'text' | 'blank' | 'opt'
  value: string
}

/** 'p' — Annex IV: многоточие и квадратные скобки · 'h' — Annex III: угловые скобки. */
export type ClpMode = 'p' | 'h'

const OPT = /\[[^\]]*\]/g
const BLANK = /…/g
const ANGLE = /<[^>]*>/g

/** Общий проход: всё, что попало под регулярку, становится куском заданного вида. */
function splitBy(s: string, re: RegExp, kind: ClpPiece['kind']): ClpPiece[] {
  const out: ClpPiece[] = []
  let last = 0
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: s.slice(last, m.index) })
    out.push({ kind, value: m[0] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ kind: 'text', value: s.slice(last) })
  return out
}

export function splitClpNotation(input: string, mode: ClpMode = 'p'): ClpPiece[] {
  const s = input ?? ''
  if (mode === 'h') {
    const out = splitBy(s, ANGLE, 'blank')
    return out.length ? out : [{ kind: 'text', value: s }]
  }

  // P-режим: сначала квадратные скобки, внутри остатка — многоточия.
  const out: ClpPiece[] = []
  let last = 0
  OPT.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = OPT.exec(s)) !== null) {
    if (m.index > last) out.push(...splitBy(s.slice(last, m.index), BLANK, 'blank'))
    out.push({ kind: 'opt', value: m[0] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push(...splitBy(s.slice(last), BLANK, 'blank'))
  return out.length ? out : [{ kind: 'text', value: s }]
}

/** Есть ли в формулировке хоть один знак нотации — нужно, чтобы не печатать легенду зря. */
export function hasClpNotation(input: string, mode: ClpMode = 'p'): boolean {
  const s = input ?? ''
  return mode === 'h' ? /<[^>]*>/.test(s) : /…|\[[^\]]*\]/.test(s)
}
