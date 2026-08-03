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
// rev6 (tool ↔ /sds/ linkage, owed since session 6): (a) common_name + synonyms
// join the Fuse index and the list shows the common name ("gasoline", not the
// Annex VI UVCB monster string); (b) bracketed multi-CAS rows (heptane, xylene,
// MDI, TDI, boric acid) are now INCLUDED when a live /sds/ page provides their
// canonical display CAS — the RPC still gets the substances.cas_number key,
// which get_storage_verdict v5 resolves via substance_cas_alias; (c) verdict
// header gains a "Full substance report →" link to the live /sds/<slug>/ page
// (109 live targets), slug matched via sds_pages.substance_id OR either CAS form.
// rev7: SDS Manager affiliate link inside the "Reference aid only" disclaimer
// callout (management intent; fp_sid=gpmgmt reused per the session-9 decision)
// + GA affiliate_click. Hazard copy in the callout is UNCHANGED — placement,
// not pressure (CLAUDE.md §8).
// rev8 (design v2, session 15): the island now speaks the hub vocabulary —
// square mono badges instead of pills, white .tool-panel cards, mono eyebrows
// instead of emoji headings, and the SAME .hub-deck / .hub-pairs components the
// hub and the 13 category pages use for the verdict cards. Verdict semantics
// (rose / amber / teal) and every existing string are unchanged; the storage
// class badge now carries its hazard-family colour (Sergej's call). The gas
// list collapses to 6 rows behind a "show all" toggle — 47 rows for sulfuric
// acid was a screen of scroll. NOTE: the "Generally compatible" card the pages
// carry is deliberately NOT here yet — get_storage_verdict lists a substance's
// OWN class among the "other" classes for multi-class substances (162 rows
// affected), so a compatible card would claim e.g. a cyanide is compatible with
// cyanides. Add it together with the RPC fix (queued).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import { supabase } from '../lib/supabase'
import { shortForCode, urlForCode, familyBadgeForCode } from '../lib/storageClasses'
import { substanceNameFull, truncateName } from '../lib/substanceName'

// SDS Manager affiliate — the callout already tells the reader to verify against
// the SDS; this link serves that exact moment. GA separates placements via the
// affiliate_click `placement` param even though the fp_sid is shared with ATE.
const SDS_MANAGEMENT_URL = 'https://sdsmanager.com/us/sds-management?fpr=ghs3&fp_sid=gpmgmt'
function track(event: string, params: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
    ;(window as any).gtag('event', event, params)
  }
}

interface SubstanceRow {
  id: string
  cas_number: string
  iupac_name: string
  common_name: string | null
  display_name_short: string | null
  synonyms: string[] | null
  ec_number: string | null
  ghs_pictogram_codes: string[] | null
}
interface IndexedSubstance extends SubstanceRow {
  cas_nodash: string
  name_norm: string
  /** substanceNameFull(): common_name → display_name_short → iupac_name */
  display_name: string
  display_norm: string
  /** normalized synonyms, joined for the Fuse index */
  syn_norm: string
  /** clean CAS for display/search (canonical page CAS for bracketed rows) */
  display_cas: string
  /** slug of the live /sds/ page, when one exists */
  sdsSlug: string | null
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

// Verdict cards — the same copy the category pages carry, so the tool and
// /storage-compatibility/<class>/ describe a verdict in identical words.
const DECK_NEVER = {
  badge: 'Never store',
  note: 'hard stop',
  title: 'Never store with',
  head: 'Separate cabinet, bund or room',
  acc: '#e11d48',
  ink: '#9f1239',
  line: '#fecdd3',
  soft: '#fff1f2',
}
const DECK_SEPARATE = {
  badge: 'Keep separate',
  note: 'distance control',
  title: 'Keep separate',
  head: 'Distance, bund or separate tray',
  acc: '#d97706',
  ink: '#92400e',
  line: '#fde68a',
  soft: '#fffbeb',
}

// How many reactivity rows are visible before the "show all" toggle.
const GAS_PREVIEW_ROWS = 6

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

  // rev8: the reactivity list starts collapsed (47 rows for sulfuric acid).
  const [gasOpen, setGasOpen] = useState(false)

