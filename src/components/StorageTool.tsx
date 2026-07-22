// Chemical Storage Compatibility Matrix — interactive island (2c, rev3)
// Left: hazard chips + fuzzy search (name / CAS / EC) over clean-CAS substances.
// Right: live verdict from supabase.rpc('get_storage_verdict').
// Segregation + ADR panels are live; reactivity/predicted-gases are placeholdered
// until the CAMEO gas curation pass lands.
// rev2: ADR form picker is keyed by ROW INDEX (not UN — multiple rows can share a
// UN) and de-duplicates identical rows.
// rev3: CAMEO special-hazard flags — warning badges (1c) + they count as a danger
// signal for the "no class" note; and cameo_known drives a "check CAMEO" branch
// for substances CAMEO doesn't know (1d). Needs get_storage_verdict v3.
// rev4 (P3): segregation pills are interactive — click a "never/keep-separate"
// class to preview 6 of its substances inline (get_class_substances) + link to
// its /storage-compatibility/<slug>/ page. Own-class badges link to that page.
// Class labels/slugs now come from the shared storageClasses module (de-dup).
// rev5 (design): teal signature — filter chips, focus, ADR picker, preview links
// switch navy->teal; segregation pills gain hover depth. Semantics (red/amber/
// green) unchanged. ADR strip stays navy (transport).
import { useEffect, useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import { supabase } from '../lib/supabase'
import { shortForCode, urlForCode } from '../lib/storageClasses'

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
  cameo_known: boolean
  name: string | null
  signal_word: string | null
  is_corrosive_h314: boolean
  classes: string[]
  class_names: { code: string; name: string }[]
  reactive_groups: string[]
  special_flags: string[]
  segregation: SegItem[]
  predicted_gases: { label: string; toxic: boolean }[]
  reactivity: { reacts_with: string; status: string; hazard_codes: string[]; gases: { label: string; toxic: boolean }[] }[]
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

// Class labels (short) + category-page URLs now come from ../lib/storageClasses
// (shortForCode / urlForCode) — single source of truth shared with the pages.

// Inline preview of a storage class's substances (P3 pill expansion).
interface ClassPreview {
  sc_code: string
  total: number
  items: { cas: string; name: string; signal_word: string | null }[]
}

// Short badge labels for CAMEO special-hazard flags (canonical DB string ->
// display). Unknown flags fall back to the raw string.
const FLAG_LABELS: Record<string, string> = {
  'Highly Flammable': 'Highly Flammable',
  'Water-Reactive': 'Water-Reactive',
  'Strong Oxidizing Agent': 'Strong Oxidizer',
  'Strong Reducing Agent': 'Strong Reducer',
  'Explosive': 'Explosive',
  'Peroxidizable Compound': 'Peroxidizable',
  'Polymerizable': 'Polymerizable',
  'Air-Reactive': 'Air-Reactive',
  'Pyrophoric': 'Pyrophoric',
  'Known Catalytic Activity': 'Catalytic',
  'Decomposes at Elevated Temperatures (<120 deg. C)': 'Decomposes <120 °C',
  'Radioactive Material': 'Radioactive',
}
const flagLabel = (f: string) => FLAG_LABELS[f] ?? f

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

  // P3: inline class preview (which class pill is open + cache + loading).
  const [activeClass, setActiveClass] = useState<string | null>(null)
  const [classCache, setClassCache] = useState<Record<string, ClassPreview>>({})
  const [classLoading, setClassLoading] = useState(false)

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
    setActiveClass(null)
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

  // Danger signals that make an unclassified substance NOT safe to call "general
  // practice": CAMEO special-hazard flags, acutely-toxic predicted gases, or a
  // high-risk ADR transport class (1 explosive, 4.1/4.2/4.3 reactive solids,
  // 5.1/5.2 oxidizers/peroxides).
  const hasSpecialFlags = (verdict?.special_flags ?? []).length > 0
  const hasToxicGas = (verdict?.predicted_gases ?? []).some(g => g.toxic)
  const DANGEROUS_ADR = ['1', '4.1', '4.2', '4.3', '5.1', '5.2']
  const hasDangerousAdr = (verdict?.adr ?? []).some(
    a => a.class != null && DANGEROUS_ADR.includes(a.class),
  )
  const unclassifiedButRisky = !!verdict && verdict.classes.length === 0 &&
    !verdict.is_corrosive_h314 && (hasSpecialFlags || hasToxicGas || hasDangerousAdr)

  // P3: open/close a class preview; fetch (and cache) 6 substances on first open.
  async function togglePreview(code: string) {
    if (activeClass === code) {
      setActiveClass(null)
      return
    }
    setActiveClass(code)
    if (!classCache[code]) {
      setClassLoading(true)
      const { data } = await supabase.rpc('get_class_substances', { p_sc_code: code, p_limit: 6 })
      if (data) setClassCache(prev => ({ ...prev, [code]: data as ClassPreview }))
      setClassLoading(false)
    }
  }

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
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-teal-500'
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
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
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
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-teal-500'
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
                    <a
                      key={c.code}
                      href={urlForCode(c.code)}
                      className="inline-flex items-center rounded-md bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-200 transition-colors"
                    >
                      {shortForCode(c.code)}
                    </a>
                  ))}
                </div>
              )}
              {/* CAMEO special-hazard flags (intrinsic to the substance) */}
              {verdict.special_flags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {verdict.special_flags.map(f => (
                    <span key={f} className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800">
                      <span aria-hidden="true">⚠</span> {flagLabel(f)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* no-class / corrosive note (context-aware) */}
            {verdict.classes.length === 0 && (
              verdict.is_corrosive_h314 ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  Corrosive (GHS H314) — acid vs. base could not be determined automatically. Verify against SDS section 10 before co-storage.
                </div>
              ) : unclassifiedButRisky ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  No storage class was derived from this substance's GHS codes, but it is not inert.
                  {hasSpecialFlags && (
                    <> CAMEO flags it as <strong>{verdict.special_flags.map(flagLabel).join(', ')}</strong>.</>
                  )}
                  {(hasToxicGas || hasDangerousAdr) && (
                    <> It shows hazardous reactivity{hasDangerousAdr ? ' and a high-risk transport class' : ''} (see below).</>
                  )}
                  {' '}Do not treat it as safe to co-store — verify against SDS sections 7 and 10.
                </div>
              ) : !verdict.cameo_known ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  No storage class was derived from its GHS codes, and this substance isn't in CAMEO's reactivity
                  database — so reactive hazards can't be ruled out automatically. Before storing, look it up in{' '}
                  <a
                    href="https://cameochemicals.noaa.gov/search/simple"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline underline-offset-2 hover:text-amber-900"
                  >
                    CAMEO Chemicals (NOAA)
                  </a>{' '}
                  (search CAS {verdict.cas}) and verify against SDS sections 7 and 10.
                </div>
              ) : (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  No special storage segregation class from its GHS codes. Store per general good practice and verify against SDS section 7.
                </div>
              )
            )}

            {/* never store with */}
            {never.length > 0 && (
              <section>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-red-700">
                  <span aria-hidden="true">⛔</span> Never store with
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {never.map(s => (
                    <button
                      key={s.class}
                      type="button"
                      onClick={() => togglePreview(s.class)}
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-sm transition-all hover:shadow-sm ${
                        activeClass === s.class
                          ? 'border-red-400 bg-red-100 text-red-800 ring-2 ring-red-200'
                          : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                      }`}
                    >
                      {shortForCode(s.class)}
                    </button>
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
                    <button
                      key={s.class}
                      type="button"
                      onClick={() => togglePreview(s.class)}
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-sm transition-all hover:shadow-sm ${
                        activeClass === s.class
                          ? 'border-amber-400 bg-amber-100 text-amber-900 ring-2 ring-amber-200'
                          : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                      }`}
                    >
                      {shortForCode(s.class)}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* P3: inline class preview (opens under the segregation pills) */}
            {activeClass && (never.length > 0 || separate.length > 0) && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">
                    In {shortForCode(activeClass)}
                    {classCache[activeClass] ? ` (${classCache[activeClass].total})` : ''}
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveClass(null)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                    aria-label="Close preview"
                  >
                    ✕
                  </button>
                </div>
                {classLoading && !classCache[activeClass] ? (
                  <p className="mt-2 text-sm text-gray-500">Loading…</p>
                ) : classCache[activeClass] ? (
                  <>
                    <ul className="mt-2 space-y-1">
                      {classCache[activeClass].items.map(it => (
                        <li key={it.cas}>
                          <button
                            type="button"
                            onClick={() => setSelectedCas(it.cas)}
                            className="text-left text-sm text-teal-700 hover:underline"
                          >
                            {it.name}
                            <span className="ml-1 font-mono text-xs text-gray-400">{it.cas}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <a
                      href={urlForCode(activeClass)}
                      className="mt-2 inline-block text-sm font-semibold text-teal-700 hover:underline"
                    >
                      View all {classCache[activeClass].total} in {shortForCode(activeClass)} →
                    </a>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-gray-500">No preview available.</p>
                )}
              </div>
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

            {/* gas release on contact — attributed to the incompatible class that triggers it (CAMEO, curated) */}
            {(verdict.reactivity ?? []).some(r => (r.gases?.length ?? 0) > 0) && (
              <section>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                  <span aria-hidden="true">☁️</span> Gas release on contact
                </h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {verdict.reactivity
                    .filter(r => (r.gases?.length ?? 0) > 0)
                    .map(r => (
                      <li key={r.reacts_with} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="text-gray-600">With <span className="font-medium text-gray-800">{r.reacts_with}</span></span>
                        <span aria-hidden="true" className="text-gray-400">→</span>
                        <span className="flex flex-wrap gap-1.5">
                          {r.gases.map(g => (
                            <span
                              key={g.label}
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm border ${
                                g.toxic
                                  ? 'bg-red-50 text-red-700 border-red-200'
                                  : 'bg-gray-100 text-gray-700 border-gray-200'
                              }`}
                            >
                              {g.label}
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                </ul>
                <p className="mt-2 text-xs text-gray-400">
                  Each gas is shown with the class that triggers it — released only on contact, never by the substance alone. Where CAMEO lists both a specific gas (HCl) and the general form (hydrogen halide), both appear. Red = acutely toxic.
                </p>
              </section>
            )}

            <p className="text-xs leading-relaxed text-gray-400">
              Reference aid only — always verify storage against the substance's SDS (sections 7 and 10) and local regulations.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
