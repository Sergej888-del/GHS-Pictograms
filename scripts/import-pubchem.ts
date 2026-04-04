import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

config({ path: resolve(process.cwd(), '.env.local') })

/**
 * Импорт физических данных из PubChem (PUG REST + PUG View) в Supabase substances.
 *
 * Запуск из корня ghspictograms:
 *   npx tsx scripts/import-pubchem.ts
 *
 * .env.local (те же имена, что и в src/lib/supabase.ts):
 *   PUBLIC_SUPABASE_URL=
 *   SUPABASE_SERVICE_ROLE_KEY=   ← обязателен: у substances нет политики UPDATE для anon
 *
 * Опционально: PUBLIC_SUPABASE_ANON_KEY — только чтение, обновления не пройдут.
 */

const PUBCHEM_DELAY_MS = 300
const PROGRESS_EVERY = 50

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl) {
  console.error('Нет PUBLIC_SUPABASE_URL (или SUPABASE_URL) в .env.local')
  process.exit(1)
}

if (!serviceKey) {
  console.warn(
    'Внимание: нет SUPABASE_SERVICE_ROLE_KEY — UPDATE substances с анонимным ключом, скорее всего, заблокирован RLS.'
  )
}

const supabaseKey = serviceKey ?? anonKey
if (!supabaseKey) {
  console.error('Нужен SUPABASE_SERVICE_ROLE_KEY или PUBLIC_SUPABASE_ANON_KEY в .env.local')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey)

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function encodeCasForUrl(cas: string): string {
  return encodeURIComponent(cas.trim())
}

/** Первый числовой литерал в °C; иначе первая °F → °C. */
function parseTemperatureFromText(s: string): number | null {
  const c = s.match(/(-?\d+(?:\.\d+)?)\s*°?\s*C\b/i)
  if (c) return parseFloat(c[1])
  const f = s.match(/(-?\d+(?:\.\d+)?)\s*°?\s*F\b/i)
  if (f) return ((parseFloat(f[1]) - 32) * 5) / 9
  const plain = s.match(/(-?\d+(?:\.\d+)?)\s*°C/i)
  if (plain) return parseFloat(plain[1])
  return null
}

/** Собирает строки из дерева PUG View (StringWithMarkup, String). */
function collectPugViewStrings(node: unknown, out: string[]): void {
  if (node == null) return
  if (typeof node === 'string') {
    out.push(node)
    return
  }
  if (Array.isArray(node)) {
    for (const x of node) collectPugViewStrings(x, out)
    return
  }
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (typeof o.String === 'string') out.push(o.String)
    if (Array.isArray(o.StringWithMarkup)) {
      for (const item of o.StringWithMarkup) {
        if (item && typeof item === 'object' && 'String' in item) {
          const s = (item as { String?: string }).String
          if (s) out.push(s)
        }
      }
    }
    for (const v of Object.values(o)) collectPugViewStrings(v, out)
  }
}

function parseTemperatureFromPugView(json: unknown): number | null {
  const strings: string[] = []
  collectPugViewStrings(json, strings)
  for (const s of strings) {
    const t = parseTemperatureFromText(s)
    if (t != null && !Number.isNaN(t)) return t
  }
  return null
}

/** UN из строк вида "1090", "1090 (ACETONE)". */
function parseUnNumberFromPugView(json: unknown): string | null {
  const strings: string[] = []
  collectPugViewStrings(json, strings)
  for (const s of strings) {
    const m = s.match(/\b(\d{4})\b/)
    if (m) return `UN${m[1]}`
  }
  return null
}

interface PubChemProps {
  CID?: number
  MolecularFormula?: string
  MolecularWeight?: string | number
  FlashPoint?: string | number
  BoilingPoint?: string | number
  MeltingPoint?: string | number
}