  // rev8: picking a substance from deep inside the page (a class preview, or the
  // sticky list while scrolled down) used to leave the reader where they were,
  // with the new substance's name off screen. Every USER-driven selection now
  // scrolls the verdict column back into view; a ?substance= deep link does not
  // (setSelectedCas is called directly there, so the page loads where it should).
  const verdictRef = useRef<HTMLDivElement | null>(null)
  function selectSubstance(cas: string) {
    setSelectedCas(cas)
    if (typeof window === 'undefined') return
    requestAnimationFrame(() => {
      verdictRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  // Load all substances once (same runtime pattern as the browse tool).
  // rev6: live /sds/ pages load first (one small query) so each row can carry
  // its report slug; bracketed multi-CAS rows join the list via their page's
  // canonical CAS instead of being skipped.
  useEffect(() => {
    let cancelled = false
    async function loadAll() {
      // 1. Live /sds/ page registry → slug by substance_id + by CAS (both forms).
      const bySubstanceId = new Map<string, { slug: string; cas: string }>()
      const slugByPageCas = new Map<string, string>()
      {
        const { data } = await supabase
          .from('sds_pages')
          .select('slug, cas_number, substance_id')
          .eq('status', 'live')
        for (const p of data ?? []) {
          if (p.substance_id) bySubstanceId.set(p.substance_id, { slug: p.slug, cas: p.cas_number })
          if (p.cas_number) slugByPageCas.set(p.cas_number, p.slug)
        }
      }

      const rows: IndexedSubstance[] = []
      let from = 0
      const size = 1000
      while (true) {
        const { data, error } = await supabase
          .from('substances')
          .select('id, cas_number, iupac_name, common_name, display_name_short, synonyms, ec_number, ghs_pictogram_codes')
          .not('cas_number', 'is', null)
          .order('cas_number', { ascending: true })
          .range(from, from + size - 1)
        if (error || !data || data.length === 0) break
        for (const r of data as SubstanceRow[]) {
          const cas = r.cas_number?.trim()
          if (!cas || cas === '-') continue
          const page = bySubstanceId.get(r.id) ?? null
          // Bracketed multi-CAS rows only make sense with a canonical CAS from
          // their live page; without one they stay out (as before rev6).
          if (cas.includes('[') && !page) continue
          const displayCas = cas.includes('[') ? page!.cas : cas
          const displayName = substanceNameFull(r)
          rows.push({
            ...r,
            cas_number: cas,
            cas_nodash: displayCas.replace(/-/g, ''),
            name_norm: norm(r.iupac_name),
            display_name: displayName,
            display_norm: norm(displayName),
            syn_norm: (r.synonyms ?? []).map(norm).filter(Boolean).join(' | '),
            display_cas: displayCas,
            sdsSlug: page?.slug ?? slugByPageCas.get(cas) ?? null,
          })
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
          { name: 'display_norm', weight: 2.5 },
          { name: 'name_norm', weight: 2 },
          { name: 'iupac_name', weight: 2 },
          { name: 'syn_norm', weight: 1.5 },
          { name: 'cas_number', weight: 1.5 },
          { name: 'display_cas', weight: 1.5 },
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
    setGasOpen(false)
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
  // Denominator for the verdict cards: the classes this substance actually has a
  // verdict against, so never + separate + compatible always add up to it.
  const otherClasses = verdict?.segregation.length ?? 0

  // rev6: the selected row (if the selection came from the list) and the live
  // /sds/ report slug for it. Deep links (?substance=CAS) may arrive with either
  // CAS form — try the row match first, then either CAS column of the registry.
  const selectedRow = useMemo(
    () => (selectedCas ? all.find(s => s.cas_number === selectedCas || s.display_cas === selectedCas) ?? null : null),
    [all, selectedCas],
  )
  const selectedSlug = selectedRow?.sdsSlug ?? null
  const displayName = selectedRow?.display_name ?? verdict?.name ?? selectedCas ?? ''

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

  // Reactivity rows that actually carry a curated gas.
  const gasRows = useMemo(
    () => (verdict?.reactivity ?? []).filter(r => (r.gases?.length ?? 0) > 0),
    [verdict],
  )
  const gasShown = gasOpen ? gasRows : gasRows.slice(0, GAS_PREVIEW_ROWS)

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

  // Section numbers depend on which sections this substance actually has
  // (same pad() pattern as the category pages).
  let sn = 0
  const pad = () => String(++sn).padStart(2, '0')
  const nSeg = never.length > 0 || separate.length > 0 ? pad() : null
  const nAdr = activeAdr ? pad() : null
  const nGas = gasRows.length > 0 ? pad() : null

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

  // One verdict card — the .hub-deck component the hub and category pages use.
  function deckCard(d: typeof DECK_NEVER, items: SegItem[]) {
    return (
      <div
        className="hub-deck-card"
        style={{ ['--c-acc' as any]: d.acc, ['--c-ink' as any]: d.ink, ['--c-line' as any]: d.line, ['--c-soft' as any]: d.soft }}
      >
        <div className="hub-deck-badges">
          <span className="hub-deck-badge">{d.badge}</span>
          <span className="hub-deck-note">{d.note}</span>
        </div>
        <h3>{d.title}</h3>
        <div className="hub-deck-stat">
          <span className="num">{items.length}</span>
          <span className="of">of the {otherClasses} other classes</span>
        </div>
        <div className="hub-deck-bar">
          <span style={{ width: `${Math.round((items.length / Math.max(otherClasses, 1)) * 100)}%` }} />
        </div>
        <div className="hub-pairs">
          <div className="hub-pairs-head"><span>{d.head}</span><span>{items.length}</span></div>
          {items.map(s => {
            const open = activeClass === s.class
            const preview = classCache[s.class]
            return (
              <Fragment key={s.class}>
                <button
                  type="button"
                  onClick={() => togglePreview(s.class)}
                  className={open ? 'hub-pair is-open' : 'hub-pair'}
                  aria-expanded={open}
                >
                  <span className="a">{shortForCode(s.class)}</span>
                  <span className="v arrow" aria-hidden="true">→</span>
                </button>
                {/* The class preview opens right under the row it belongs to.
                    It used to render below the whole deck, which pushed it off
                    screen whenever the "never" card was tall (Sergej, s15). */}
                {open && (
                  <div className="tool-pop">
                    {classLoading && !preview ? (
                      <p className="e">Loading…</p>
                    ) : preview ? (
                      <>
                        <p className="t">In {shortForCode(s.class)} · {preview.total} substances</p>
                        <ul>
                          {preview.items.map(it => (
                            <li key={it.cas}>
                              <button type="button" onClick={() => selectSubstance(it.cas)}>
                                {it.name}
                                <span className="c">{it.cas}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        <a href={urlForCode(s.class)} className="tool-preview-all">
                          View all {preview.total} in {shortForCode(s.class)} →
                        </a>
                      </>
                    ) : (
                      <p className="e">No preview available.</p>
                    )}
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="tool-grid">
      {/* LEFT — filter + search + list (+ ADR form picker) */}
      <aside className="tool-side">
        <div className="tool-panel">
          <p className="tool-label">Filter by hazard</p>
          <div className="tool-chips">
            {HAZARD_CHIPS.map(c => (
              <button
                key={c.label}
                type="button"
                onClick={() => setChip(c.label)}
                className={chip === c.label ? 'tool-chip on' : 'tool-chip'}
              >
                {c.label}
              </button>
            ))}
          </div>

          <label htmlFor="storage-search" className="sr-only">Search by name, CAS, or EC number</label>
          <input
            id="storage-search"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search name, CAS, or EC number…"
            className="tool-search"
          />

          <p className="tool-count">
            {loading ? 'Loading substances…' : `${filtered.length} of ${all.length} substances`}
          </p>

          {!loading && (
            <ul className="tool-list">
              {shown.length === 0 ? (
                <li className="tool-empty">No substances match.</li>
              ) : (
                shown.map(s => (
                  <li key={s.cas_number}>
                    <button
                      type="button"
                      onClick={() => selectSubstance(s.cas_number)}
                      className={selectedCas === s.cas_number ? 'tool-row on' : 'tool-row'}
                    >
                      <span className="n" title={s.display_name}>{truncateName(s.display_name)}</span>
                      <span className="m">
                        {s.display_cas}
                        {s.ec_number ? ` · EC ${s.ec_number}` : ''}
                        {s.sdsSlug ? ' · report available' : ''}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {verdict?.found && adrList.length > 1 && (
          <div className="tool-panel">
            <p className="tool-label">Ships in several forms — pick one</p>
            {adrList.map((a, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedAdrIdx(i)}
                className={selectedAdrIdx === i ? 'tool-form on' : 'tool-form'}
              >
                <span className="u">
                  UN {a.un}
                  {a.pg ? ` · PG ${a.pg}` : ''}
                </span>
                {a.name && <span className="d">{a.name}</span>}
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* RIGHT — verdict */}
      <div ref={verdictRef} className="tool-verdict">
        {!selectedCas ? (
          <div className="tool-blank">
            <p className="t">Pick a substance to see its storage verdict</p>
            <p className="s">
              You'll see what to never store with, what to keep separate, and its ADR transport class.
            </p>
          </div>
        ) : verdictLoading ? (
          <div className="tool-blank">
            <p className="s">Loading verdict…</p>
          </div>
        ) : !verdict || !verdict.found ? (
          <div className="tool-blank">
            <p className="t">No storage data for this CAS</p>
            <p className="s">
              We don't have a record for {selectedCas}. Check the number, or search by name.
            </p>
          </div>
        ) : (
          <div>
            {/* header */}
            <div className="tool-head">
              {/* Annex VI UVCB names run to hundreds of characters — step the
                  display size down instead of letting one fill the viewport. */}
              <h2 className={displayName.length > 60 ? 'long' : undefined}>{displayName}</h2>
              <span className="cas">{selectedRow?.display_cas ?? verdict.cas}</span>
            </div>

            {(verdict.class_names.length > 0 || verdict.special_flags.length > 0) && (
              <div className="tool-badges">
                {/* storage class — filled with its hazard-family colour */}
                {verdict.class_names.map(c => (
                  <a
                    key={c.code}
                    href={urlForCode(c.code)}
                    className="tool-badge cls"
                    style={{ background: familyBadgeForCode(c.code) }}
                  >
                    {shortForCode(c.code)}
                  </a>
                ))}
                {/* CAMEO special-hazard flags (intrinsic to the substance) */}
                {verdict.special_flags.map(f => (
                  <span key={f} className="tool-badge flag">
                    <span aria-hidden="true">⚠</span> {flagLabel(f)}
                  </span>
                ))}
              </div>
            )}

            {/* rev6: hand off to the SDS-style full report when a live page exists */}
            {selectedSlug && (
              <a href={`/sds/${selectedSlug}/`} className="tool-cta">
                Full substance report
                <span aria-hidden="true">→</span>
              </a>
            )}

            {/* no-class / corrosive note (context-aware) */}
            {verdict.classes.length === 0 && (
              verdict.is_corrosive_h314 ? (
                <div className="tool-note">
                  Corrosive (GHS H314) — acid vs. base could not be determined automatically. Verify against SDS section 10 before co-storage.
                </div>
              ) : unclassifiedButRisky ? (
                <div className="tool-note stop">
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
                <div className="tool-note warn">
                  No storage class was derived from its GHS codes, and this substance isn't in CAMEO's reactivity
                  database — so reactive hazards can't be ruled out automatically. Before storing, look it up in{' '}
                  <a
                    href="https://cameochemicals.noaa.gov/search/simple"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    CAMEO Chemicals (NOAA)
                  </a>{' '}
                  (search CAS {verdict.cas}) and verify against SDS sections 7 and 10.
                </div>
              ) : (
                <div className="tool-note">
                  No special storage segregation class from its GHS codes. Store per general good practice and verify against SDS section 7.
                </div>
              )
            )}

            {/* SEGREGATION — the same verdict cards the category pages carry */}
            {nSeg && (
              <section className="tool-sec">
                <p className="tool-eyebrow">{nSeg} · Segregation</p>
                {/* No substance name in this heading on purpose: display names
                    average 72 chars here (429 rows are over 70, the longest is
                    555) — an Annex VI UVCB string would swallow the line. */}
                <h3 className="tool-h3">What this substance can be stored with</h3>
                <p className="tool-sub">
                  Class-level segregation against the {otherClasses} other storage classes. Open any class for its own
                  guidance and substance list.
                </p>

                <div className="hub-deck tool-deck">
                  {never.length > 0 && deckCard(DECK_NEVER, never)}
                  {separate.length > 0 && deckCard(DECK_SEPARATE, separate)}
                </div>
              </section>
            )}

            {/* ADR */}
            {activeAdr && (
              <section className="tool-sec">
                <p className="tool-eyebrow">{nAdr} · Transport</p>
                <h3 className="tool-h3">ADR transport</h3>
                <div className="tool-adr">
                  <span>UN {activeAdr.un}</span>
                  {activeAdr.class && (
                    <>
                      <span className="sep" aria-hidden="true">·</span>
                      <span>Class {activeAdr.class}</span>
                    </>
                  )}
                  {activeAdr.pg && (
                    <>
                      <span className="sep" aria-hidden="true">·</span>
                      <span>PG {activeAdr.pg}</span>
                    </>
                  )}
                </div>
                {activeAdr.name && <p className="tool-adr-name">{activeAdr.name}</p>}
              </section>
            )}

            {/* gas release on contact — attributed to the incompatible class that triggers it (CAMEO, curated) */}
            {gasRows.length > 0 && (
              <section className="tool-sec">
                <p className="tool-eyebrow">{nGas} · Reactivity</p>
                <h3 className="tool-h3">Gas release on contact</h3>
                <p className="tool-sub">
                  Each gas is shown with the class that triggers it — released only on contact, never by the substance alone. Where CAMEO lists both a specific gas (HCl) and the general form (hydrogen halide), both appear.
                </p>
                <ul className="tool-gas-list">
                  {gasShown.map(r => (
                    <li key={r.reacts_with} className="tool-gas-row">
                      <span className="w">With <b>{r.reacts_with}</b></span>
                      <span className="ar" aria-hidden="true">→</span>
                      <span className="tool-gas-chips">
                        {r.gases.map(g => (
                          <span key={g.label} className={g.toxic ? 'tool-gas toxic' : 'tool-gas'}>
                            {g.label}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
                {gasRows.length > GAS_PREVIEW_ROWS && (
                  <button type="button" className="hub-toggle" onClick={() => setGasOpen(o => !o)}>
                    {gasOpen ? 'Show fewer reactive groups' : `Show all ${gasRows.length} reactive groups →`}
                  </button>
                )}
                <p className="tool-fine">
                  <b>Red</b> means the gas carries an acute inhalation toxicity classification — H330, H331 or H332 — in CLP Annex VI. That is a legal classification, not our judgement: it is why hydrogen chloride and ammonia are red while hydrogen iodide is not, since Annex VI classifies the first two as acutely toxic and the third only as corrosive.{' '}
                  <b>Grey does not mean safe.</b> Hydrogen iodide and sulphuric acid mist are corrosive, carbon dioxide and nitrogen displace oxygen in a confined space, hydrogen is flammable and oxygen intensifies any fire. A few gases have no harmonised entry at all and are marked by hand, erring towards caution.
                </p>
              </section>
            )}

            <p className="tool-fine">
              <b>Reference aid only.</b> Colour and class are a triage signal, not a classification — always verify storage and gas hazards against the substance&apos;s safety data sheet (sections 7 and 10) and local regulations.{' '}
              Managing SDSs for a whole inventory?{' '}
              <a
                href={SDS_MANAGEMENT_URL}
                target="_blank"
                rel="sponsored nofollow noopener"
                onClick={() => track('affiliate_click', { partner: 'sds_manager', placement: 'storage_tool' })}
              >
                SDS Manager keeps them current and audit-ready&nbsp;†
              </a>
              <span className="disc">
                † SDS Manager is a partner solution; we may earn a commission.{' '}
                <a href="/affiliate-disclosure/">See disclosure</a>.
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
