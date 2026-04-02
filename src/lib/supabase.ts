// Supabase клиент — единое подключение для ghspictograms.com
// PUBLIC_ префикс обязателен: без него переменные недоступны в клиентском React коде
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Отсутствуют PUBLIC_SUPABASE_URL или PUBLIC_SUPABASE_ANON_KEY в .env.local')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Типы для основных таблиц
export interface Substance {
  id: string
  cas_number: string | null
  ec_number: string | null
  un_number: string | null
  iupac_name: string
  common_name: string | null
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
