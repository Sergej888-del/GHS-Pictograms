/**
 * Общая логика страницы /pictograms/[cas]/ (без Supabase).
 * При `output: 'server'` Astro не поддерживает гибрид «частичный getStaticPaths + SSR на том же [cas].astro»
 * — вне списка getStaticPaths путь получает 404. Поэтому страница рендерится on‑demand;
 * TOP‑200 здесь можно взять для прогрева CDN или отдельного пайплайна.
 */

/** Поля вещества, нужные странице /pictograms/[cas]/ и приоритету TOP‑N */
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

/** Сортировка для «популярных» CAS (общее имя, короткое название). */
export function prioritizePictogramSubstances(s: SubstanceRow[]): SubstanceRow[] {
  return [...s].sort((a, b) => {
    const aHasCommon = a.common_name ? 1 : 0
    const bHasCommon = b.common_name ? 1 : 0
    if (aHasCommon !== bHasCommon) return bHasCommon - aHasCommon

    const aLen = (a.common_name || a.iupac_name).length
    const bLen = (b.common_name || b.iupac_name).length
    return aLen - bLen
  })
}

/** Список CAS для прогрева кеша (например, первые TOP_N после prioritize). */
export function topCasNumbersForWarmup(substances: SubstanceRow[], topN = 200): string[] {
  const eligible = substances.filter((x) => (x.ghs_pictogram_codes?.length ?? 0) > 0)
  return prioritizePictogramSubstances(eligible)
    .slice(0, topN)
    .map((x) => x.cas_number)
}

/** CLP Art. 26 — какие пиктограммы показывать на этикетке. */
export function filterLabelPictogramCodes(allPicCodes: string[]): string[] {
  let codes = [...allPicCodes]
  if (codes.includes('GHS06')) codes = codes.filter((c) => c !== 'GHS07')
  if (codes.includes('GHS05')) codes = codes.filter((c) => c !== 'GHS07')
  if (codes.includes('GHS08')) codes = codes.filter((c) => c !== 'GHS07')
  if (codes.includes('GHS02') || codes.includes('GHS06'))
    codes = codes.filter((c) => c !== 'GHS04' || codes.includes('GHS04'))
  return codes
}