function parsePropertyTable(json: unknown): PubChemProps | null {
  try {
    if (json && typeof json === 'object' && 'Fault' in json) return null
    const pt = (json as { PropertyTable?: { Properties?: PubChemProps[] } }).PropertyTable
    const row = pt?.Properties?.[0]
    return row ?? null
  } catch {
    return null
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Шаг 3–4: свойства по CAS (сначала URL из ТЗ; при 400 — рабочий fallback). */
async function fetchCompoundProperties(cas: string): Promise<PubChemProps | null> {
  const base = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeCasForUrl(cas)}/property`
  const urlFull = `${base}/MolecularFormula,MolecularWeight,FlashPoint,BoilingPoint,MeltingPoint/JSON`
  const urlFallback = `${base}/MolecularFormula,MolecularWeight/JSON`

  try {
    const data = await fetchJson(urlFull)
    return parsePropertyTable(data)
  } catch {
    try {
      await sleep(PUBCHEM_DELAY_MS)
      const data = await fetchJson(urlFallback)
      return parsePropertyTable(data)
    } catch {
      return null
    }
  }
}

/** Шаг 5: отдельный запрос IUPACName (CID для UN и согласованность). */
async function fetchIupacRow(cas: string): Promise<PubChemProps | null> {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeCasForUrl(cas)}/property/IUPACName/JSON`
  try {
    const data = await fetchJson(url)
    return parsePropertyTable(data)
  } catch {
    return null
  }
}

async function fetchUnNumber(cid: number): Promise<string | null> {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=${encodeURIComponent('UN Number')}`
  try {
    const data = await fetchJson(url)
    return parseUnNumberFromPugView(data)
  } catch {
    return null
  }
}

async function fetchPugViewTemperature(cid: number, heading: string): Promise<number | null> {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=${encodeURIComponent(heading)}`
  try {
    const data = await fetchJson(url)
    return parseTemperatureFromPugView(data)
  } catch {
    return null
  }
}

function propToNumber(v: string | number | undefined): number | null {
  if (v == null) return null
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  const s = String(v)
  const m = s.match(/-?\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

function propToString(v: string | number | undefined): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

type SubstanceRow = { id: string; cas_number: string }

async function loadAllSubstances(): Promise<SubstanceRow[]> {
  const pageSize = 1000
  const all: SubstanceRow[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('substances')
      .select('id, cas_number')
      .not('cas_number', 'is', null)
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`Supabase select: ${error.message}`)
    if (!data?.length) break
    all.push(...(data as SubstanceRow[]))
    if (data.length < pageSize) break
  }
  return all
}

async function main(): Promise<void> {
  let found = 0
  let notFound = 0
  let updated = 0
  let dbErrors = 0
  let unexpectedErrors = 0

  const rows = await loadAllSubstances()
  const total = rows.length
  console.log(`Веществ с CAS: ${total}`)

  for (let i = 0; i < rows.length; i++) {
    const { id, cas_number: cas } = rows[i]
    const n = i + 1

    if (n % PROGRESS_EVERY === 0 || n === total) {
      console.log(`Processed ${n}/${total}`)
    }

    let props: PubChemProps | null = null
    let iupacRow: PubChemProps | null = null
    let un: string | null = null

    try {
      props = await fetchCompoundProperties(cas)
      await sleep(PUBCHEM_DELAY_MS)

      iupacRow = await fetchIupacRow(cas)
      await sleep(PUBCHEM_DELAY_MS)

      const cid =
        props?.CID ??
        iupacRow?.CID ??
        null

      if (!cid) {
        notFound++
        await sleep(PUBCHEM_DELAY_MS)
        continue
      }

      found++

      un = await fetchUnNumber(cid)
      await sleep(PUBCHEM_DELAY_MS)

      let flash = propToNumber(props?.FlashPoint)
      let boiling = propToNumber(props?.BoilingPoint)
      let melting = propToNumber(props?.MeltingPoint)

      // В PUG REST нет валидных имён FlashPoint/BoilingPoint/MeltingPoint — добираем из PUG View.
      if (flash == null) {
        flash = await fetchPugViewTemperature(cid, 'Flash Point')
        await sleep(PUBCHEM_DELAY_MS)
      }
      if (boiling == null) {
        boiling = await fetchPugViewTemperature(cid, 'Boiling Point')
        await sleep(PUBCHEM_DELAY_MS)
      }
      if (melting == null) {
        melting = await fetchPugViewTemperature(cid, 'Melting Point')
        await sleep(PUBCHEM_DELAY_MS)
      }

      const payload: Record<string, string | number | null> = {
        molecular_formula: propToString(props?.MolecularFormula),
        molecular_weight: propToNumber(props?.MolecularWeight),
        flash_point: flash,
        boiling_point: boiling,
        melting_point: melting,
        un_number: un,
      }

      const hasAny =
        payload.molecular_formula != null ||
        payload.molecular_weight != null ||
        payload.flash_point != null ||
        payload.boiling_point != null ||
        payload.melting_point != null ||
        payload.un_number != null

      if (!hasAny) continue

      const clean = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v != null)
      ) as Record<string, string | number>

      if (Object.keys(clean).length === 0) continue

      const { error } = await supabase.from('substances').update(clean).eq('id', id)
      if (error) {
        console.error(`DB update ${cas}:`, error.message)
        dbErrors++
      } else {
        updated++
      }
    } catch (e) {
      unexpectedErrors++
      console.error(`Ошибка по CAS ${cas}:`, e instanceof Error ? e.message : e)
    }
  }

  console.log('--- Итог ---')
  console.log(`Найдено в PubChem (есть CID): ${found}`)
  console.log(`Не найдено (нет CID): ${notFound}`)
  console.log(`Обновлено записей в БД: ${updated}`)
  if (dbErrors) console.log(`Ошибок Supabase при UPDATE: ${dbErrors}`)
  if (unexpectedErrors) console.log(`Непредвиденных ошибок: ${unexpectedErrors}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
