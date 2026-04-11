import { useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import { createClient } from '@supabase/supabase-js'

/** Клиент на уровне модуля — в Vite/Astro env доступен как import.meta.env.PUBLIC_* */
const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY
)

interface SubstanceRow {
  cas_number: string
  iupac_name: string
  common_name: string | null
  ghs_pictogram_codes: string[] | null
  signal_word: string | null
  h_statement_codes: string[] | null
}

type PictogramSVG = { code: string; svg_content: string }

/** Оценка класса ADR по пиктограмме GHS (упрощённо; не заменяет UN/PG из таблиц) */
const GHS_TO_ADR: Record<string, { class: string; name: string; color: string }> = {
  GHS01: { class: '1', name: 'Explosives', color: '#FF8C00' },
  GHS02: { class: '3', name: 'Flammable Liquids', color: '#FF0000' },
  GHS03: { class: '5.1', name: 'Oxidizing Substances', color: '#FFFF00' },
  GHS04: { class: '2', name: 'Gases', color: '#00FF00' },
  GHS05: { class: '8', name: 'Corrosive Substances', color: '#000000' },
  GHS06: { class: '6.1', name: 'Toxic Substances', color: '#FFFFFF' },
  GHS07: { class: '6.1', name: 'Toxic / Harmful (often PG III)', color: '#FFFFFF' },
  GHS08: { class: '6.1', name: 'Toxic Substances', color: '#FFFFFF' },
  GHS09: { class: '9', name: 'Misc Dangerous Goods', color: '#FFFFFF' },
}

function textColorForDiamond(bg: string): string {
  const hex = bg.replace('#', '')
  if (hex.length !== 6) return '#0f172a'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.65 ? '#0f172a' : '#ffffff'
}

function AdrDiamond({ adrClass, fill, label }: { adrClass: string; fill: string; label: string }) {
  const tc = textColorForDiamond(fill)
  return (
    <div style={{ textAlign: 'center' as const, marginBottom: 12 }}>
      <svg
        width={88}
        height={88}
        viewBox="0 0 100 100"
        style={{ display: 'block', margin: '0 auto 6px' }}
        aria-hidden
      >
        <polygon
          points="50,4 96,50 50,96 4,50"
          fill={fill}
          stroke="#1e293b"
          strokeWidth={2}
        />
        <text
          x={50}
          y={56}
          textAnchor="middle"
          fontSize={adrClass.length > 2 ? 18 : 26}
          fontWeight={800}
          fill={tc}
          style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
        >
          {adrClass}
        </text>
      </svg>
      <div style={{ fontSize: 11, color: '#64748b', maxWidth: 100, margin: '0 auto', lineHeight: 1.3 }}>{label}</div>
    </div>
  )
}

