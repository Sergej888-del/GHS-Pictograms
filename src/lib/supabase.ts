// Supabase клиент — единое подключение для ghspictograms.com
// PUBLIC_ префикс обязателен: без него переменные недоступны в клиентском React коде
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY in .env.local')
}

/**
 * ⚠⚠ ПОВТОР ЧТЕНИЯ ПРИ ОТКАЗЕ ПУЛЕРА (session 41).
 *
 * Сборка легла на `build: substances (from=0) — canceling statement due to
 * statement timeout`, при том что ровно тот же код собрался получасом раньше.
 * Это не регламентная ошибка и не дефект данных: `getStaticPaths` страницы
 * номера тянет десять цепочек запросов разом (`Promise.all`), и под этим
 * пулер Supabase иногда отменяет statement. Разбор той же природы —
 * в шапке `mapLimit` в mustQuery.ts.
 *
 * ⚠⚠ ПОВТОРЯЕМ ТОЛЬКО GET, И ЭТО НЕ ОСТОРОЖНИЧАНЬЕ. Выборки PostgREST —
 * GET, а вот RPC и запись формы (`leads`) уходят POST-ом. Повтор POST после
 * ответа 500 может завести второй лид на одну отправку: ответ не дошёл, но
 * строка записалась. Молча удваивать чужие заявки нельзя.
 *
 * ⚠ Отказ после трёх попыток остаётся ОТКАЗОМ. Правило «падать громко на
 * ошибке» (session 31) не отменяется: `must()` увидит тот же error и уронит
 * сборку. Здесь снимается только дребезг, а не диагностика — поэтому каждая
 * повторная попытка пишет строку в лог.
 */
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504])
const RETRY_BACKOFF_MS = [900, 2500]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * ⚠⚠ ЧИТАЮЩИЕ RPC — ИХ ПОВТОРЯТЬ МОЖНО, И БЕЗ ЭТОГО СБОРКА ПАДАЛА.
 *
 * Правило «повторяем только GET» верно по причине, но неверно по объёму.
 * Выборки PostgREST уходят GET-ом, а RPC — POST-ом, и повтор POST после 500
 * действительно может удвоить запись. Но эти четыре RPC ничего не пишут: они
 * читают. Отсекая по методу, мы отсекали и их — а `get_storage_verdict` как раз
 * тот вызов, на котором 2026-08-08 легла сборка Cloudflare:
 *
 *     build: get_storage_verdict(111-30-8) for glutaraldehyde
 *            — canceling statement due to statement timeout
 *
 * Ровно тот же код собирался локально дважды в тот же день. Повтора не было не
 * потому, что мы решили не повторять, а потому, что фильтр по методу задел
 * читающие вызовы заодно с пишущими.
 *
 * ⚠ Список ИМЕНАМИ, а не по префиксу `get_`. Соглашение об именах — не гарантия:
 * стоит однажды завести пишущую функцию с именем `get_…`, и повтор молча
 * удвоит запись. Имя в списке — это утверждение «эта функция читает», и его
 * делает человек, а не регулярка.
 */
const READ_ONLY_RPC = new Set([
  'get_storage_verdict',
  'get_class_substances',
  'get_class_compatibility',
  'get_statement_counts',
])

