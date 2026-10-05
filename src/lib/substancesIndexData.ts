/**
 * Загрузка снимка справочника веществ для инструментов.
 *
 * Читает `/data/substances-index.json` — файл, который собирает на сборке
 * `src/pages/data/substances-index.json.ts`. Потребители: `AteMixtureCalculator`,
 * `StorageTool`, `SubstancePicker`, `SubstanceFilterBrowse`.
 *
 * ⭐⭐ ПОЧЕМУ ФАЙЛ, А НЕ ЗАПРОСЫ В SUPABASE ПРИ ОТКРЫТИИ СТРАНИЦЫ — расписано в
 * шапке эндпоинта. Коротко: 1 октября 2026 рой headless-браузеров 18 000 раз
 * заставил базу собрать весь справочник, Disk IO Supabase ушёл в 100 %.
 * Статику Cloudflare отдаёт сам, базе всё равно, сколько раз её спросили.
 *
 * ⚠⚠ И ПОЧЕМУ `fetch`, А НЕ `import … from '…json'`. Импорт запёк бы ~2 МБ
 * справочника В БАНДЛ острова. Отдельный файл грузится один раз, кэшируется у
 * Cloudflare и в браузере — и один на все четыре инструмента.
 */
import type { SubstanceIndexRow, SdsLiveRow } from '../pages/data/substances-index.json'

export type { SubstanceIndexRow, SdsLiveRow }

/**
 * Адрес снимка. ⚠ Задаётся файлом `src/pages/data/substances-index.json.ts`.
 *
 * ⚠⚠ `?v=` — НЕ УКРАШЕНИЕ. Файл отдаётся с `max-age=300` (`public/_headers`,
 * правило `/data/*`) и читается ниже с `cache: 'force-cache'`. Метку менять
 * при КАЖДОМ изменении СОСТАВА снимка (появилось или ушло поле) — иначе
 * вернувшийся посетитель пять минут работает со старой формой данных.
 * Устаревание самих ДАННЫХ метка не лечит и не должна: это решают 300 секунд.
 */
export const SUBSTANCES_INDEX_URL = '/data/substances-index.json?v=1'

export type SubstancesIndex = {
  generated: string
  counts: { substances: number; sdsPages: number }
  substances: SubstanceIndexRow[]
  sdsPages: SdsLiveRow[]
}

/**
 * ⚠⚠ ПАМЯТЬ НА ПРОМИС, А НЕ НА РЕЗУЛЬТАТ. Два острова на одной странице (или
 * один остров, перемонтированный React-ом) просят снимок один раз, а не два.
 * ⚠ При ОТКАЗЕ память сбрасывается: иначе одна неудачная загрузка навсегда
 * закрыла бы инструмент до перезагрузки страницы.
 */
let pending: Promise<SubstancesIndex> | null = null

export function loadSubstancesIndex(): Promise<SubstancesIndex> {
  if (pending) return pending
  pending = (async () => {
    const res = await fetch(SUBSTANCES_INDEX_URL, { cache: 'force-cache' })
    if (!res.ok) throw new Error(`${SUBSTANCES_INDEX_URL}: HTTP ${res.status}`)
    const raw = (await res.json()) as SubstancesIndex
    /**
     * ⚠⚠ ПРОВЕРКА ЦЕЛОСТНОСТИ ЗДЕСЬ ОБЯЗАТЕЛЬНА. Обрезанный снимок не выглядит
     * поломкой: поиск отработает и просто «не найдёт» вещество. Это тот самый
     * молчаливый отказ, ради которого заводился `must()` в session 31.
     * ⚠ Сообщения по-английски: остров может показать текст посетителю.
     */
    if (!Array.isArray(raw?.substances) || !Array.isArray(raw?.sdsPages)) {
      throw new Error(`${SUBSTANCES_INDEX_URL}: the snapshot has no substances or sdsPages array`)
    }
    if (raw.counts?.substances !== raw.substances.length || raw.counts?.sdsPages !== raw.sdsPages.length) {
      throw new Error(
        `${SUBSTANCES_INDEX_URL}: the row counts do not match the contents ` +
          `(substances ${raw.counts?.substances} vs ${raw.substances.length}, ` +
          `sdsPages ${raw.counts?.sdsPages} vs ${raw.sdsPages.length})`,
      )
    }
    if (raw.substances.length < 2000) {
      throw new Error(`${SUBSTANCES_INDEX_URL}: the snapshot is empty or truncated (${raw.substances.length} substances)`)
    }
    return raw
  })()
  pending.catch(() => {
    pending = null
  })
  return pending
}

/**
 * Реестр живых страниц SDS в двух индексах — по id вещества и по CAS страницы.
 * Четыре острова строили эти карты каждый по-своему; теперь одна функция.
 */
export function sdsIndexes(pages: SdsLiveRow[]) {
  const bySubstanceId = new Map<string, { slug: string; cas: string }>()
  const slugByCas = new Map<string, string>()
  for (const p of pages) {
    if (p.substance_id) bySubstanceId.set(p.substance_id, { slug: p.slug, cas: p.cas_number ?? '' })
    if (p.cas_number) slugByCas.set(p.cas_number, p.slug)
  }
  return { bySubstanceId, slugByCas }
}
