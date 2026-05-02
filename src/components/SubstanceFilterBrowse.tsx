// v2 - mobile layout fix
import { useEffect, useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import { supabase } from '../lib/supabase'

interface Substance {
  cas_number: string
  iupac_name: string
  common_name: string | null
  ec_number: string | null
  ghs_pictogram_codes: string[] | null
  signal_word: string | null
}

const PICTOGRAMS = [
  { code: 'GHS01', label: 'Explosive' },
  { code: 'GHS02', label: 'Flammable' },
  { code: 'GHS03', label: 'Oxidising' },
  { code: 'GHS04', label: 'Gas' },
  { code: 'GHS05', label: 'Corrosive' },
  { code: 'GHS06', label: 'Toxic' },
  { code: 'GHS07', label: 'Harmful' },
  { code: 'GHS08', label: 'Health Hazard' },
  { code: 'GHS09', label: 'Environmental' },
]

interface Props {
  /** Если задан — выбор вещества без перехода по ссылкам (например в Label Constructor) */
  onSelectSubstance?: (cas: string) => void
}

export default function SubstanceFilterBrowse({ onSelectSubstance }: Props = {}) {
  const selectMode = typeof onSelectSubstance === 'function'
  const [all, setAll] = useState<Substance[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      return params.get('q')?.trim() || params.get('search')?.trim() || ''
    }
    return ''
  })
  const [picFilters, setPicFilters] = useState<string[]>([])
  const [signalFilter, setSignalFilter] = useState<string>('')

  // Загрузка всех веществ при монтировании
  useEffect(() => {
    async function loadAll() {
      let data: Substance[] = []
      let from = 0
      const size = 1000
      while (true) {
        const { data: chunk } = await supabase
          .from('substances')
          .select('cas_number, iupac_name, common_name, ec_number, ghs_pictogram_codes, signal_word')
          .not('cas_number', 'is', null)
          .range(from, from + size - 1)
        if (!chunk || chunk.length === 0) break
        data = [...data, ...(chunk as Substance[])]
        if (chunk.length < size) break
        from += size
      }
      setAll(data)
      setLoading(false)
    }
    loadAll()
  }, [])

  // Fuse.js поиск
  const fuse = useMemo(() => new Fuse(all, {
    keys: ['cas_number', 'iupac_name', 'common_name'],
    threshold: 0.3,
    minMatchCharLength: 2,
  }), [all])

  // Фильтрация
  const results = useMemo(() => {
    let list = query.length >= 2
      ? fuse.search(query).map(r => r.item)
      : all

    if (picFilters.length > 0) {
      list = list.filter(s =>
        picFilters.every(code => (s.ghs_pictogram_codes ?? []).includes(code))
      )
    }

    if (signalFilter) {
      list = list.filter(s => s.signal_word === signalFilter)
    }

    return list.slice(0, 100)
  }, [query, picFilters, signalFilter, all, fuse])

  const togglePic = (code: string) => {
    setPicFilters(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    )
  }

  const clearAll = () => {
    setQuery('')
    setPicFilters([])
    setSignalFilter('')
  }

  const total = useMemo(() => {
    let list = query.length >= 2 ? fuse.search(query).map(r => r.item) : all
    if (picFilters.length > 0) {
      list = list.filter(s => picFilters.every(code => (s.ghs_pictogram_codes ?? []).includes(code)))
    }
    if (signalFilter) {
      list = list.filter(s => s.signal_word === signalFilter)
    }
    return list.length
  }, [query, picFilters, signalFilter, all, fuse])

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="text-gray-500 text-sm">Loading substances…</div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">

      {/* Поиск */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Search by CAS number or substance name
        </label>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="e.g. 67-64-1 or acetone"
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm focus:border-[#062A78] focus:ring-2 focus:ring-[#062A78]/20 outline-none"
        />
      </div>

      {/* Фасеты: пиктограммы */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-3">Filter by GHS pictogram</p>
        <div className="flex flex-wrap gap-2">
          {PICTOGRAMS.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              onClick={() => togglePic(code)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border-2 transition-colors ${
                picFilters.includes(code)
                  ? 'bg-[#062A78] text-white border-[#062A78]'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-[#062A78]'
              }`}
            >
              <img
                src={`/pictograms/${code.toLowerCase()}.svg`}
                alt={code}
                className="w-5 h-5"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
              {code} · {label}
            </button>
          ))}
        </div>
      </div>

      {/* Фасет: сигнальное слово */}
      <div className="flex items-center gap-3">
        <p className="text-sm font-medium text-gray-700">Signal word:</p>
        {['Danger', 'Warning'].map(sw => (
          <button
            key={sw}
            type="button"
            onClick={() => setSignalFilter(prev => prev === sw ? '' : sw)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border-2 transition-colors ${
              signalFilter === sw
                ? sw === 'Danger'
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
            }`}
          >
            {sw}
          </button>
        ))}
        {(picFilters.length > 0 || signalFilter || query) && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* Счётчик */}
      <p className="text-sm text-gray-500">
        {total === 0
          ? 'No substances match these filters.'
          : total > 100
          ? `Showing first 100 of ${total} substances`
          : `${total} substance${total === 1 ? '' : 's'}`}
      </p>

      {/* Список */}
      {results.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          No substances found. Try different filters.
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
          {results.map(r => {
            const name = r.common_name || r.iupac_name
            const casEnc = encodeURIComponent(r.cas_number)
            const detailHref = `/pictograms/${casEnc}/`
            const labelHref = `/label-constructor/?cas=${casEnc}`
            const pics = r.ghs_pictogram_codes ?? []
            const casEcLine = `CAS ${r.cas_number}${r.ec_number ? ` · EC ${r.ec_number}` : ''}`

            const mainBlock = (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                    minWidth: 0,
                  }}
                >
                  <p
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'block',
                      width: '100%',
                      wordBreak: 'normal',
                      overflowWrap: 'normal',
                      minWidth: 0,
                      fontWeight: 600,
                      color: '#062A78',
                      fontSize: '0.875rem',
                      margin: 0,
                      flex: 1,
                    }}
                  >
                    {name}
                  </p>
                  {!selectMode && (
                    <span style={{ color: '#062A78', fontSize: '0.75rem', fontWeight: 500, flexShrink: 0 }}>
                      Details →
                    </span>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '4px',
                    flexWrap: 'wrap',
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'block',
                      width: '100%',
                      wordBreak: 'normal',
                      overflowWrap: 'normal',
                      minWidth: 0,
                      fontSize: '0.75rem',
                      color: '#6b7280',
                    }}
                  >
                    {casEcLine}
                  </span>
                  {r.signal_word && (
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      backgroundColor: r.signal_word === 'Danger' ? '#fee2e2' : '#fef3c7',
                      color: r.signal_word === 'Danger' ? '#b91c1c' : '#92400e',
                      flexShrink: 0,
                    }}>
                      {r.signal_word}
                    </span>
                  )}
                  {pics.length > 0 && (
                    <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                      {pics.slice(0, 4).join(' ')}
                    </span>
                  )}
                </div>
              </>
            )

            if (selectMode) {
              return (
                <li key={r.cas_number} style={{ borderBottom: '1px solid #e2e8f0', minWidth: 0, display: 'flex', alignItems: 'stretch' }}>
                  <button
                    type="button"
                    onClick={() => onSelectSubstance!(r.cas_number)}
                    style={{
                      display: 'block',
                      padding: '12px 16px',
                      textDecoration: 'none',
                      minWidth: 0,
                      flex: 1,
                      textAlign: 'left',
                      border: 'none',
                      background: 'white',
                      cursor: 'pointer',
                      font: 'inherit',
                    }}
                  >
                    {mainBlock}
                  </button>
                  <a
                    href={detailHref}
                    onClick={e => e.stopPropagation()}
                    style={{
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '12px 14px',
                      borderLeft: '1px solid #e2e8f0',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#062A78',
                      textDecoration: 'none',
                    }}
                  >
                    Details
                  </a>
                </li>
              )
            }

            return (
              <li key={r.cas_number} style={{ borderBottom: '1px solid #e2e8f0', minWidth: 0, display: 'flex', alignItems: 'stretch' }}>
                <a
                  href={detailHref}
                  style={{ display: 'block', padding: '12px 16px', textDecoration: 'none', minWidth: 0, flex: 1 }}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
                      return
                    e.preventDefault()
                    window.location.assign(detailHref)
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                    e.preventDefault()
                    window.location.assign(detailHref)
                  }}
                >
                  {mainBlock}
                </a>
                <a
                  href={labelHref}
                  style={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '12px 14px',
                    borderLeft: '1px solid #e2e8f0',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#062A78',
                    textDecoration: 'none',
                  }}
                >
                  Label
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
