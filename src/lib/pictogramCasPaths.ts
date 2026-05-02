import { supabase } from './supabase'
import { buildRelatedByPicMap, type SubstancePicRow } from './relatedByPictograms'

export type SubstanceRow = SubstancePicRow & {
  h_statement_codes: string[] | null
  signal_word: string | null
  ec_number: string | null
}

export type PictogramRow = {
  code: string
  name_en: string
  svg_content: string | null
  hazard_class_en: string | null
}

export type HBrief = { code: string; snippet: string }

export type RelatedProp = {
  cas_number: string
  common_name: string | null
  iupac_name: string
}

async function fetchAllRows<T>(table: string, selectCols: string): Promise<T[]> {
  const out: T[] = []
  let from = 0
  const batch = 1000
  while (true) {
    const { data } = await supabase
      .from(table)
      .select(selectCols)
      .range(from, from + batch - 1)
    if (!data?.length) break
    out.push(...(data as T[]))
    if (data.length < batch) break
    from += batch
  }
  return out
}

function filterLabelPictogramCodes(allPicCodes: string[]): string[] {
  let codes = [...allPicCodes]
  if (codes.includes('GHS06')) codes = codes.filter((c) => c !== 'GHS07')
  if (codes.includes('GHS05')) codes = codes.filter((c) => c !== 'GHS07')
  if (codes.includes('GHS08')) codes = codes.filter((c) => c !== 'GHS07')
  if (codes.includes('GHS02') || codes.includes('GHS06'))
    codes = codes.filter((c) => c !== 'GHS04' || codes.includes('GHS04'))
  return codes
}

function hSnippet(text: string, max = 130): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

export async function loadPictogramCasStaticPaths(): Promise<
  {
    params: { cas: string }
    props: {
      substance: SubstanceRow
      labelPictograms: PictogramRow[]
      excludedPictograms: PictogramRow[]
      hBrief: HBrief[]
      relatedSubstances: RelatedProp[]
    }
  }[]
> {
  let substances: SubstanceRow[] = []
  let from = 0
  const pageSize = 1000
  while (true) {
    const { data } = await supabase
      .from('substances')
      .select(
        'cas_number, common_name, iupac_name, ghs_pictogram_codes, h_statement_codes, signal_word, ec_number'
      )
      .not('cas_number', 'is', null)
      .not('ghs_pictogram_codes', 'is', null)
      .range(from, from + pageSize - 1)

    if (!data?.length) break
    substances = [...substances, ...(data as SubstanceRow[])]
    if (data.length < pageSize) break
    from += pageSize
  }

  substances = substances.filter((s) => (s.ghs_pictogram_codes?.length ?? 0) > 0)

  const [picRows, hRows] = await Promise.all([
    fetchAllRows<PictogramRow>(
      'pictograms_signals',
      'code, name_en, svg_content, hazard_class_en'
    ),
    fetchAllRows<{ code: string; text_en: string }>(
      'h_statements',
      'code, text_en'
    ),
  ])

  const picMap = new Map(picRows.map((p) => [p.code, p]))
  const hMap = new Map(hRows.map((h) => [h.code, h.text_en]))

  const relatedByCas = buildRelatedByPicMap(substances, 6)

  return substances.map((substance) => {
    const cas = substance.cas_number
    const allPicCodes = substance.ghs_pictogram_codes ?? []
    const filteredCodes = filterLabelPictogramCodes(allPicCodes)

    const labelPictograms: PictogramRow[] = filteredCodes
      .map((code) => picMap.get(code))
      .filter((p): p is PictogramRow => p != null)

    const excludedPictograms: PictogramRow[] = allPicCodes
      .filter((c) => !filteredCodes.includes(c))
      .map((code) => picMap.get(code))
      .filter((p): p is PictogramRow => p != null)
      .sort((a, b) => a.code.localeCompare(b.code))

    const hCodes = [...(substance.h_statement_codes ?? [])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    )
    const hBrief: HBrief[] = hCodes.slice(0, 12).map((code) => ({
      code,
      snippet: hSnippet(hMap.get(code) ?? ''),
    }))

    const relatedSubstances: RelatedProp[] = (relatedByCas.get(cas) ?? []).map(
      (r) => ({
        cas_number: r.cas_number,
        common_name: r.common_name,
        iupac_name: r.iupac_name,
      })
    )

    return {
      params: { cas },
      props: {
        substance,
        labelPictograms,
        excludedPictograms,
        hBrief,
        relatedSubstances,
      },
    }
  })
}
