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

export const collections = { blog, compliance, storageClasses }
