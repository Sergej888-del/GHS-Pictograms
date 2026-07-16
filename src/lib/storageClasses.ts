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
  /** Hazard family — drives the card accent color across tool + pages. */
  family: 'flammable' | 'oxidizing' | 'corrosive' | 'reactive' | 'toxic'
}

export const STORAGE_CLASSES: StorageClass[] = [
  { code: 'FLAM_LIQ',    slug: 'flammable-liquids',     short: 'Flammable liquids',   family: 'flammable' },
  { code: 'OXID',        slug: 'oxidizers',             short: 'Oxidizers',           family: 'oxidizing' },
  { code: 'OX_ACID',     slug: 'oxidizing-acids',       short: 'Oxidizing acids',     family: 'oxidizing' },
  { code: 'MIN_ACID',    slug: 'mineral-acids',         short: 'Mineral acids',       family: 'corrosive' },
  { code: 'ORG_ACID',    slug: 'organic-acids',         short: 'Organic acids',       family: 'corrosive' },
  { code: 'BASE',        slug: 'bases',                 short: 'Bases',               family: 'corrosive' },
  { code: 'WATER_RX',    slug: 'water-reactives',       short: 'Water-reactives',     family: 'reactive'  },
  { code: 'ORG_PEROX',   slug: 'organic-peroxides',     short: 'Organic peroxides & self-reactives',   family: 'oxidizing' },
  { code: 'GAS',         slug: 'compressed-gases',      short: 'Compressed gases',    family: 'reactive'  },
  { code: 'FLAM_SOL',    slug: 'flammable-solids',      short: 'Flammable solids',    family: 'flammable' },
  { code: 'REACT_METAL', slug: 'reactive-metals',       short: 'Reactive metals',     family: 'reactive'  },
  { code: 'CN_S',        slug: 'cyanides-and-sulfides', short: 'Cyanides & sulfides', family: 'toxic'     },
  { code: 'TOXIC',       slug: 'acute-toxics',          short: 'Acute toxics',        family: 'toxic'     },
]

// Signature colour of the storage tool (its "pillar" colour across tool + pages).
// Teal — analogous to the navy chrome, distinct from the red/amber/green verdict
// semantics. Swap this pair to re-theme the whole ecosystem.
export const SIGNATURE = {
  text: 'text-teal-700',
  textStrong: 'text-teal-800',
  bg: 'bg-teal-600',
  bgHover: 'hover:bg-teal-700',
  border: 'border-teal-500',
  hex: '#0d9488',
  glowRgba: 'rgba(13,148,136,0.5)',
}

// Shared textured hero background for tool + hub + category pages.
// Rebalanced so the MIDDLE reads lighter (not just a bright corner): a lighter
// navy midpoint in the linear base + a large teal glow spread toward centre.
export const HERO_BG =
  'radial-gradient(125% 140% at 68% 18%, rgba(20,184,166,0.5) 0%, rgba(13,148,136,0.12) 46%, transparent 74%),' +
  'linear-gradient(112deg,#0f1f38 0%,#173259 50%,#114c47 100%)'
export const HERO_DOTS = 'radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1px)'

// Hazard-family accent styles (full Tailwind class strings so JIT keeps them).
export const FAMILY_STYLE: Record<
  StorageClass['family'],
  { label: string; borderL: string; dot: string; text: string; tint: string }
> = {
  flammable: { label: 'Flammable', borderL: 'border-l-orange-400', dot: 'bg-orange-400', text: 'text-orange-700', tint: 'bg-orange-50' },
  oxidizing: { label: 'Oxidizing', borderL: 'border-l-amber-400',  dot: 'bg-amber-400',  text: 'text-amber-700',  tint: 'bg-amber-50'  },
  corrosive: { label: 'Corrosive', borderL: 'border-l-blue-400',   dot: 'bg-blue-400',   text: 'text-blue-700',   tint: 'bg-blue-50'   },
  reactive:  { label: 'Reactive',  borderL: 'border-l-violet-400', dot: 'bg-violet-400', text: 'text-violet-700', tint: 'bg-violet-50' },
  toxic:     { label: 'Toxic',     borderL: 'border-l-rose-400',   dot: 'bg-rose-400',   text: 'text-rose-700',   tint: 'bg-rose-50'   },
}

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

/** Hazard-family accent styles for a class code (falls back to a neutral set). */
export const familyStyleForCode = (code: string) => {
  const fam = byCode.get(code)?.family
  return fam ? FAMILY_STYLE[fam] : { label: '', borderL: 'border-l-gray-300', dot: 'bg-gray-300', text: 'text-gray-600', tint: 'bg-gray-50' }
}
