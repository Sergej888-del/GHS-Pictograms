/**
 * Импорт UN номеров из PubChem PUG View для веществ без un_number.
 *
 * Запуск из корня ghspictograms:
 *   npx tsx scripts/import-un-numbers.ts
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
const PARALLEL = 5
const BATCH_DELAY_MS = 300
const LOG_EVERY = 50

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Нужны PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local')
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

// Получить CID по CAS номеру
async function fetchCID(cas: string): Promise<number | null> {
  // Метод 1: через /compound/name/
  try {
    const url1 = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(cas.trim())}/cids/JSON`
    const res1 = await fetch(url1)
    if (res1.ok) {
      const json1 = (await res1.json()) as any
      const cid = json1?.IdentifierList?.CID?.[0]
      if (cid) return cid
    }
  } catch {}

  // Метод 2: через /compound/inchikey/ (fallback)
  try {
    const url2 = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/xref/RN/${encodeURIComponent(cas.trim())}/cids/JSON`
    const res2 = await fetch(url2)
    if (res2.ok) {
      const json2 = (await res2.json()) as any
      const cid = json2?.IdentifierList?.CID?.[0]
      if (cid) return cid
    }
  } catch {}

  return null
}

// Получить UN номер из PubChem PUG View по CID (несколько разделов транспортной/регуляторной информации)
async function fetchUNNumber(cid: number): Promise<string | null> {
  const headings = ['Transportation', 'UN Number', 'DOT Information', 'ICAO/IATA', 'Regulatory Information']

  for (const heading of headings) {
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=${encodeURIComponent(heading)}`
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const json = (await res.json()) as Record<string, unknown>

      const strings: string[] = []
      function collectStrings(node: unknown): void {
        if (!node) return
        if (typeof node === 'string') {
          strings.push(node)
          return
        }
        if (Array.isArray(node)) {
          node.forEach(collectStrings)
          return
        }
        if (typeof node === 'object') {
          const o = node as Record<string, unknown>
          if (typeof o.String === 'string') strings.push(o.String)
          if (Array.isArray(o.StringWithMarkup)) {
            for (const s of o.StringWithMarkup) {
              if (s && typeof s === 'object' && 'String' in s) {
                const str = (s as { String?: string }).String
                if (str) strings.push(str)
              }
            }
          }
          Object.values(o).forEach(collectStrings)
        }
      }
      collectStrings(json)

      for (const s of strings) {
        const match =
          s.match(/\bUN\s*(\d{4})\b/i) || s.match(/\bNA\s*(\d{4})\b/i) || s.match(/^(\d{4})$/)
        if (match) return match[1]
      }
    } catch {
      continue
    }
  }
  return null
}

type SubstanceRow = { id: string; cas_number: string }

async function loadSubstances(): Promise<SubstanceRow[]> {
  const all: SubstanceRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('substances')
      .select('id, cas_number')
      .not('cas_number', 'is', null)
      .is('un_number', null)
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(`Supabase: ${error.message}`)
    if (!data?.length) break
    all.push(...(data as SubstanceRow[]))
    if (data.length < PAGE_SIZE) break
  }
  return all
}

async function main(): Promise<void> {
  // Тест на известном веществе — ацетон CAS 67-64-1, должен вернуть UN 1090
  const testCID = await fetchCID('67-64-1')
  console.log(`Тест: CID ацетона = ${testCID}`)
  if (testCID) {
    const testUN = await fetchUNNumber(testCID)
    console.log(`Тест: UN ацетона = ${testUN} (ожидается 1090)`)
  }

  let updated = 0
  let notFound = 0
  let errors = 0

  const rows = await loadSubstances()
  console.log(`Веществ без UN номера: ${rows.length}`)

  let done = 0
  for (const chunk of chunkArray(rows, PARALLEL)) {
    await Promise.all(
      chunk.map(async (row) => {
        try {
          // Этап 1: получить CID
          const cid = await fetchCID(row.cas_number)
          if (!cid) {
            notFound++
            return
          }

          // Этап 2: получить UN номер
          const unNumber = await fetchUNNumber(cid)
          if (!unNumber) {
            notFound++
            return
          }

          // Этап 3: сохранить в БД
          const { error } = await supabase.from('substances').update({ un_number: unNumber }).eq('id', row.id)

          if (error) {
            console.error(`DB error id=${row.id}: ${error.message}`)
            errors++
          } else {
            updated++
            console.log(`✓ ${row.cas_number} → UN ${unNumber}`)
          }
        } catch (e) {
          errors++
          console.error(`Row id=${row.id}:`, e instanceof Error ? e.message : e)
        }
      })
    )

    done += chunk.length
    if (done % LOG_EVERY === 0 || done === rows.length) {
      console.log(`Прогресс: ${done}/${rows.length} | Найдено UN: ${updated}`)
    }
    await sleep(BATCH_DELAY_MS)
  }

  console.log('--- Итог ---')
  console.log(`Обновлено UN номеров: ${updated}`)
  console.log(`Не найдено: ${notFound}`)
  console.log(`Ошибок: ${errors}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
