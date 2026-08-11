/**
 * Движок отбора P-фраз как React-хук: одна точка входа для конструктора
 * этикетки и для отдельной страницы инструмента.
 *
 * ⚠⚠ ХУК НИЧЕГО НЕ РЕШАЕТ САМ. Он грузит снимок, зовёт `selectPStatements` и
 * отдаёт результат как есть. Вся регламентная логика живёт в `pPrecedence.ts`
 * и обязана остаться там: два места, решающих одно и то же, — это ровно та
 * болезнь, которую session 65 лечила у Table 1.3 (там сравнений размера было
 * четыре, и все разные).
 *
 * ⚠ Отказ загрузки ВОЗВРАЩАЕТСЯ, а не глотается. Инструмент, который молча
 * откатился к «первым шести фразам», врёт о своём основании — а именно от
 * этого движок и заводился.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { selectPStatements, type PrecedenceInput, type PrecedenceResult } from './pPrecedence'
import { loadPrecedenceData, type PrecedenceBundle } from './pPrecedenceData'

export type PrecedenceState = {
  /** Результат отбора. `null`, пока данные не пришли или отбирать нечего. */
  result: PrecedenceResult | null
  loading: boolean
  /** Текст отказа. ⚠ Показывать человеку, а не прятать в консоль. */
  error: string | null
  counts: Record<string, number> | null
  /** Классификации нет — движку нечего отбирать. Это не отказ. */
  idle: boolean
}

/**
 * @param input   вход движка; `null` — классификации пока нет
 * @param enabled грузить ли снимок вообще. ⚠ На пустом конструкторе — `false`:
 *                215 КБ данных тому, кто ещё ничего не выбрал, не нужны.
 */
export function usePPrecedence(input: PrecedenceInput | null, enabled = true): PrecedenceState {
  const [bundle, setBundle] = useState<PrecedenceBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const asked = useRef(false)

  useEffect(() => {
    if (!enabled || !input || bundle || asked.current) return
    asked.current = true
    setLoading(true)
    loadPrecedenceData()
      .then((b) => { setBundle(b); setError(null) })
      .catch((e: unknown) => {
        // ⚠ Повторить можно: `loadPrecedenceData` сбрасывает свою память при отказе.
        asked.current = false
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setLoading(false))
  }, [enabled, input !== null, bundle])

  /**
   * ⚠⚠ КЛЮЧ ПЕРЕСЧЁТА — СОДЕРЖИМОЕ ВХОДА, А НЕ ССЫЛКА НА ОБЪЕКТ. Вызывающий
   * собирает `input` литералом внутри рендера, и по ссылке он новый на каждом
   * кадре: отбор пересчитывался бы 60 раз в секунду вместе с любым вводом в
   * поле имени продукта.
   */
  const key = input
    ? JSON.stringify([
        input.pairs, input.hCodes, input.signalWord, input.audience,
        input.suppliedCodes, input.containerMl, input.fitCapacity, input.statutoryLimit,
      ])
    : ''

  const result = useMemo(() => {
    if (!bundle || !input) return null
    const hasClassification = (input.pairs?.length ?? 0) > 0 || (input.hCodes?.length ?? 0) > 0
    if (!hasClassification) return null
    return selectPStatements(input, bundle.data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, key])

  return {
    result,
    loading,
    error,
    counts: bundle?.counts ?? null,
    idle: !input || (!(input.pairs?.length) && !(input.hCodes?.length)),
  }
}
