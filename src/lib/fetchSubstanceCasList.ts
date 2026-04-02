/** Все CAS из substances для getStaticPaths (пагинация Supabase по 1000) */
import { supabase } from './supabase'

export async function fetchAllCasNumbers(): Promise<string[]> {
  const pageSize = 1000
  const casList: string[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('substances')
      .select('cas_number')
      .not('cas_number', 'is', null)
      .order('cas_number', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) throw error
    if (!data?.length) break
    for (const row of data) {
      const c = row.cas_number?.trim()
      if (c && c !== '-') casList.push(c)
    }
    if (data.length < pageSize) break
  }
  return casList
}
