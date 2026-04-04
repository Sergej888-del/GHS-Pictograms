import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import GHSLabelConstructor from './GHSLabelConstructor'

interface Substance {
  id: string
  iupac_name: string
  common_name: string | null
  cas_number: string
  ec_number: string | null
  signal_word: string | null
  ghs_pictogram_codes: string[] | null
  h_statement_codes: string[] | null
  p_statement_codes: string[] | null
}

interface Pictogram { code: string; name_en: string; svg_content: string | null }
interface HStatement { code: string; text_en: string }
interface PStatement { code: string; text_en: string }

type SearchRow = { cas_number: string; common_name: string | null; iupac_name: string }

export default function LabelConstructorLoader() {
  const [cas, setCas] = useState<string | null>(null)
  const [substance, setSubstance] = useState<Substance | null>(null)
  const [pictograms, setPictograms] = useState<Pictogram[]>([])
  const [hStatements, setHStatements] = useState<HStatement[]>([])
  const [pStatements, setPStatements] = useState<PStatement[]>([])
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<SearchRow[]>([])
  const [searching, setSearching] = useState(false)

  // Читаем CAS из URL при загрузке
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const casParam = params.get('cas')
    if (casParam) {
      setCas(casParam)
    }
  }, [])

  // Загружаем данные когда есть CAS
  useEffect(() => {
    if (!cas) return
    async function load() {
      setLoading(true)
      setNotFound(false)
      const { data: sub } = await supabase
        .from('substances')
        .select('id, iupac_name, common_name, cas_number, ec_number, signal_word, ghs_pictogram_codes, h_statement_codes, p_statement_codes')
        .eq('cas_number', cas)
        .single()

      if (!sub) { setNotFound(true); setLoading(false); return }
      setSubstance(sub as Substance)

      const s = sub as Substance
      const picCodes = s.ghs_pictogram_codes ?? []
      const hCodes = s.h_statement_codes ?? []
      const pCodes = s.p_statement_codes ?? []

      const [picRes, hRes, pRes] = await Promise.all([
        picCodes.length > 0
          ? supabase.from('pictograms_signals').select('code, name_en, svg_content').in('code', picCodes)
          : Promise.resolve({ data: [] as Pictogram[] | null }),
        hCodes.length > 0
          ? supabase.from('h_statements').select('code, text_en').in('code', hCodes)
          : Promise.resolve({ data: [] as HStatement[] | null }),
        pCodes.length > 0
          ? supabase.from('p_statements').select('code, text_en').in('code', pCodes)
          : Promise.resolve({ data: [] as PStatement[] | null }),
      ])

      setPictograms(((picRes.data ?? []) as Pictogram[]).sort((a, b) => a.code.localeCompare(b.code)))
      setHStatements(((hRes.data ?? []) as HStatement[]).sort((a, b) => a.code.localeCompare(b.code)))
      setPStatements(((pRes.data ?? []) as PStatement[]).sort((a, b) => a.code.localeCompare(b.code)))
      setLoading(false)
    }
    load()
  }, [cas])

  // Поиск по имени/CAS
  useEffect(() => {
    if (searchQ.length < 2) { setSearchResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const casLike = /^[\d[\]/]/.test(searchQ) || searchQ.includes('-')
      let q = supabase.from('substances').select('cas_number, common_name, iupac_name').not('cas_number', 'is', null).limit(8)
      q = casLike ? q.ilike('cas_number', `%${searchQ}%`) : q.ilike('iupac_name', `%${searchQ}%`)
      const { data } = await q
      setSearchResults((data ?? []) as SearchRow[])
      setSearching(false)
    }, 300)
    return () => clearTimeout(t)
  }, [searchQ])

  // Пустое состояние — поиск вещества
  if (!cas && !substance) {
    return (
      <div className="space-y-6">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <p className="font-semibold text-[#062A78] mb-3">Search for a substance to begin</p>
          <input
            type="search"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="Type CAS number or substance name…"
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 focus:border-[#062A78] focus:ring-2 focus:ring-[#062A78]/20 outline-none"
          />
          {searching && <p className="text-sm text-gray-400 mt-2">Searching…</p>}
          {searchResults.length > 0 && (
            <ul className="mt-3 border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
              {searchResults.map(r => (
                <li key={r.cas_number}>
                  <button
                    type="button"
                    onClick={() => { setCas(r.cas_number); setSearchQ(''); setSearchResults([]) }}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <span className="font-semibold text-[#062A78]">{r.common_name || r.iupac_name}</span>
                    <span className="block text-sm text-gray-500">CAS {r.cas_number}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-sm text-gray-500">
            Or browse the full database:{' '}
            <a href="/pictograms/" className="text-[#062A78] underline">
              Select from substance list →
            </a>
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="py-16 text-center text-gray-500 text-sm">Loading substance data…</div>
  }

  if (notFound) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-600 mb-4">Substance not found for CAS: {cas}</p>
        <button
          type="button"
          onClick={() => { setCas(null); setSubstance(null) }}
          className="text-[#062A78] underline text-sm"
        >
          ← Search again
        </button>
      </div>
    )
  }

  if (!substance) return null

  const displayName = substance.common_name || substance.iupac_name

  return (
    <div className="space-y-6">
      {/* Шапка с выбранным веществом */}
      <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-5 py-3">
        <div>
          <p className="text-xs text-green-700 font-medium uppercase tracking-wide">Selected substance</p>
          <p className="font-bold text-gray-900">{displayName}</p>
          <p className="text-sm text-gray-500">CAS {substance.cas_number}</p>
        </div>
        <button
          type="button"
          onClick={() => { setCas(null); setSubstance(null); setPictograms([]); setHStatements([]); setPStatements([]) }}
          className="text-sm text-gray-400 hover:text-gray-600 underline"
        >
          Change substance
        </button>
      </div>

      {/* Label Constructor со всеми данными */}
      <GHSLabelConstructor
        displayName={displayName}
        casNumber={substance.cas_number}
        ecNumber={substance.ec_number}
        signalWord={substance.signal_word}
        pictograms={pictograms}
        hStatements={hStatements}
        pStatements={pStatements}
      />
    </div>
  )
}
