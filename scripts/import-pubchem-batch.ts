/**
 * Батчевый импорт из PubChem: формула, масса (REST), flash/boil (PUG View).
 *
 * Запуск из корня ghspictograms:
 *   npx tsx scripts/import-pubchem-batch.ts
 *
 * Требуется .env.local:
 *   PUBLIC_SUPABASE_URL=
 *   SUPABASE_SERVICE_ROLE_KEY=
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

config({ path: resolve(process.cwd(), '.env.local') })

const PAGE_SIZE = 1000
const STAGE1_PARALLEL = 10
const STAGE1_BATCH_DELAY_MS = 500
const STAGE1_LOG_EVERY = 50
const STAGE2_PARALLEL = 5
const STAGE2_BATCH_DELAY_MS = 200
const STAGE2_LOG_EVERY = 100

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  console.error('Нет PUBLIC_SUPABASE_URL (или SUPABASE_URL) в .env.local')
  process.exit(1)
}
if (!serviceKey) {
  console.error('Нужен SUPABASE_SERVICE_ROLE_KEY в .env.local')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey)

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Первый числовой литерал в °C; иначе первая °F → °C. (как в import-pubchem.ts) */
function parseTemperatureFromText(s: string): number | null {
  const c = s.match(/(-?\d+(?:\.\d+)?)\s*°?\s*C\b/i)
  if (c) return parseFloat(c[1])
  const f = s.match(/(-?\d+(?:\.\d+)?)\s*°?\s*F\b/i)
  if (f) return ((parseFloat(f[1]) - 32) * 5) / 9
  const plain = s.match(/(-?\d+(?:\.\d+)?)\s*°C/i)
  if (plain) return parseFloat(plain[1])
  return null
}

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
          const str = (item as { String?: string }).String
          if (str) out.push(str)
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

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchPugViewTemp(cid: number, heading: string): Promise<number | null> {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=${encodeURIComponent(heading)}`
  try {
    const data = await fetchJson(url)
    return parseTemperatureFromPugView(data)
  } catch {
    return null
  }
}

async function fetchTemperatures(cid: number): Promise<{ flash: number | null; boiling: number | null }> {
  const [flash, boiling] = await Promise.allSettled([
    fetchPugViewTemp(cid, 'Flash Point'),
    fetchPugViewTemp(cid, 'Boiling Point'),
  ])
  return {
    flash: flash.status === 'fulfilled' ? flash.value : null,
    boiling: boiling.status === 'fulfilled' ? boiling.value : null,
  }
}

interface PubChemData {
  cid: number
  molecular_formula: string | null
  molecular_weight: number | null
}

async function fetchSingleCAS(cas: string): Promise<PubChemData | null> {
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(cas.trim())}/property/MolecularFormula,MolecularWeight/JSON`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as {
      PropertyTable?: { Properties?: Array<{ CID?: number; MolecularFormula?: string; MolecularWeight?: string | number }> }
      Fault?: unknown
    }
    if (json && typeof json === 'object' && 'Fault' in json) return null
    const props = json?.PropertyTable?.Properties?.[0]
    if (!props?.CID) return null
    const mwRaw = props.MolecularWeight
    let molecular_weight: number | null = null
    if (mwRaw != null && mwRaw !== '') {
      const n = parseFloat(String(mwRaw))
      molecular_weight = Number.isNaN(n) ? null : n
    }
    const mf = props.MolecularFormula
    return {
      cid: props.CID,
      molecular_formula: mf != null && String(mf).trim() !== '' ? String(mf).trim() : null,
      molecular_weight,
    }
  } catch {
    return null
  }
}

async function fetchBatch(casList: string[]): Promise<Map<string, PubChemData>> {
  const results = new Map<string, PubChemData>()
  const chunks = chunkArray(casList, STAGE1_PARALLEL)
  let done = 0
  const total = casList.length

  for (const chunk of chunks) {
    const promises = chunk.map((cas) => fetchSingleCAS(cas))
    const settled = await Promise.allSettled(promises)
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        results.set(chunk[i], result.value)
      }
    })
    done += chunk.length
    if (done % STAGE1_LOG_EVERY === 0 || done === total) {
      console.log(`[Этап 1] Обработано ${done}/${total}`)
    }
    await sleep(STAGE1_BATCH_DELAY_MS)
  }
  return results
}

type SubstanceRow = { id: string; cas_number: string }

async function loadAllSubstances(): Promise<SubstanceRow[]> {
  const all: SubstanceRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('substances')
      .select('id, cas_number')
      .not('cas_number', 'is', null)
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(`Supabase select: ${error.message}`)
    if (!data?.length) break
    all.push(...(data as SubstanceRow[]))
    if (data.length < PAGE_SIZE) break
  }
  return all
}

async function main(): Promise<void> {
  let updated = 0
  let dbErrors = 0
  let unexpectedErrors = 0

  const rows = await loadAllSubstances()
  const total = rows.length
  console.log(`Веществ с CAS: ${total}`)

  const casList = rows.map((r) => r.cas_number)
  const stage1Map = await fetchBatch(casList)
  const found = stage1Map.size
  console.log(`[Этап 1] Найдено в PubChem: ${found} / ${total}`)

  const withCid = rows.filter((r) => stage1Map.has(r.cas_number))
  const s2total = withCid.length
  let s2done = 0

  const updates: Array<{ id: string; payload: Record<string, string | number> }> = []

  for (const chunk of chunkArray(withCid, STAGE2_PARALLEL)) {
    try {
      await Promise.all(
        chunk.map(async (row) => {
          const s1 = stage1Map.get(row.cas_number)
          if (!s1) return
          const temps = await fetchTemperatures(s1.cid)
          const payload: Record<string, string | number | null> = {
            molecular_formula: s1.molecular_formula,
            molecular_weight: s1.molecular_weight,
            flash_point: temps.flash,
            boiling_point: temps.boiling,
          }
          const clean = Object.fromEntries(
            Object.entries(payload).filter(([, v]) => v != null)
          ) as Record<string, string | number>
          if (Object.keys(clean).length > 0) {
            updates.push({ id: row.id, payload: clean })
          }
        })
      )
    } catch (e) {
      unexpectedErrors++
      console.error('[Этап 2] batch:', e instanceof Error ? e.message : e)
    }
    s2done += chunk.length
    if (s2done % STAGE2_LOG_EVERY === 0 || s2done === s2total) {
      console.log(`[Этап 2] Обработано ${s2done}/${s2total}`)
    }
    await sleep(STAGE2_BATCH_DELAY_MS)
  }

  console.log(`[Этап 3] Записей к обновлению: ${updates.length}`)

  for (const { id, payload } of updates) {
    try {
      const { error } = await supabase.from('substances').update(payload).eq('id', id)
      if (error) {
        console.error(`DB update id=${id}:`, error.message)
        dbErrors++
      } else {
        updated++
      }
    } catch (e) {
      unexpectedErrors++
      console.error(`DB update id=${id}:`, e instanceof Error ? e.message : e)
    }
  }

  console.log('--- Итог ---')
  console.log(`Найдено (этап 1, с CID): ${found}`)
  console.log(`Обновлено в БД: ${updated}`)
  console.log(`Ошибок Supabase: ${dbErrors}`)
  if (unexpectedErrors) console.log(`Прочих ошибок: ${unexpectedErrors}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
