// Single source of truth for the 13 storage classes: code <-> slug <-> label.
// Imported by the category-page template (/storage-compatibility/[class]/ —
// getStaticPaths + interlinks) AND by StorageTool.tsx (pill/badge labels + links),
// so the tool and the category pages can never diverge on URL or wording.
//
// Slugs are permanent (they are public URLs). Approved 2026-07.

export interface StorageClass {
  /** DB storage-class code (sc_code). */
  code: string
  /** URL segment under /storage-compatibility/<slug>/ */
  slug: string
  /** Short pill / badge label. */
  short: string
}

export const STORAGE_CLASSES: StorageClass[] = [
  { code: 'FLAM_LIQ',    slug: 'flammable-liquids',     short: 'Flammable liquids' },
  { code: 'OXID',        slug: 'oxidizers',             short: 'Oxidizers' },
  { code: 'OX_ACID',     slug: 'oxidizing-acids',       short: 'Oxidizing acids' },
  { code: 'MIN_ACID',    slug: 'mineral-acids',         short: 'Mineral acids' },
  { code: 'ORG_ACID',    slug: 'organic-acids',         short: 'Organic acids' },
  { code: 'BASE',        slug: 'bases',                 short: 'Bases' },
  { code: 'WATER_RX',    slug: 'water-reactives',       short: 'Water-reactives' },
  { code: 'ORG_PEROX',   slug: 'organic-peroxides',     short: 'Organic peroxides' },
  { code: 'GAS',         slug: 'compressed-gases',      short: 'Compressed gases' },
  { code: 'FLAM_SOL',    slug: 'flammable-solids',      short: 'Flammable solids' },
  { code: 'REACT_METAL', slug: 'reactive-metals',       short: 'Reactive metals' },
  { code: 'CN_S',        slug: 'cyanides-and-sulfides', short: 'Cyanides & sulfides' },
  { code: 'TOXIC',       slug: 'acute-toxics',          short: 'Acute toxics' },
]

const byCode = new Map(STORAGE_CLASSES.map(c => [c.code, c]))
const bySlug = new Map(STORAGE_CLASSES.map(c => [c.slug, c]))

export const classByCode = (code: string): StorageClass | undefined => byCode.get(code)
export const classBySlug = (slug: string): StorageClass | undefined => bySlug.get(slug)
export const slugForCode = (code: string): string | undefined => byCode.get(code)?.slug
export const shortForCode = (code: string): string => byCode.get(code)?.short ?? code

/** Absolute path to a class's category page, or undefined for an unknown code. */
export const urlForCode = (code: string): string | undefined => {
  const s = byCode.get(code)?.slug
  return s ? `/storage-compatibility/${s}/` : undefined
}