/** Адрес запроса — из любой формы первого аргумента `fetch`. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function isReadOnlyRpc(input: RequestInfo | URL): boolean {
  const m = /\/rest\/v1\/rpc\/([a-z0-9_]+)/i.exec(urlOf(input))
  return !!m && READ_ONLY_RPC.has(m[1])
}

/**
 * ⭐⭐ ОБЩИЙ ПРЕДЕЛ ОДНОВРЕМЕННЫХ ЗАПРОСОВ — И ОН ОБЯЗАН БЫТЬ ЗДЕСЬ, А НЕ В
 * МЕСТАХ ВЫЗОВА.
 *
 * `mapLimit` в mustQuery.ts ограничивает ОДИН маршрут. Но Astro собирает
 * маршруты ОДНОВРЕМЕННО, и залп, который видит база, — это СУММА по всем:
 * `/sds/` держит 6 работников по ~7 запросов, `storage-compatibility/[class]`
 * стреляет 26 RPC разом, `storage-compatibility/index` ещё 26, и дюжина
 * страниц шлёт пачки по 5–7. Никакой предел внутри одного маршрута этого не
 * закрывает — и не закроет, сколько их ни расставляй.
 *
 * `statement_timeout` роли `anon` — 3 с (замерено в session 47). Сам
 * `get_storage_verdict` в тишине идёт 199 мс. Одно с другим не противоречит:
 * вызов встаёт в очередь и упирается в потолок роли.
 *
 * ⚠ Предел ставится ТОЛЬКО на сборке. В браузере конструктор делает единицы
 * запросов, а семафор там — лишний код на пути к отклику и риск подвиснуть,
 * если промис по какой-то причине не разрешится.
 *
 * ⚠ 10, а не 4: при слишком тесном пределе сборка 4 499 страниц растягивается
 * без нужды. И не 40: тогда мы возвращаемся к тому, с чего начали.
 */
const IS_BUILD = typeof window === 'undefined'
const INFLIGHT_LIMIT = 10
let inflight = 0
const waiting: (() => void)[] = []

async function acquire(): Promise<void> {
  if (inflight < INFLIGHT_LIMIT) { inflight++; return }
  await new Promise<void>((resolve) => waiting.push(resolve))
  inflight++
}

function release(): void {
  inflight--
  // ⚠ Будим ровно одного: разбудить всех — значит снова открыть шлюз целиком.
  waiting.shift()?.()
}

/**
 * ⚠⚠ «fetch failed» — ЭТО НЕ ДИАГНОЗ, А ЗАГЛУШКА UNDICI.
 *
 * Настоящая причина лежит в `err.cause`, иногда на два уровня глубже. Без
 * разбора цепочки подменённый сертификат, мёртвый DNS и закрытый порт выглядят
 * ОДНОЙ И ТОЙ ЖЕ бесполезной строкой `TypeError: fetch failed`.
 *
 * ⛔ Это не теория: на этой машине TLS перехватывается, и `npm run build`
 * (без `--use-system-ca`) падает ровно так — на первом же запросе к базе, не
 * сказав ни слова о том, что дело в сертификате. Правильная команда —
 * `npm run build:local`; `build` оставлен для Cloudflare, где перехвата нет.
 *
 * ⚠ Тот же приём уже работал в `scripts/download-clp-annexes.mjs`. Он повторён
 * здесь, а не импортирован: `.mjs` из `scripts/` в код сайта не тянется.
 */
const TLS_HINTS: Record<string, string> = {
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'сертификат подменён (антивирус или прокси)',
  SELF_SIGNED_CERT_IN_CHAIN: 'самоподписанный корень в цепочке',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'самоподписанный сертификат',
  CERT_HAS_EXPIRED: 'сертификат просрочен — проверь дату и время в Windows',
  ERR_TLS_CERT_ALTNAME_INVALID: 'сертификат выписан на другое имя',
}
const NET_HINTS: Record<string, string> = {
  ENOTFOUND: 'DNS не разрешает имя — проверь PUBLIC_SUPABASE_URL в .env.local',
  EAI_AGAIN: 'DNS временно не отвечает',
  ECONNREFUSED: 'соединение отклонено — файрвол или прокси',
  ECONNRESET: 'соединение оборвано на середине',
  ETIMEDOUT: 'таймаут — сеть до Supabase не доходит',
  UND_ERR_CONNECT_TIMEOUT: 'таймаут соединения',
  UND_ERR_HEADERS_TIMEOUT: 'база приняла запрос, но не ответила вовремя',
}

