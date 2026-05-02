import { supabase } from './supabase'

/** Минимальные поля вещества для страницы и related. */
export type SubstanceRow = {
  cas_number: string
  common_name: string | null
  iupac_name: string
  ghs_pictogram_codes: string[] | null
  h_statement_codes: string[] | null
  p_statement_codes: string[] | null
  signal_word: string | null
  ec_number: string | null
}

export type PictogramRow = {
  code: string
  name_en: string
  svg_content: string | null
  hazard_class_en: string | null
}

export type HPRowLite = { code: string; text_en: string }

export type RelatedProp = {
  cas_number: string
  common_name: string | null
  iupac_name: string
}

/** CLP Art. 26 — какие пиктограммы показывать на этикетке (как в прежней логике). */
export function filterLabelPictogramCodes(allPicCodes: string[]): string[] {
  let codes = [...allPicCodes]
  if (codes.includes('GHS06')) codes = codes.filter((c) => c !== 'GHS07')
  if (codes.includes('GHS05')) codes = codes.filter((c) => c !== 'GHS07')
  if (codes.includes('GHS08')) codes = codes.filter((c) => c !== 'GHS07')
  if (codes.includes('GHS02') || codes.includes('GHS06'))
    codes = codes.filter((c) => c !== 'GHS04' || codes.includes('GHS04'))
  return codes
}

async function fetchSubstancesBatched(): Promise<SubstanceRow[]> {
  const out: SubstanceRow[] = []
  let from = 0
  const batch = 1000
  while (true) {
    const { data } = await supabase
      .from('substances')
      .select(
        'cas_number, common_name, iupac_name, ghs_pictogram_codes, h_statement_codes, p_statement_codes, signal_word, ec_number'
      )
      .not('cas_number', 'is', null)
      .not('ghs_pictogram_codes', 'is', null)
      .range(from, from + batch - 1)

    if (!data?.length) break
    out.push(...(data as SubstanceRow[]))
    if (data.length < batch) break
    from += batch
  }
  return out.filter((s) => (s.ghs_pictogram_codes?.length ?? 0) > 0)
}

function buildRelatedMap(substances: SubstanceRow[]): Map<string, SubstanceRow[]> {
  const byPic = new Map<string, SubstanceRow[]>()
  for (const s of substances) {
    for (const code of s.ghs_pictogram_codes ?? []) {
      if (!byPic.has(code)) byPic.set(code, [])
      byPic.get(code)!.push(s)
    }
  }

  const relatedMap = new Map<string, SubstanceRow[]>()
  for (const s of substances) {
    const candidates = new Map<string, { sub: SubstanceRow; score: number }>()
    for (const code of s.ghs_pictogram_codes ?? []) {
      for (const other of byPic.get(code) ?? []) {
        if (other.cas_number === s.cas_number) continue
        const ex = candidates.get(other.cas_number)
        if (ex) ex.score++
        else candidates.set(other.cas_number, { sub: other, score: 1 })
      }
    }
    const top6 = [...candidates.values()]
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.sub.cas_number.localeCompare(b.sub.cas_number, undefined, {
            numeric: true,
          })
      )
      .slice(0, 6)
      .map((c) => c.sub)
    relatedMap.set(s.cas_number, top6)
  }
  return relatedMap
}

export async function loadPictogramCasStaticPaths(): Promise<
  {
    params: { cas: string }
    props: {
      substance: SubstanceRow
      pictograms: PictogramRow[]
      hList: HPRowLite[]
      pList: HPRowLite[]
      related: RelatedProp[]
    }
  }[]
> {
  const [substances, picRes, hRes, pRes] = await Promise.all([
    fetchSubstancesBatched(),
    supabase
      .from('pictograms_signals')
      .select('code, name_en, svg_content, hazard_class_en'),
    supabase.from('h_statements').select('code, text_en'),
    supabase.from('p_statements').select('code, text_en'),
  ])

  const picRows = (picRes.data ?? []) as PictogramRow[]
  const hRows = (hRes.data ?? []) as HPRowLite[]
  const pRows = (pRes.data ?? []) as HPRowLite[]

  const picMap = new Map(picRows.map((p) => [p.code, p]))
  const hMap = new Map(hRows.map((h) => [h.code, h]))
  const pMap = new Map(pRows.map((p) => [p.code, p]))

  const relatedMap = buildRelatedMap(substances)

  return substances.map((substance) => {
    const cas = substance.cas_number

    const pictograms = (substance.ghs_pictogram_codes ?? [])
      .map((c) => picMap.get(c))
      .filter((p): p is PictogramRow => p != null)

    const hList = (substance.h_statement_codes ?? [])
      .map((c) => hMap.get(c))
      .filter((row): row is HPRowLite => row != null)

    const pList = (substance.p_statement_codes ?? [])
      .map((c) => pMap.get(c))
      .filter((row): row is HPRowLite => row != null)

    const related: RelatedProp[] = (relatedMap.get(cas) ?? []).map((r) => ({
      cas_number: r.cas_number,
      common_name: r.common_name,
      iupac_name: r.iupac_name,
    }))

    return {
      params: { cas },
      props: {
        substance,
        pictograms,
        hList,
        pList,
        related,
      },
    }
  })
}
