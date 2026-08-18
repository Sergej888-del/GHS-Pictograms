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
import type { FitMeasurement } from './labelFitProbe'

/**
 * ⭐⭐ ЗАМЕР ВЛЕЗАЕМОСТИ, КОТОРЫЙ ПОДАЁТ ВЫЗЫВАЮЩИЙ.
 *
 * ⚠⚠ ПОЧЕМУ ФУНКЦИЕЙ, А НЕ ЧИСЛОМ. Число «сколько влезает» зависит от того,
 * КАКИЕ фразы мерить, а порядок фраз знает только отбор — то есть этот хук.
 * Передай вызывающий готовое число, ему пришлось бы сперва самому повторить
 * ранжирование, и два ранжирования разошлись бы в первый же месяц.
 *
 * ⚠ Сам замер живёт в `labelFitProbe.ts`: у вызывающего есть полный `LabelInput`
 * и размер этикетки, у движка отбора — нет и быть не должно.
 */
export type FitProbe = {
  /** Померить, сколько из этих фраз (в этом порядке) влезает. */
  measure: (codes: string[]) => FitMeasurement
  /**
   * ⚠⚠ КЛЮЧ ПЕРЕСЧЁТА — ОБЯЗАТЕЛЕН. Замер стоит десятков раскладок (~100 мс на
   * двуязычной этикетке), а `measure` вызывающий собирает литералом внутри
   * рендера. Без ключа он пересчитывался бы на каждый нажатый в поле имени
   * символ. В ключ входит всё, от чего замер зависит: размер, языки, кегль,
   * пиктограммы, длина имени.
   */
  key: string
}

export type PrecedenceState = {
  /** Результат отбора. `null`, пока данные не пришли или отбирать нечего. */
  result: PrecedenceResult | null
  loading: boolean
  /** Текст отказа. ⚠ Показывать человеку, а не прятать в консоль. */
  error: string | null
  counts: Record<string, number> | null
  /** Классификации нет — движку нечего отбирать. Это не отказ. */
  idle: boolean
  /**
   * Что показал замер. `null` — замер не заказывали: на странице инструмента
   * этикетки нет вовсе, и мерить нечего.
   */
  fit: FitMeasurement | null
}

/**
 * ⭐ ДОКУДА ВООБЩЕ ПРОБОВАТЬ.
 *
 * ⚠⚠ Мерить весь список кандидатов незачем и дорого. Отбор всё равно зажат
 * потолком ст. 28(3), поэтому важен ровно один вопрос: вместимость МЕНЬШЕ
 * потолка или нет. Двух фраз сверху хватает, чтобы отличить «впритык» от
 * «с запасом», и это вдвое сокращает число раскладок.
 *
 * ⚠ Следствие для интерфейса: вместимость, упершаяся в этот потолок, означает
 * «столько и больше», а не «ровно столько». Подписывать надо так же.
 */
const PROBE_HEADROOM = 2

/**
 * @param input   вход движка; `null` — классификации пока нет
 * @param enabled грузить ли снимок вообще. ⚠ На пустом конструкторе — `false`:
 *                215 КБ данных тому, кто ещё ничего не выбрал, не нужны.
 * @param fit     замер влезаемости. ⚠ Без него лимит задаёт только ст. 28(3),
 *                и `limitReason` говорит об этом прямо, а не делает вид, что
 *                размер учтён.
 */
export function usePPrecedence(
  input: PrecedenceInput | null,
  enabled = true,
  fit?: FitProbe,
): PrecedenceState {
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

  const computed = useMemo<{ result: PrecedenceResult | null; fit: FitMeasurement | null }>(() => {
    if (!bundle || !input) return { result: null, fit: null }
    const hasClassification = (input.pairs?.length ?? 0) > 0 || (input.hCodes?.length ?? 0) > 0
    if (!hasClassification) return { result: null, fit: null }
    if (!fit) return { result: selectPStatements(input, bundle.data), fit: null }

    /**
     * ⛔⛔ ДВА ПРОХОДА, И ПОРЯДОК ОБРАТЕН ИНТУИТИВНОМУ.
     *
     * Сперва отбор БЕЗ ЛИМИТА — он даёт фразы в порядке важности. Потом замер
     * по этому порядку: резать будут хвост, значит и пробовать надо, наращивая
     * с головы. И только потом отбор ещё раз, уже с числом.
     *
     * ⚠ Померить сперва, а отобрать потом нельзя: до отбора неизвестно, КАКИЕ
     * фразы мерить, а вместимость зависит от их длины — шесть болгарских
     * аварийных фраз и шесть коротких складских занимают разное место.
     */
    const statutory = input.statutoryLimit ?? 6
    const unlimited = selectPStatements(
      { ...input, fitCapacity: undefined, statutoryLimit: 99 },
      bundle.data,
    )
    const ordered = unlimited.selected.map((u) => u.code)
    const measurement = fit.measure(
      ordered.slice(0, Math.min(ordered.length, statutory + PROBE_HEADROOM)),
    )

    return {
      result: selectPStatements({ ...input, fitCapacity: measurement.capacity }, bundle.data),
      fit: measurement,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, key, fit?.key])

  return {
    result: computed.result,
    loading,
    error,
    counts: bundle?.counts ?? null,
    idle: !input || (!(input.pairs?.length) && !(input.hCodes?.length)),
    fit: computed.fit,
  }
}