/**
 * Стоит ли у процесса флаг `--use-system-ca`.
 * ⚠ Через `globalThis.process`, а не `process` напрямую: в браузерном бандле
 * такого имени нет вовсе, а сборщик умеет подставлять `process.env` буквально.
 */
function hasSystemCa(): boolean {
  const p = (globalThis as { process?: { execArgv?: string[]; env?: Record<string, string | undefined> } }).process
  if (!p) return false
  return (p.execArgv ?? []).some((a) => a.includes('use-system-ca'))
    || (p.env?.NODE_OPTIONS ?? '').includes('use-system-ca')
}

/**
 * Разворачивает отказ сети в сообщение, из которого следует, что делать.
 *
 * ⚠⚠ ЗОВЁТСЯ ТОЛЬКО НА СБОРКЕ, И ЭТО НЕ ПЕРЕСТРАХОВКА. Тот же `rawFetch` работает
 * в браузере, а `secondError` / `primaryError` конструктора печатаются
 * ПОСЕТИТЕЛЮ. Русский текст и совет про `npm run build:local` посетителю не
 * нужны и не должны до него доезжать — правило session 67: сообщение, которое
 * видит посетитель, на языке страницы. В браузере ошибка уходит как есть.
 */
function explainFetchFailure(err: unknown): Error {
  const chain: { message?: string; code?: string; cause?: unknown }[] = []
  for (let e = err as { message?: string; code?: string; cause?: unknown } | null | undefined;
       e && chain.length < 8;
       e = e.cause as typeof e) {
    chain.push(e)
  }
  const codes = chain.map((e) => e.code).filter(Boolean) as string[]
  const code = codes[codes.length - 1] ?? null
  const trail = chain.map((e) => e.message).filter(Boolean).join(' ← ')

  const lines = [`сеть до Supabase не поднялась: ${trail || String(err)}`]
  if (code) lines.push(`  код: ${code}`)

  if (code && TLS_HINTS[code]) {
    lines.push(`  ⚠ ${TLS_HINTS[code]}`)
    lines.push(
      hasSystemCa()
        ? '  ⚠ флаг --use-system-ca УЖЕ стоит — значит дело не в перехвате TLS'
        : '  ⛔ флага --use-system-ca НЕТ. Собирать этот проект надо командой\n     `npm run build:local` — `npm run build` идёт без флага и оставлен для Cloudflare',
    )
  } else if (code && NET_HINTS[code]) {
    lines.push(`  ⚠ ${NET_HINTS[code]}`)
  } else if (!hasSystemCa()) {
    // ⚠ Причина не опознана — но самая частая на этой машине проверяется первой.
    lines.push('  ⚠ причина не опознана. Проверь первым делом, что запущено через\n     `npm run build:local`: `npm run build` идёт без --use-system-ca')
  }

  const out = new Error(lines.join('\n'))
  ;(out as Error & { cause?: unknown }).cause = err
  return out
}

/** Длиннее дефолтного undici/HTML timeout — prerender тысяч страниц без обрыва. */
const rawFetch: typeof fetch = async (input, init) => {
  // ⚠ Метод по умолчанию — GET: supabase-js для обычной выборки `method` не ставит.
  const method = (init?.method ?? 'GET').toUpperCase()
  const canRetry = method === 'GET' || isReadOnlyRpc(input)
  const attempts = canRetry ? RETRY_BACKOFF_MS.length + 1 : 1

  for (let i = 0; ; i++) {
    try {
      // ⚠ Свой AbortSignal на КАЖДУЮ попытку: сигнал одноразовый, переиспользовать
      // его нельзя — вторая попытка стартовала бы уже прерванной.
      const res = await fetch(input, { ...init, signal: AbortSignal.timeout(120_000) })
      if (res.ok || i >= attempts - 1 || !RETRY_STATUS.has(res.status)) return res
      console.warn(
        `[supabase] HTTP ${res.status}, attempt ${i + 1} of ${attempts} — retrying in ${RETRY_BACKOFF_MS[i]} ms`,
      )
      await sleep(RETRY_BACKOFF_MS[i])
    } catch (err) {
      // Обрыв сети или наш собственный 120-секундный таймаут.
      // ⚠ На сборке отказ разворачивается в причину (см. `explainFetchFailure`),
      // в браузере уходит как есть: там его текст видит посетитель.
      if (i >= attempts - 1) throw IS_BUILD ? explainFetchFailure(err) : err
      console.warn(
        `[supabase] ${(err as Error)?.message ?? err}, attempt ${i + 1} of ${attempts} — retrying in ${RETRY_BACKOFF_MS[i]} ms`,
      )
      await sleep(RETRY_BACKOFF_MS[i])
    }
  }
}

