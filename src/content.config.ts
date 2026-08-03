import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    author: z.string().optional(),
    tags: z.array(z.string()).default([]),
    image: z.string().optional(),
    draft: z.boolean().default(false),
  }),
})

const compliance = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/compliance' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    slug: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.string(),
    pillar: z.string(),
    type: z.string(),
    draft: z.boolean().default(false),
    language: z.string().default('en-US'),
    author: z.string().optional(),
    schemaType: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    relatedPages: z.array(z.string()).optional(),
    crossDomainLinks: z.array(z.string()).optional(),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  }),
})

// Storage-class category pages (/storage-compatibility/<slug>/).
// Editorial prose is OPTIONAL: the page renders a data-driven skeleton from the
// RPCs even with no entry; an entry (filename = class slug) adds intro + body
// prose + FAQ, and flips the page from draft/noindex to publishable.
const storageClasses = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/storage-classes' }),
  schema: z.object({
    slug: z.string(),                 // MUST equal the storage-class slug (filename)
    title: z.string(),                // <title> / H1 (EHS angle)
    description: z.string(),          // meta description
    intro: z.string().optional(),     // lead paragraph under the hero
    updatedDate: z.coerce.date().optional(),
    keywords: z.array(z.string()).optional(),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
    draft: z.boolean().default(false),
  }),
})

// SDS section pages (/sds-sections/section-<n>-<name>/, session 31).
// UNLIKE storageClasses, prose here is NOT optional — an entry IS the page, and
// its absence simply means that section has no URL yet (see [slug].astro).
// ⚠ `checklist` carries THREE separate lists, one per legal text, because the
// three texts do not share a subsection structure: REACH Annex II numbers
// 8.1.1.1–8.1.1.5, OSHA Appendix D has three lettered items for the whole of
// section 8, and GHS Annex 4 numbers A4.3.8.x. Flattening them into one list
// with jurisdiction flags would misstate all three.
const sdsSectionItem = z.object({
  id: z.string(),        // subsection number exactly as the text prints it
  title: z.string(),     // heading, or a short label where the text has none
  what: z.string(),      // what satisfies it — may contain inline HTML
})

const sdsSections = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/sds-sections' }),
  schema: z.object({
    n: z.number().int().min(1).max(16),
    slug: z.string(),                 // MUST equal SDS_SECTIONS[n].slug in src/lib/sdsSections.ts
    title: z.string(),                // <title>, ≤60 chars, carries "SDS Section N"
    description: z.string(),          // meta description, ≤155 chars
    intro: z.string(),                // hero sub-line
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    draft: z.boolean().default(false),
    keywords: z.array(z.string()).default([]),
    checklist: z.object({
      eu: z.array(sdsSectionItem).default([]),
      us: z.array(sdsSectionItem).default([]),
      un: z.array(sdsSectionItem).default([]),
    }),
    diffs: z.array(z.object({ point: z.string(), eu: z.string(), us: z.string() })).default([]),
    errors: z.array(z.object({ title: z.string(), body: z.string() })).default([]),
    related: z.array(z.object({ href: z.string(), label: z.string(), note: z.string() })).default([]),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    sources: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
    affiliateBody: z.string(),        // SDS Manager bridge copy, tailored per section
  }),
})

export const collections = { blog, compliance, storageClasses, sdsSections }
