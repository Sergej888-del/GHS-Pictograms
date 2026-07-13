// Chemical Storage Compatibility Matrix — interactive island (2c, rev2)
// Left: hazard chips + fuzzy search (name / CAS / EC) over clean-CAS substances.
// Right: live verdict from supabase.rpc('get_storage_verdict').
// Segregation + ADR panels are live; reactivity/predicted-gases are placeholdered
// until the CAMEO gas curation pass lands.
// rev2: ADR form picker is keyed by ROW INDEX (not UN — multiple rows can share a
// UN) and de-duplicates identical rows.
import { useEffect, useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import { supabase } from '../lib/supabase'

interface SubstanceRow {
  cas_number: string
  iupac_name: string
  ec_number: string | null
  ghs_pictogram_codes: string[] | null
}
interface IndexedSubstance extends SubstanceRow {
  cas_nodash: string
  name_norm: string
}
interface SegItem {
  class: string
  name: string
  status: 'prohibited' | 'separate' | 'compatible'
}
interface AdrItem {
  un: string
  class: string | null
  pg: string | null
  name: string | null
}
interface Verdict {
  cas: string
  found: boolean
  name: string | null
  signal_word: string | null
  is_corrosive_h314: boolean
  classes: string[]
  class_names: { code: string; name: string }[]
  reactive_groups: string[]
  segregation: SegItem[]
  adr: AdrItem[]
}

// Hazard chips narrow the list by GHS pictogram (coarse pre-filter; the exact
// verdict always comes from the RPC on selection).
const HAZARD_CHIPS: { label: string; pic: string | null }[] = [
  { label: 'All', pic: null },
  { label: 'Flammable', pic: 'GHS02' },
  { label: 'Oxidizer', pic: 'GHS03' },
  { label: 'Corrosive', pic: 'GHS05' },
  { label: 'Toxic', pic: 'GHS06' },
  { label: 'Reactive', pic: 'GHS01' },
  { label: 'Gas', pic: 'GHS04' },
]

// Short display labels for the 13 storage classes (pills + badges).
const SHORT_LABELS: Record<string, string> = {
  OXID: 'Oxidizers',
  WATER_RX: 'Water-reactives',
  FLAM_LIQ: 'Flammable liquids',
  GAS: 'Compressed gases',
  ORG_PEROX: 'Organic peroxides',
  OX_ACID: 'Oxidizing acids',
  ORG_ACID: 'Organic acids',
  MIN_ACID: 'Mineral acids',
  BASE: 'Bases',
  REACT_METAL: 'Reactive metals',
  TOXIC: 'Acute toxics',
  CN_S: 'Cyanides & sulfides',
  FLAM_SOL: 'Flammable solids',
}
const short = (code: string) => SHORT_LABELS[code] ?? code

// Normalize US/UK spelling so `sulfuric` finds `sulphuric`, etc. Applied to both
// the indexed names and the query. Covers the common chemistry pairs.
function norm(str: string | null | undefined): string {
  return (str ?? '')
    .toLowerCase()
    .replace(/sulph/g, 'sulf')
    .replace(/aluminium/g, 'aluminum')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function StorageTool() {
  const [all, setAll] = useState<IndexedSubstance[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState('All')

  const [selectedCas, setSelectedCas] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [verdictLoading, setVerdictLoading] = useState(false)
  const [selectedAdrIdx, setSelectedAdrIdx] = useState(0)

  // Load all clean-CAS substances once (same runtime pattern as the browse tool).
  useEffect(() => {
    let cancelled = false
    async function loadAll() {
      const rows: IndexedSubstance[] = []
      let from = 0
      const size = 1000
      while (true) {
        const { data, error } = await supabase
          .from('substances')
          .select('cas_number, iupac_name, ec_number, ghs_pictogram_codes')
          .not('cas_number', 'is', null)
          .order('cas_number', { ascending: true })
          .range(from, from + size - 1)
        if (error || !data || data.length === 0) break
        for (const r of data as SubstanceRow[]) {
          const cas = r.cas_number?.trim()
          if (!cas || cas === '-' || cas.includes('[')) continue
          rows.push({ ...r, cas_number: cas, cas_nodash: cas.replace(/-/g, ''), name_norm: norm(r.iupac_name) })
        }
        if (data.length < size) break
        from += size
      }
      if (!cancelled) {
        setAll(rows)
        setLoading(false)
      }
    }
    loadAll()
    return () => {
      cancelled = true
    }
  }, [])

  // Deep-link: read ?substance=CAS on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const s = new URLSearchParams(window.location.search).get('substance')?.trim()
    if (s) setSelectedCas(s)
  }, [])

  const fuse = useMemo(
    () =>
      new Fuse(all, {
        keys: [
          { name: 'name_norm', weight: 2 },
          { name: 'iupac_name', weight: 2 },
          { name: 'cas_number', weight: 1.5 },
          { name: 'cas_nodash', weight: 1.5 },
          { name: 'ec_number', weight: 1 },
        ],
        threshold: 0.2,
        minMatchCharLength: 2,
        ignoreLocation: true,
        includeScore: true,
      }),
    [all],
  )

  const filtered = useMemo(() => {
    const q = norm(query)
    let list = q.length >= 2 ? fuse.search(q).map(r => r.item) : all
    const pic = HAZARD_CHIPS.find(c => c.label === chip)?.pic
    if (pic) list = list.filter(s => (s.ghs_pictogram_codes ?? []).includes(pic))
    return list
  }, [query, chip, all, fuse])

  const shown = filtered.slice(0, 60)

  // Fetch the verdict whenever the selected CAS changes; keep the URL shareable.
  useEffect(() => {
    if (!selectedCas) {
      setVerdict(null)
      return
    }
    let cancelled = false
    setVerdictLoading(true)
    setSelectedAdrIdx(0)
    supabase
      .rpc('get_storage_verdict', { p_cas: selectedCas })
      .then(({ data, error }) => {
        if (cancelled) return
        setVerdict(error || !data ? null : (data as Verdict))
        setVerdictLoading(false)
      })

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('substance', selectedCas)
      window.history.replaceState({}, '', url)
    }
    return () => {
      cancelled = true
    }
  }, [selectedCas])

  const never = verdict?.segregation.filter(s => s.status === 'prohibited') ?? []
  const separate = verdict?.segregation.filter(s => s.status === 'separate') ?? []

  // De-duplicate ADR rows: identical (un, pg, name) collapse to one; genuinely
  // different forms (e.g. by packing group or shipping-name variant) stay.
  const adrList = useMemo(() => {
    const seen = new Set<string>()
    const out: AdrItem[] = []
    for (const a of verdict?.adr ?? []) {
      const k = `${a.un}|${a.pg ?? ''}|${a.name ?? ''}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push(a)
    }
    return out
  }, [verdict])
  const activeAdr = adrList[selectedAdrIdx] ?? adrList[0] ?? null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6">
      {/* LEFT — filter + search + list (+ ADR form picker) */}
      <aside className="lg:sticky lg:top-20 self-start space-y-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Filter by hazard</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {HAZARD_CHIPS.map(c => (
              <button
                key={c.label}
                type="button"
                onClick={() => setChip(c.label)}
                className={`inline-flex items-center rounded-full px-3 py-1 text-sm border transition-colors ${
                  chip === c.label
                    ? 'bg-[#1e3a8a] text-white border-[#1e3a8a]'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-[#1e3a8a]'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="mt-4">
            <label htmlFor="storage-search" className="sr-only">Search by name, CAS, or EC number</label>
            <input
              id="storage-search"
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search name, CAS, or EC number…"
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-[#1e3a8a] focus:ring-2 focus:ring-[#1e3a8a]/20 outline-none"
            />
          </div>

          <p className="mt-2.5 text-xs text-gray-500">
            {loading ? 'Loading substances…' : `${filtered.length} of ${all.length} substances`}
          </p>

          {!loading && (
            <ul className="mt-2 max-h-96 overflow-y-auto divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
              {shown.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-gray-400">No substances match.</li>
              ) : (
                shown.map(s => (
                  <li key={s.cas_number}>
                    <button
                      type="button"
                      onClick={() => setSelectedCas(s.cas_number)}
                      className={`w-full text-left px-3 py-2.5 transition-colors hover:bg-gray-50 ${
                        selectedCas === s.cas_number ? 'bg-blue-50' : ''
                      }`}
                    >
                      <span className="block text-sm font-medium text-gray-900 truncate">{s.iupac_name}</span>
                      <span className="block text-xs text-gray-500">
                        {s.cas_number}
                        {s.ec_number ? ` · EC ${s.ec_number}` : ''}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {verdict?.found && adrList.length > 1 && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Ships in several forms — pick one</p>
            <div className="mt-2.5 space-y-1.5">
              {adrList.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedAdrIdx(i)}
                  className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                    selectedAdrIdx === i
                      ? 'bg-[#1e3a8a] text-white border-[#1e3a8a]'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-[#1e3a8a]'
                  }`}
                >
                  <span className="block text-sm font-semibold">
                    UN {a.un}
                    {a.pg ? ` · PG ${a.pg}` : ''}
                  </span>
                  {a.name && (
                    <span className={`block text-xs truncate ${selectedAdrIdx === i ? 'text-blue-100' : 'text-gray-500'}`}>
                      {a.name}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* RIGHT — verdict */}
      <div>
        {!selectedCas ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
            <p className="text-base font-medium text-gray-700">Pick a substance to see its storage verdict</p>
            <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
              You'll see what to never store with, what to keep separate, and its ADR transport class.
            </p>
          </div>
        ) : verdictLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white px-6 py-10">
            <p className="text-sm text-gray-500 text-center">Loading verdict…</p>
          </div>
        ) : !verdict || !verdict.found ? (
          <div className="rounded-xl border border-gray-200 bg-white px-6 py-8">
            <p className="text-base font-medium text-gray-700">No storage data for this CAS</p>
            <p className="mt-1 text-sm text-gray-500">
              We don't have a record for {selectedCas}. Check the number, or search by name.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* header */}
            <div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-xl font-bold text-gray-900" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  {verdict.name ?? selectedCas}
                </h2>
                <span className="text-sm font-mono text-gray-400">{verdict.cas}</span>
              </div>
              {verdict.class_names.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {verdict.class_names.map(c => (
                    <span key={c.code} className="inline-flex items-center rounded-md bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                      {short(c.code)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* no-class / corrosive note */}
            {verdict.classes.length === 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                {verdict.is_corrosive_h314
                  ? 'Corrosive (GHS H314) — acid vs. base could not be determined automatically. Verify against SDS section 10 before co-storage.'
                  : 'No special storage segregation class from its GHS codes. Store per general good practice and verify against SDS section 7.'}
              </div>
            )}

            {/* never store with */}
            {never.length > 0 && (
              <section>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
                  <span aria-hidden="true">⛔</span> Never store with
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {never.map(s => (
                    <span key={s.class} className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-sm text-red-700">
                      {short(s.class)}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* keep separate */}
            {separate.length > 0 && (
              <section>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                  <span aria-hidden="true">↔</span> Keep separate
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {separate.map(s => (
                    <span key={s.class} className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm text-amber-800">
                      {short(s.class)}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* ADR */}
            {activeAdr && (
              <section>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                  <span aria-hidden="true">🚚</span> ADR transport
                </h3>
                <div className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-lg bg-[#0f2557] px-4 py-2.5 text-sm text-white">
                  <span className="font-semibold">UN {activeAdr.un}</span>
                  {activeAdr.class && (
                    <>
                      <span className="text-blue-300">·</span>
                      <span>Class {activeAdr.class}</span>
                    </>
                  )}
                  {activeAdr.pg && (
                    <>
                      <span className="text-blue-300">·</span>
                      <span>PG {activeAdr.pg}</span>
                    </>
                  )}
                </div>
                {activeAdr.name && <p className="mt-1.5 text-xs text-gray-500">{activeAdr.name}</p>}
              </section>
            )}

            {/* reactivity / predicted gases — placeholdered until curation */}
            <section className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
              <p className="text-sm font-medium text-gray-600">Reactivity &amp; predicted gases</p>
              <p className="mt-0.5 text-xs text-gray-500">
                In preparation — we're curating CAMEO reaction data for accuracy before showing it here.
              </p>
            </section>

            <p className="text-xs leading-relaxed text-gray-400">
              Reference aid only — always verify storage against the substance's SDS (sections 7 and 10) and local regulations.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