/**
 * Тот же `fetch`, но на сборке — через общий предел одновременных запросов.
 *
 * ⚠⚠ `release()` стоит в `finally`, и это не формальность: без него один
 * упавший запрос навсегда съедает слот, десять таких — и сборка встаёт молча,
 * без ошибки, до самого таймаута Cloudflare. Отказ должен стоить слота на время
 * запроса, а не навсегда.
 */
const customFetch: typeof fetch = IS_BUILD
  ? async (input, init) => {
      await acquire()
      try {
        return await rawFetch(input, init)
      } finally {
        release()
      }
    }
  : rawFetch

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: customFetch },
})

// Типы для основных таблиц
export interface Substance {
  id: string
  cas_number: string | null
  ec_number: string | null
  un_number: string | null
  iupac_name: string
  common_name: string | null
  display_name_short: string | null
  name_ru: string | null
  synonyms: string[] | null
  molecular_formula: string | null
  molecular_weight: number | null
  flash_point: number | null
  boiling_point: number | null
  ate_oral: number | null
  ate_dermal: number | null
  ate_inhalation_vapour: number | null
  ate_inhalation_dust: number | null
  ate_inhalation_gas: number | null
  svhc_status: boolean
  clp_harmonized: boolean
  data_level: number
  /** Агрегированные коды CLP (миграция 001) */
  h_statement_codes?: string[] | null
  ghs_pictogram_codes?: string[] | null
  signal_word?: string | null
  p_statement_codes?: string[] | null
}

export interface HStatement {
  id: string
  code: string
  category: string
  text_en: string
  text_ru: string | null
}

export interface PStatement {
  id: string
  code: string
  category: string
  text_en: string
  text_ru: string | null
}

export interface Pictogram {
  id: string
  code: string
  name_en: string
  name_ru: string | null
  svg_content: string | null
  svg_url: string | null
  signal_word_en: string | null
  signal_word_ru: string | null
}

export interface HazardClassification {
  id: string
  substance_id: string
  hazard_class: string
  hazard_category: string
  hazard_type: string
  signal_word: string | null
  pictogram_id: string | null
  h_statement_codes: string[] | null
  p_statement_codes: string[] | null
}

export interface MixtureComponent {
  substance_id: string
  cas_number: string
  name: string
  concentration: number
  ate_oral: number | null
  ate_dermal: number | null
  ate_inhalation_vapour: number | null
  ate_inhalation_dust: number | null
}

export interface Mixture {
  id: string
  name: string
  description: string | null
  components: MixtureComponent[]
  ate_mix_oral: number | null
  ate_mix_dermal: number | null
  ate_mix_inhal_vapour: number | null
  ate_mix_inhal_dust: number | null
  acute_tox_oral_category: number | null
  resulting_signal_word: string | null
  lead_captured: boolean
  created_at: string
}

export interface Lead {
  id: string
  email: string
  company_name: string | null
  source_tool: string
  source_domain: string | null
  substance_name: string | null
  mixture_id: string | null
  email_consent: boolean
  email_type?: string | null
  brevo_contact_id?: string | null
}
