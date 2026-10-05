/**
 * Снимок справочника веществ для инструментов — статический файл
 * `/data/substances-index.json`.
 *
 * Собирается НА СБОРКЕ из `substances` (все строки с CAS) и `sds_pages`
 * (живые страницы) и отдаётся как обычная статика. Читает его
 * `src/lib/substancesIndexData.ts`; потребители — ATE-калькулятор, матрица
 * совместимости, выбор вещества в конструкторе и браузер `/substances/`.
 *
 * ⭐⭐ ЗАЧЕМ (session 90, 2026-10-05). До этого каждый из четырёх островов при
 * открытии страницы тянул ВЕСЬ справочник из Supabase: четыре запроса по
 * 1 000 строк (1,4–1,9 МБ JSON) плюс реестр SDS — на каждого посетителя,
 * живого или нет. 1 октября рой headless-браузеров (~1 600 адресов) открыл
 * инструменты ~18 000 раз: Supabase собрал ~22 ГБ JSON за сутки, Disk IO
 * ушёл в 100 %, пришло письмо «running out of Disk IO Budget». Такой же
 * всплеск был 16–17 сентября. База на Nano захлёбывается не от объёма, а от
 * того, что тысячи раз подряд собирает одно и то же.
 *
 * Та же развилка «клиент или сборка», что у `p-precedence.json.ts`, и тот же
 * ответ — сборка:
 * ① данные меняются только вместе с деплоем (страницы веществ уже статические,
 *    и правка базы и так требует пересборки) — тянуть их на каждого
 *    посетителя значит платить за свежесть, которой не бывает;
 * ② Cloudflare отдаёт статику бесплатно и без лимита, Supabase — из бюджета
 *    Disk IO и 5 ГБ egress в месяц на Free;
 * ③ справочник уходит с пути ботов целиком: хоть миллион загрузок — в базе
 *    ноль запросов. Правила WAF ловят не всех (тот рой ходил настоящим
 *    Chrome по HTTP/2), а статика не ловит никого — ей всё равно;
 * ④ попутно уходит часть долга №114 (чтения справочника anon-ключом без
 *    Turnstile): этих чтений больше нет.
 *
 * ⚠⚠ ОДИН ФАЙЛ НА ЧЕТЫРЕ ОСТРОВА, А НЕ ЧЕТЫРЕ ФАЙЛА ПО ПОЛЯМ. Поля — объединение
 * четырёх прежних `select`. Лишние для конкретного острова поля стоят
 * несколько сот килобайт до сжатия, зато человек, перешедший из матрицы в
 * ATE-калькулятор, получает справочник из кэша браузера, а не второй раз
 * по сети. И одно место, где меняется состав, — а не четыре, которые
 * разъедутся.
 *
 * ⚠⚠ ПОЧЕМУ ЭНДПОИНТ, А НЕ СКРИПТ ВЫГРУЗКИ С ФАЙЛОМ В GIT — см. шапку
 * `p-precedence.json.ts`: снимок в git отстаёт от базы молча. Здесь файл
 * пересобирается на каждом деплое, лишнего шага нет и забыть нечего.
 *
 * ⚠ Зависимость сборки от базы этим не добавляется: сборка и так тянет из
 * Supabase 4 500 страниц. Добавляются пять запросов по 1 000 строк и один
 * маленький.
 *
 * ⛔ Заголовков кэша здесь нет намеренно: `Response` из эндпоинта Astro отдаёт
 * на диск только тело. Кэш задаёт `public/_headers`, правило `/data/*`.
 */
import type { APIRoute } from 'astro'
import { supabase } from '../../lib/supabase'
import { must } from '../../lib/mustQuery'

export const prerender = true

/**
 * Строка справочника в снимке. ⚠ Состав полей = объединение прежних `select`
 * четырёх островов; добавил поле — подними `?v=` в `substancesIndexData.ts`.
 */
export type SubstanceIndexRow = {
  id: string
  cas_number: string
  index_number: string | null
  iupac_name: string
  common_name: string | null
  display_name_short: string | null
  synonyms: string[] | null
  ec_number: string | null
  molecular_formula: string | null
  h_statement_codes: string[] | null
  ghs_pictogram_codes: string[] | null
  signal_word: string | null
  ate_oral: number | null
}

export type SdsLiveRow = { slug: string; cas_number: string | null; substance_id: string | null }

const SUBSTANCE_COLUMNS =
  'id, cas_number, index_number, iupac_name, common_name, display_name_short, synonyms, ' +
  'ec_number, molecular_formula, h_statement_codes, ghs_pictogram_codes, signal_word, ate_oral'

/**
 * ⚠⚠ ЧИТАЕМ СТРАНИЦАМИ ВСЕГДА. PostgREST отдаёт не больше 1 000 строк за раз,
 * в `substances` их ~3 800 с CAS. Молча обрезанный снимок здесь означает
 * вещество, которого «нет» в поиске ATE и матрицы, — а не «неполный список».
 * `must()` роняет сборку на ошибке запроса (правило session 31).
 */
async function allSubstances(): Promise<SubstanceIndexRow[]> {
  const out: SubstanceIndexRow[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const rows = must(
      `substances-index: substances (from=${from})`,
      await supabase
        .from('substances')
        .select(SUBSTANCE_COLUMNS)
        .not('cas_number', 'is', null)
        .order('cas_number', { ascending: true })
        .range(from, from + page - 1),
    ) as unknown as SubstanceIndexRow[]
    out.push(...(rows ?? []))
    if (!rows || rows.length < page) break
  }
  return out
}

async function liveSdsPages(): Promise<SdsLiveRow[]> {
  const rows = must(
    'substances-index: sds_pages (live)',
    await supabase.from('sds_pages').select('slug, cas_number, substance_id').eq('status', 'live').order('slug'),
  ) as unknown as SdsLiveRow[]
  return rows ?? []
}

export const GET: APIRoute = async () => {
  const [substances, sdsPages] = await Promise.all([allSubstances(), liveSdsPages()])

  /**
   * ⚠⚠ ПУСТОЙ СНИМОК — КРАСНАЯ СБОРКА, А НЕ ПУСТОЙ ФАЙЛ. `must()` ловит ошибку
   * запроса, но не «запрос прошёл, а строк ноль» (RLS, не тот ключ, пустая
   * таблица после неудачного импорта). Инструменты с пустым справочником не
   * падают — они молча ничего не находят. Порог грубый, в разы ниже реальных
   * ~3 800, — он ловит катастрофу, а не колебания.
   */
  if (substances.length < 2000) {
    throw new Error(`build: substances-index — в снимке ${substances.length} веществ, ожидалось не меньше 2000`)
  }
  if (sdsPages.length === 0) {
    throw new Error('build: substances-index — ни одной живой страницы SDS, так не бывает')
  }

  const body = {
    generated: new Date().toISOString(),
    counts: { substances: substances.length, sdsPages: sdsPages.length },
    substances,
    sdsPages,
  }
  // ⚠ Без отступов: файл грузит каждый посетитель инструмента, здесь каждый байт считается.
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
