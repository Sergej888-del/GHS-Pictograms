import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 50

type Row = {
  cas_number: string
  iupac_name: string
  common_name: string | null
  ec_number: string | null
}

export default function PictogramsBrowse() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    setPage(0)
  }, [debounced])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from('substances')
      .select('cas_number, iupac_name, common_name, ec_number', { count: 'exact' })
      .not('cas_number', 'is', null)
      .order('cas_number', { ascending: true })

    const term = debounced
    if (term) {
      const casLike = /^[\d[\]/]/.test(term) || term.includes('-')
      if (casLike) {
        query = query.ilike('cas_number', `%${term}%`)
      } else {
        query = query.ilike('iupac_name', `%${term}%`)
      }
    }

    const { data, error: err, count } = await query.range(from, to)

    if (err) {
      setError(err.message)
      setRows([])
      setTotal(0)
    } else {
      setRows((data ?? []) as Row[])
      setTotal(count ?? 0)
    }
    setLoading(false)
  }, [page, debounced])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showPager = total > PAGE_SIZE

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <label className="block text-sm font-medium text-gray-700 mb-2">Search by CAS or substance name</label>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="e.g. 67-64-1 or acetone"
        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 shadow-sm focus:border-[#062A78] focus:ring-2 focus:ring-[#062A78]/20 outline-none"
      />
      {debounced && (
        <p className="mt-2 text-sm text-gray-600">
          Showing matches for &quot;{debounced}&quot;{!loading && ` (${total} found)`}
        </p>
      )}

      {error && (
        <p className="mt-4 text-red-600 text-sm" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-gray-600">Loading…</p>
      ) : (
        <>
          <ul className="mt-8 divide-y divide-gray-200 border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
            {rows.length === 0 ? (
              <li className="px-4 py-8 text-center text-gray-600">No substances found.</li>
            ) : (
              rows.map((r) => {
                const name = r.common_name || r.iupac_name
                const href = `/pictograms/${encodeURIComponent(r.cas_number)}/`
                return (
                  <li key={r.cas_number}>
                    <a href={href} className="block px-4 py-4 hover:bg-slate-50 transition-colors">
                      <span className="font-semibold text-[#062A78]">{name}</span>
                      <span className="block text-sm text-gray-600 mt-1">
                        CAS {r.cas_number}
                        {r.ec_number ? ` · EC ${r.ec_number}` : ''}
                      </span>
                    </a>
                  </li>
                )
              })
            )}
          </ul>

          {showPager && (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-gray-600">
                Page {page + 1} of {totalPages} · {total} substances
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
