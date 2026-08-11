/**
 * Загрузка снимка данных движка отбора P-фраз.
 *
 * Читает `/data/p-precedence.json` — файл, который собирает на сборке
 * `src/pages/data/p-precedence.json.ts`, — и разворачивает его в
 * `PrecedenceData` для `pPrecedence.ts`.
 *
 * ⭐⭐ ПОЧЕМУ ФАЙЛ, А НЕ ЧЕТЫРЕ ЗАПРОСА В SUPABASE — расписано в шапке
 * `src/pages/data/p-precedence.json.ts`. Коротко: движку нужны ВСЕ строки до
 * первого ответа, неполные данные дают не медленный ответ, а неверный, а
 * Cloudflare кэширует статику и не кэширует Supabase.
 *
 * ⚠⚠ И ПОЧЕМУ `fetch`, А НЕ `import … from '…json'`. Импорт запёк бы 215 КБ
 * матрицы В БАНДЛ ОСТРОВА — то есть в тот код, который грузится, чтобы
 * показать пустой конструктор. Данные нужны позже (после того как появилась
 * классификация) и не нужны вовсе тому, кто просто открыл страницу. Отдельный
 * файл грузится по требованию и кэшируется у Cloudflare сам по себе.
 */
import type { PrecedenceData } from './pPrecedence'

/**
 * Адрес снимка. ⚠ Задаётся файлом `src/pages/data/p-precedence.json.ts`.
 *
 * ⚠⚠ `?v=` — НЕ УКРАШЕНИЕ. Снимок отдаётся с `max-age=86400`, а ниже он
 * читается с `cache: 'force-cache'`: у вернувшегося посетителя сутки лежит
 * СТАРЫЙ файл. В session 66 в снимок добавилось поле `gradedCodes`, без
 * которого движок отказывается работать, — и без смены адреса такой посетитель
 * увидел бы сломанный инструмент до конца суток. Метку менять при КАЖДОМ
 * изменении состава снимка.
 */
export const P_PRECEDENCE_URL = '/data/p-precedence.json?v=2'

type Snapshot = {
  counts: Record<string, number>
  conds: string[]
  matrix: [string, string, string, string, number | null][]
  echa: [string, string, string, string, string, string, string, number | null][]
  combos: [string, string[]][]
  hidx: [string, string, string[], string | null][]
  text: [string, string][]
  /** Коды, которым ECHA даёт уровень хоть где-то. См. `PrecedenceData.gradedCodes`. */
  gradedCodes: string[]
}

export type PrecedenceBundle = {
  data: PrecedenceData
  /** Счётчики строк снимка — идут в протокол, чтобы объём данных был виден. */
  counts: Record<string, number>
}

function decode(raw: Snapshot): PrecedenceBundle {
  const condOf = (i: number | null) => (i === null || i === undefined ? null : raw.conds[i] ?? null)

  return {
    counts: raw.counts,
    data: {
      matrix: raw.matrix.map((r) => ({
        classCode: r[0], categoryCode: r[1], pCode: r[2], statementType: r[3],
        conditionText: condOf(r[4]),
      })),
      echa: raw.echa.map((r) => ({
        classCode: r[0], categoryCode: r[1], pCode: r[2], columnType: r[3],
        level: r[4] as PrecedenceData['echa'][number]['level'],
        scope: r[5] as 'label' | 'sds',
        audience: r[6] as PrecedenceData['echa'][number]['audience'],
        // ⚠ У ECHA пустое условие означает «без оговорок», а не «неизвестно».
        // Пустая строка здесь честнее `null`: движок печатает её в протокол.
        conditionText: condOf(r[7]) ?? '',
      })),
      combos: raw.combos.map((r) => ({ code: r[0], components: r[1] })),
      hazardIndex: raw.hidx.map((r) => ({
        classCode: r[0], categoryCode: r[1], hCodes: r[2], signalWord: r[3],
      })),
      gradedCodes: raw.gradedCodes,
      text: Object.fromEntries(raw.text),
    },
  }
}

/**
 * ⚠⚠ ПАМЯТЬ НА ПРОМИС, А НЕ НА РЕЗУЛЬТАТ. Инструмент и страница протокола
 * могут попросить данные в одном кадре; память на результат заказала бы
 * загрузку дважды, память на промис — один раз.
 *
 * ⚠ При ОТКАЗЕ память сбрасывается: иначе одна неудачная загрузка навсегда
 * закрыла бы инструмент до перезагрузки страницы.
 */
let pending: Promise<PrecedenceBundle> | null = null

export function loadPrecedenceData(): Promise<PrecedenceBundle> {
  if (pending) return pending
  pending = (async () => {
    const res = await fetch(P_PRECEDENCE_URL, { cache: 'force-cache' })
    if (!res.ok) throw new Error(`${P_PRECEDENCE_URL}: HTTP ${res.status}`)
    const raw = (await res.json()) as Snapshot
    /**
     * ⚠⚠ ПРОВЕРКА ЦЕЛОСТНОСТИ ЗДЕСЬ ОБЯЗАТЕЛЬНА. Обрезанный или устаревший
     * снимок не выглядит поломкой: движок отработает и выдаст МЕНЬШЕ фраз,
     * ничего не сказав. Это ровно тот молчаливый отказ, ради которого
     * заводился `must()` в session 31.
     */
    /**
     * ⚠⚠ ВСЕ СООБЩЕНИЯ ЗДЕСЬ — ПО-АНГЛИЙСКИ, И ЭТО НЕ ВКУСОВЩИНА.
     * `PStatementSelector` печатает `error.message` ДОСЛОВНО в блоке «The
     * precedence data did not load» на английской странице. До session 66 тут
     * лежала русская строка — посетитель увидел бы её как есть.
     */
    if (!raw?.matrix?.length || !raw?.echa?.length || !raw?.hidx?.length) {
      throw new Error(`${P_PRECEDENCE_URL}: the snapshot is empty or truncated`)
    }
    /**
     * ⚠⚠ СНИМОК СТАРОЙ СБОРКИ. До session 66 поля `gradedCodes` не было, и без
     * него движок не отличит «кода у ECHA нет нигде» от «нет для этого класса»
     * — то есть выбросит с этикетки фразы, которых Annex IV требует. Отказать
     * честнее, чем выдать укороченный набор: отказ виден, набор — нет.
     */
    if (!raw?.gradedCodes?.length) {
      throw new Error(
        `${P_PRECEDENCE_URL}: this snapshot came from an older build (no gradedCodes)`,
      )
    }
    if (
      raw.counts?.matrix !== raw.matrix.length ||
      raw.counts?.echa !== raw.echa.length ||
      raw.counts?.gradedCodes !== raw.gradedCodes.length
    ) {
      throw new Error(
        `${P_PRECEDENCE_URL}: the row counts do not match the contents ` +
        `(matrix ${raw.counts?.matrix} vs ${raw.matrix.length}, ` +
        `echa ${raw.counts?.echa} vs ${raw.echa.length}, ` +
        `gradedCodes ${raw.counts?.gradedCodes} vs ${raw.gradedCodes.length}) — the file is damaged`,
      )
    }
    return decode(raw)
  })()
  pending.catch(() => { pending = null })
  return pending
}
