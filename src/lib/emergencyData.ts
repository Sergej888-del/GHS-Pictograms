/**
 * src/lib/emergencyData.ts - reads the emergency-lines reference at build time
 * (tables public.emergency_countries and public.emergency_services, scripts/sql/113-emergency-reference.sql).
 *
 * One load per build: the promise is cached at module level, so the page, the /directory/ hub block and the sitemap
 * read the same snapshot (same arrangement as directoryData.ts).
 *
 * Publication is a database switch: the public (anon) key sees only rows whose state is 'live'. With no live row the
 * snapshot is empty, and the page, the hub block and the sitemap entry are not generated at all.
 *
 * A request that fails stops the build (must()). An empty answer is a fact about the data and is allowed.
 *
 * Draft preview, local only: when EMERGENCY_PREVIEW_FILE points to the JSON written by scripts/emergency-preview.ts,
 * that file is read instead of the database. The site code never holds the service key; the script does. A deploy build
 * (Cloudflare sets CF_PAGES, CI systems set CI) refuses the variable, so draft rows cannot reach production by accident.
 */

import { supabase } from './supabase'
import { must } from './mustQuery'
import { emergencyVocabProblems } from './emergencyVocab'

export interface EmergencyCountry {
  country_code: string
  name_en: string
  wave: number
  general_number: string | null
  general_number_src: string | null
  sds_rule_kind: string
  sds_rule_summary: string
  sds_rule_source_url: string
  sds_rule_checked_on: string
  state: string
}

export interface EmergencyService {
  id: number
  country_code: string
  slug: string
  kind: string
  name: string
  operator: string | null
  phone_display: string
  phone_tel: string
  hours_kind: string
  hours_note: string | null
  audience: string
  languages: string[]
  sds_use: string
  sds_use_note: string | null
  cost_note: string | null
  source_url: string
  source_date: string | null
  verification: string
  checked_on: string
  state: string
  sort: number
}

export interface EmergencyCountryBlock {
  country: EmergencyCountry
  services: EmergencyService[]
}

export interface EmergencySnapshot {
  /** Countries with at least one service or a general number, sorted by English name. */
  blocks: EmergencyCountryBlock[]
  /** true = rows came from the local preview file and may include drafts. Never true on a deploy build. */
  preview: boolean
  serviceCount: number
  /** Latest checked_on over the rows shown (YYYY-MM-DD), or null when nothing is shown. */
  lastChecked: string | null
}

const COUNTRY_COLS =
  'country_code, name_en, wave, general_number, general_number_src, sds_rule_kind, sds_rule_summary, sds_rule_source_url, sds_rule_checked_on, state'
const SERVICE_COLS =
  'id, country_code, slug, kind, name, operator, phone_display, phone_tel, hours_kind, hours_note, audience, languages, sds_use, sds_use_note, cost_note, source_url, source_date, verification, checked_on, state, sort'

function envVar(name: string): string | undefined {
  // globalThis.process: the browser bundle has no `process`, and this module must not break if it is ever pulled there.
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return p?.env?.[name]
}

interface RawRows {
  countries: EmergencyCountry[]
  services: EmergencyService[]
  preview: boolean
}

async function readRows(): Promise<RawRows> {
  const previewFile = envVar('EMERGENCY_PREVIEW_FILE')
  if (previewFile) {
    if (envVar('CF_PAGES') || envVar('CI')) {
      throw new Error('build: EMERGENCY_PREVIEW_FILE is set on a deploy build - refusing, draft rows must not be published')
    }
    const { readFileSync } = await import('node:fs')
    const raw = JSON.parse(readFileSync(previewFile, 'utf8')) as { countries?: EmergencyCountry[]; services?: EmergencyService[] }
    if (!Array.isArray(raw.countries) || !Array.isArray(raw.services)) {
      throw new Error(`build: ${previewFile} is not an emergency preview file (run npm run preview:emergency)`)
    }
    return { countries: raw.countries, services: raw.services, preview: true }
  }

  const countries = must(
    'emergency_countries for /directory/emergency-numbers/',
    await supabase.from('emergency_countries').select(COUNTRY_COLS).order('country_code').range(0, 199),
  ) as unknown as EmergencyCountry[]
  const services = must(
    'emergency_services for /directory/emergency-numbers/',
    await supabase.from('emergency_services').select(SERVICE_COLS).order('id').range(0, 999),
  ) as unknown as EmergencyService[]
  if (services.length >= 1000) throw new Error('build: emergency_services reached 1000 rows - page through them')

  // The public key must see live rows only. A draft row here means the read policy changed: stop, do not print it.
  const leaked = [...countries, ...services].filter((r) => r.state !== 'live')
  if (leaked.length > 0) {
    throw new Error(`build: the public key can read ${leaked.length} non-live emergency rows - check the row-level security policy`)
  }
  return { countries, services, preview: false }
}

function assemble({ countries, services, preview }: RawRows): EmergencySnapshot {
  const problems: string[] = []
  for (const c of countries) for (const p of emergencyVocabProblems('country', c as unknown as Record<string, unknown>)) problems.push(`${c.country_code}: ${p}`)

  // unconfirmed rows are never printed, in preview too (the database also refuses them as live).
  const shown = services.filter((s) => s.verification !== 'unconfirmed')
  for (const s of shown) for (const p of emergencyVocabProblems('service', s as unknown as Record<string, unknown>)) problems.push(`${s.country_code}/${s.slug}: ${p}`)

  const byCode = new Map(countries.map((c) => [c.country_code, c]))
  for (const s of shown) {
    if (!byCode.has(s.country_code)) {
      problems.push(`${s.country_code}/${s.slug}: the service is live but its country is not - set the country to live too`)
    }
  }
  if (problems.length > 0) throw new Error(`build: emergency data problems:\n  ${problems.slice(0, 30).join('\n  ')}`)

  const blocks: EmergencyCountryBlock[] = []
  for (const country of countries) {
    const own = shown
      .filter((s) => s.country_code === country.country_code)
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
    // A country with neither a service nor a general number has nothing to dial, so it stays off the page.
    if (own.length === 0 && !country.general_number) continue
    blocks.push({ country, services: own })
  }
  blocks.sort((a, b) => a.country.name_en.localeCompare(b.country.name_en, 'en'))

  const dates = [
    ...blocks.flatMap((b) => b.services.map((s) => s.checked_on)),
    ...blocks.map((b) => b.country.sds_rule_checked_on),
  ].sort()
  return {
    blocks,
    preview,
    serviceCount: blocks.reduce((n, b) => n + b.services.length, 0),
    lastChecked: dates.at(-1) ?? null,
  }
}

let cache: Promise<EmergencySnapshot> | null = null

export function loadEmergency(): Promise<EmergencySnapshot> {
  return (cache ??= readRows().then(assemble))
}

/** The page, the hub block and the sitemap entry exist only when this is true. */
export async function emergencyPageExists(): Promise<boolean> {
  return (await loadEmergency()).blocks.length > 0
}
