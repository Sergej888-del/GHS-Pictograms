/** Related substances by GHS pictogram overlap (build-time only). */

export type SubstancePicRow = {
  cas_number: string
  common_name: string | null
  iupac_name: string
  ghs_pictogram_codes: string[] | null
}

function intersectionPicSize(
  a: string[] | null | undefined,
  b: string[] | null | undefined
): number {
  const A = new Set(a ?? [])
  let n = 0
  for (const x of b ?? []) {
    if (A.has(x)) n++
  }
  return n
}

export function buildRelatedByPicMap(
  substances: SubstancePicRow[],
  limit: number
): Map<string, SubstancePicRow[]> {
  const picIndex = new Map<string, Set<string>>()
  const byCas = new Map<string, SubstancePicRow>()

  for (const s of substances) {
    byCas.set(s.cas_number, s)
    for (const p of s.ghs_pictogram_codes ?? []) {
      if (!picIndex.has(p)) picIndex.set(p, new Set())
      picIndex.get(p)!.add(s.cas_number)
    }
  }

  const out = new Map<string, SubstancePicRow[]>()

  for (const s of substances) {
    const cand = new Set<string>()
    for (const p of s.ghs_pictogram_codes ?? []) {
      for (const c of picIndex.get(p) ?? []) {
        if (c !== s.cas_number) cand.add(c)
      }
    }

    const scored: { cas: string; score: number }[] = []
    for (const c of cand) {
      const t = byCas.get(c)
      if (!t) continue
      const score = intersectionPicSize(s.ghs_pictogram_codes, t.ghs_pictogram_codes)
      if (score > 0) scored.push({ cas: c, score })
    }
    scored.sort(
      (x, y) =>
        y.score - x.score ||
        x.cas.localeCompare(y.cas, undefined, { numeric: true })
    )
    const top = scored.slice(0, limit).map(({ cas }) => byCas.get(cas)!)
    out.set(s.cas_number, top)
  }

  return out
}
