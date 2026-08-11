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

/** Адрес снимка. ⚠ Задаётся файлом `src/pages/data/p-precedence.json.ts`. */
export const P_PRECEDENCE_URL = '/data/p-precedence.json'

type Snapshot = {
  counts: Record<string, number>
  conds: string[]
  matrix: [string, string, string, string, number | null][]
  echa: [string, string, string, string, string, string, string, number | null][]
  combos: [string, string[]][]
  hidx: [string, string, string[], string | null][]
  text: [string, string][]
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
    if (!raw?.matrix?.length || !raw?.echa?.length || !raw?.hidx?.length) {
      throw new Error(`${P_PRECEDENCE_URL}: снимок пуст или обрезан`)
    }
    if (raw.counts?.matrix !== raw.matrix.length || raw.counts?.echa !== raw.echa.length) {
      throw new Error(
        `${P_PRECEDENCE_URL}: счётчики не сходятся с содержимым ` +
        `(matrix ${raw.counts?.matrix} против ${raw.matrix.length}, ` +
        `echa ${raw.counts?.echa} против ${raw.echa.length}) — файл повреждён`,
      )
    }
    return decode(raw)
  })()
  pending.catch(() => { pending = null })
  return pending
}
