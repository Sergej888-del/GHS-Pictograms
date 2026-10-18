/**
 * scripts/import-research.ts — loads the PRIVATE research facts (vocabulary v2, store 'private') into
 * directory_research_facts. s112, 2026-10-17.
 *
 * The data file lives OUTSIDE this public repository (default: ../ghs-research/directory-research.json next to the
 * repo folder; override with RESEARCH_FILE). It holds report-only facts — register numbers, size, ownership, deals,
 * vacancies — that never print on a card and must not be published on GitHub.
 *
 * Run from the ghspictograms root (PowerShell, one command at a time):
 *   npm run import:research -- --dry      ← writes nothing, prints the plan
 *   npm run import:research               ← writes
 * Needs .env.local: PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the table has no anon access at all).
 *
 * TIME SERIES. A row is never overwritten with different content: the current row (valid_to null) is closed with
 * today's date and a new row opens. Same content → only checked_on moves forward. A current row whose key is no
 * longer in the file is closed. Identity of a fact (the key):
 *   single-valued kinds  — (entry, kind)                        e.g. job_postings: one current value per vendor
 *   all other kinds      — (entry, kind, label, value, detail)   register numbers, memberships, deals, segments, credentials
 *   (a group can hold two numbers in one register; two associations can share the code «other» and differ by detail).
 *   A changed number or detail closes the old row and opens a new one either way, so the history is the same.
 */
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { VOCAB_VERSION, vocabProblems } from '../src/lib/directoryVocab'

export type ResearchFact = {
  id?: number
  entry_id: number
  kind: string
  label: string | null
  value: string
  detail: string | null
  num: number | null
  num_max: number | null
  unit: string | null
  currency: string | null
  status: 'yes' | 'no' | 'not_stated'
  source_url: string
  evidence: string | null
  checked_on: string
  provided_by: 'editor' | 'owner'
  valid_from?: string
}

const SINGLE = new Set(['entity_type', 'size_band', 'employees', 'revenue_band', 'ownership', 'last_content_date', 'job_postings', 'release', 'coverage_claim'])
const CONTENT: (keyof ResearchFact)[] = ['label', 'value', 'detail', 'num', 'num_max', 'unit', 'currency', 'status', 'source_url', 'evidence']

export function factKey(f: Pick<ResearchFact, 'entry_id' | 'kind' | 'label' | 'value' | 'detail'>): string {
  if (SINGLE.has(f.kind)) return `${f.entry_id}|${f.kind}`
  return `${f.entry_id}|${f.kind}|${f.label ?? ''}|${f.value}|${f.detail ?? ''}`
}

const norm = (v: unknown) => (v === undefined || v === null ? null : typeof v === 'number' ? v : String(v))
export const sameContent = (a: ResearchFact, b: ResearchFact) => CONTENT.every((c) => norm(a[c]) === norm(b[c]))

export type Plan = { keep: { id: number; checked_on: string }[]; close: number[]; open: ResearchFact[] }

/** What the import does, as a pure function (tested without a database). */
export function planResearch(current: ResearchFact[], incoming: ResearchFact[], today: string): Plan {
  const plan: Plan = { keep: [], close: [], open: [] }
  const cur = new Map(current.map((f) => [factKey(f), f]))
  const seen = new Set<string>()
  for (const f of incoming) {
    const k = factKey(f)
    if (seen.has(k)) throw new Error(`two facts with the same key ${k} in the file`)
    seen.add(k)
    const c = cur.get(k)
    if (c && sameContent(c, f)) {
      if (f.checked_on > c.checked_on) plan.keep.push({ id: c.id!, checked_on: f.checked_on })
    } else {
      if (c) plan.close.push(c.id!)
      plan.open.push({ ...f, valid_from: f.checked_on > today ? today : f.checked_on })
    }
  }
  for (const [k, c] of cur) if (!seen.has(k)) plan.close.push(c.id!)
  return plan
}

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

async function main() {
  config({ path: resolve(process.cwd(), '.env.local') })
  config()
  const DRY = process.argv.includes('--dry')
  const FILE = resolve(process.cwd(), process.env.RESEARCH_FILE ?? '../ghs-research/directory-research.json')
  const url = process.env.PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) die('need PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  if (FILE.startsWith(resolve(process.cwd()))) die(`the research file must live outside the public repository: ${FILE}`)

  const data = JSON.parse(readFileSync(FILE, 'utf8')) as { vocab_version: string; facts: ResearchFact[] }
  const bad = data.facts.flatMap((f, i) => vocabProblems(f, 'private').map((p) => `fact ${i} (#${f.entry_id} ${f.kind}): ${p}`))
  const noSource = data.facts.filter((f) => !/^https?:\/\//.test(String(f.source_url ?? '')))
  if (bad.length || noSource.length) die(`file not accepted (vocabulary ${VOCAB_VERSION}):\n  ${[...bad, ...noSource.map((f) => `#${f.entry_id} ${f.kind}: source_url`)].slice(0, 30).join('\n  ')}`)
  console.log(`File: ${data.facts.length} private facts, vocabulary ${data.vocab_version}`)

  const db = createClient(url!, key!, { auth: { persistSession: false } })
  const { data: entries, error: e1 } = await db.from('directory_entries').select('id')
  if (e1) die(`directory_entries: ${e1.message}`)
  const ids = new Set((entries ?? []).map((e) => e.id as number))
  const orphan = data.facts.filter((f) => !ids.has(f.entry_id))
  if (orphan.length) die(`facts for entries that are not in the database (run import:directory first): ${[...new Set(orphan.map((f) => f.entry_id))].join(', ')}`)

  const current: ResearchFact[] = []
  for (let from = 0; ; from += 1000) {
    const { data: chunk, error } = await db.from('directory_research_facts').select('*').is('valid_to', null).order('id').range(from, from + 999)
    if (error) die(`directory_research_facts: ${error.message}`)
    current.push(...((chunk ?? []) as ResearchFact[]))
    if (!chunk || chunk.length < 1000) break
  }
  const today = new Date().toISOString().slice(0, 10)
  const plan = planResearch(current, data.facts, today)
  console.log(`Plan: open ${plan.open.length} · close ${plan.close.length} · unchanged ${current.length - plan.close.length} (checked_on moves on ${plan.keep.length})`)
  if (DRY) { console.log('\n--dry: nothing written.'); return }

  for (let i = 0; i < plan.close.length; i += 300) {
    const { error } = await db.from('directory_research_facts').update({ valid_to: today }).in('id', plan.close.slice(i, i + 300))
    if (error) die(`closing rows: ${error.message}`)
  }
  for (const k of plan.keep) {
    const { error } = await db.from('directory_research_facts').update({ checked_on: k.checked_on }).eq('id', k.id)
    if (error) die(`checked_on #${k.id}: ${error.message}`)
  }
  const rows = plan.open.map(({ id: _id, ...f }) => f)
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await db.from('directory_research_facts').insert(rows.slice(i, i + 300))
    if (error) die(`inserting rows (from ${i}): ${error.message}`)
  }
  console.log(`\n✓ Written: opened ${rows.length}, closed ${plan.close.length}.`)
}

// Runs only when started as a script; tests import planResearch without touching the database.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((e) => die(String(e)))
