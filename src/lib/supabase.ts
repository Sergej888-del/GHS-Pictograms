// Supabase клиент — единое подключение для ghspictograms.com
// PUBLIC_ префикс обязателен: без него переменные недоступны в клиентском React коде
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Отсутствуют PUBLIC_SUPABASE_URL или PUBLIC_SUPABASE_ANON_KEY в .env.local')
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

/** Длиннее дефолтного undici/HTML timeout — prerender тысяч страниц без обрыва. */
const customFetch: typeof fetch = async (input, init) => {
  // ⚠ Метод по умолчанию — GET: supabase-js для обычной выборки `method` не ставит.
  const method = (init?.method ?? 'GET').toUpperCase()
  const canRetry = method === 'GET'
  const attempts = canRetry ? RETRY_BACKOFF_MS.length + 1 : 1

  for (let i = 0; ; i++) {
    try {
      // ⚠ Свой AbortSignal на КАЖДУЮ попытку: сигнал одноразовый, переиспользовать
      // его нельзя — вторая попытка стартовала бы уже прерванной.
      const res = await fetch(input, { ...init, signal: AbortSignal.timeout(120_000) })
      if (res.ok || i >= attempts - 1 || !RETRY_STATUS.has(res.status)) return res
      console.warn(
        `[supabase] HTTP ${res.status}, попытка ${i + 1} из ${attempts} — повтор через ${RETRY_BACKOFF_MS[i]} мс`,
      )
      await sleep(RETRY_BACKOFF_MS[i])
    } catch (err) {
      // Обрыв сети или наш собственный 120-секундный таймаут.
      if (i >= attempts - 1) throw err
      console.warn(
        `[supabase] ${(err as Error)?.message ?? err}, попытка ${i + 1} из ${attempts} — повтор через ${RETRY_BACKOFF_MS[i]} мс`,
      )
      await sleep(RETRY_BACKOFF_MS[i])
    }
  }
}

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