export default function GHSInspector() {
  const [all, setAll] = useState<SubstanceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<SubstanceRow | null>(null)
  const [pictogramSVGs, setPictogramSVGs] = useState<Record<string, string>>({})
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selected) {
      setPictogramSVGs({})
      return
    }
    const codes = selected.ghs_pictogram_codes ?? []
    if (codes.length === 0) {
      setPictogramSVGs({})
      return
    }
    let cancelled = false
    async function loadPictograms() {
      const { data, error } = await supabase
        .from('pictograms_signals')
        .select('code, svg_content')
        .in('code', codes)
      if (cancelled) return
      if (error) {
        console.error(error)
        setPictogramSVGs({})
        return
      }
      if (data) {
        const map: Record<string, string> = {}
        data.forEach((p: PictogramSVG) => {
          if (p.svg_content) map[p.code] = p.svg_content
        })
        setPictogramSVGs(map)
      }
    }
    loadPictograms()
    return () => {
      cancelled = true
    }
  }, [selected])

  useEffect(() => {
    async function loadAll() {
      console.log('Supabase URL:', import.meta.env.PUBLIC_SUPABASE_URL)
      let data: SubstanceRow[] = []
      let from = 0
      const size = 1000
      while (true) {
        const { data: chunk, error } = await supabase
          .from('substances')
          .select('cas_number, iupac_name, common_name, ghs_pictogram_codes, signal_word, h_statement_codes')
          .not('cas_number', 'is', null)
          .range(from, from + size - 1)
        console.log('Error:', error)
        console.log('Data:', chunk)
        if (error) {
          console.error(error)
          break
        }
        if (!chunk?.length) break
        data = [...data, ...(chunk as SubstanceRow[])]
        if (chunk.length < size) break
        from += size
      }
      console.log('Загружено веществ:', data.length)
      console.log('Первые 3:', data.slice(0, 3))
      setAll(data)
      setLoading(false)
    }
    loadAll()
  }, [])

  const fuse = useMemo(
    () =>
      new Fuse(all, {
        keys: ['cas_number', 'iupac_name', 'common_name'],
        threshold: 0.4,
        minMatchCharLength: 2,
      }),
    [all]
  )

  const dropdownResults = useMemo(() => {
    if (query.trim().length < 2) return []
    return fuse.search(query.trim()).slice(0, 15).map((r) => r.item)
  }, [query, fuse])

  useEffect(() => {
    if (query.trim().length < 2) return
    console.log('Запрос:', query.trim(), 'Результатов:', dropdownResults.length)
  }, [query, dropdownResults])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const displayName = (s: SubstanceRow) => s.common_name?.trim() || s.iupac_name

  if (loading) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 48px', textAlign: 'center', color: '#64748b' }}>
        Loading substances…
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 16px 48px' }}>
      <div ref={wrapRef} style={{ position: 'relative', marginBottom: 28 }}>
        <label htmlFor="ghs-insp-q" style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
          Search by CAS or name
        </label>
        <input
          id="ghs-insp-q"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            if (selected) setSelected(null)
          }}
          onFocus={() => setOpen(true)}
          placeholder="e.g. 67-64-1 or acetone"
          autoComplete="off"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px 14px',
            fontSize: 16,
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            outline: 'none',
            color: '#0f172a',
          }}
        />
        {open && query.trim().length >= 2 && dropdownResults.length > 0 && (
          <ul
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '100%',
              marginTop: 4,
              maxHeight: 320,
              overflowY: 'auto',
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 10px 25px rgba(15,23,42,0.12)',
              zIndex: 20,
              listStyle: 'none',
              padding: 0,
              margin: 0,
            }}
          >
            {dropdownResults.map((s) => (
              <li key={s.cas_number}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(s)
                    setQuery(displayName(s))
                    setOpen(false)
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 14px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 14,
                    color: '#0f172a',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{displayName(s)}</span>
                  <span style={{ color: '#64748b', marginLeft: 8 }}>CAS {s.cas_number}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 24,
              alignItems: 'stretch',
            }}
          >
            {/* GHS */}
            <div
              style={{
                flex: '1 1 280px',
                minWidth: 260,
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: 20,
              }}
            >
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden>📋</span> GHS Classification
              </h2>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#062A78', margin: '0 0 4px' }}>{displayName(selected)}</p>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>CAS {selected.cas_number}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16, alignItems: 'center' }}>
                {(selected.ghs_pictogram_codes ?? []).map((code) =>
                  pictogramSVGs[code] ? (
                    <div
                      key={code}
                      style={{
                        width: 56,
                        height: 56,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        overflow: 'hidden',
                      }}
                      dangerouslySetInnerHTML={{ __html: pictogramSVGs[code] }}
                    />
                  ) : (
                    <span key={code} style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                      {code}
                    </span>
                  )
                )}
              </div>
              {selected.signal_word && (
                <div style={{ marginBottom: 14 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '4px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      background: selected.signal_word === 'Danger' ? '#dc2626' : '#f59e0b',
                      color: '#fff',
                    }}
                  >
                    {selected.signal_word}
                  </span>
                </div>
              )}
              <p style={{ fontSize: 12, fontWeight: 600, color: '#64748b', margin: '0 0 6px' }}>H-statements</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(selected.h_statement_codes ?? []).length === 0 ? (
                  <span style={{ fontSize: 13, color: '#94a3b8' }}>—</span>
                ) : (
                  (selected.h_statement_codes ?? []).map((h) => (
                    <span
                      key={h}
                      style={{
                        fontSize: 12,
                        padding: '2px 8px',
                        background: '#f1f5f9',
                        borderRadius: 4,
                        color: '#0f172a',
                      }}
                    >
                      {h}
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* ADR */}
            <div
              style={{
                flex: '1 1 280px',
                minWidth: 260,
                background: '#fff8ed',
                border: '1px solid #f59e0b',
                borderRadius: 8,
                padding: 20,
              }}
            >
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden>🚛</span> Transport Classification
              </h2>
              <p style={{ fontSize: 13, color: '#475569', margin: '0 0 16px' }}>
                Estimated ADR/DOT hazard class from GHS pictograms (illustrative).
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'flex-start' }}>
                {(selected.ghs_pictogram_codes ?? []).map((code) => {
                  const m = GHS_TO_ADR[code]
                  if (!m) {
                    return (
                      <div key={code} style={{ fontSize: 12, color: '#64748b', padding: 8 }}>
                        {code}: no ADR mapping in this tool
                      </div>
                    )
                  }
                  return (
                    <div key={code}>
                      <div style={{ fontSize: 11, color: '#92400e', marginBottom: 6, fontWeight: 600 }}>{code}</div>
                      <AdrDiamond adrClass={m.class} fill={m.color} label={m.name} />
                    </div>
                  )
                })}
              </div>
              <p style={{ fontSize: 11, color: '#78716c', margin: '20px 0 0', lineHeight: 1.5 }}>
                ADR class is estimated from GHS pictograms. Verify exact UN number and packing group with official ADR 2025
                tables before shipment.
              </p>
            </div>
          </div>

          {/* CTA */}
          <div
            style={{
              marginTop: 32,
              padding: 24,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              textAlign: 'center' as const,
            }}
          >
            <p style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 12px' }}>
              Need certified ADR/GHS labels for shipment?
            </p>
            <a
              href="https://ghslabels.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block',
                padding: '12px 24px',
                background: '#062A78',
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                borderRadius: 8,
                textDecoration: 'none',
              }}
            >
              Visit GHS Labels →
            </a>
          </div>
        </>
      )}
    </div>
  )
}
