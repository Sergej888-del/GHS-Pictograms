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
  }),
})

export const collections = { blog, compliance }

