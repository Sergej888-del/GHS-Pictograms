import type { APIRoute } from 'astro'
import { createClient } from '@supabase/supabase-js'
import { getCollection } from 'astro:content'

export const prerender = false

export const GET: APIRoute = async () => {
  const supabase = createClient(
    import.meta.env.PUBLIC_SUPABASE_URL!,
    import.meta.env.PUBLIC_SUPABASE_ANON_KEY!
  )

  // Статические страницы
  const staticPages = [
    'https://ghspictograms.com/',
    'https://ghspictograms.com/pictograms/',
    'https://ghspictograms.com/inspector/',
    'https://ghspictograms.com/faq/',
    'https://ghspictograms.com/label-constructor/',
    'https://ghspictograms.com/blog/',
    'https://ghspictograms.com/ghs/ghs01/',
    'https://ghspictograms.com/ghs/ghs02/',
    'https://ghspictograms.com/ghs/ghs03/',
    'https://ghspictograms.com/ghs/ghs04/',
    'https://ghspictograms.com/ghs/ghs05/',
    'https://ghspictograms.com/ghs/ghs06/',
    'https://ghspictograms.com/ghs/ghs07/',
    'https://ghspictograms.com/ghs/ghs08/',
    'https://ghspictograms.com/ghs/ghs09/',
  ]

  // Загрузить CAS номера из Supabase для /pictograms/[cas]/ страниц
  const casUrls: string[] = []
  let from = 0
  while (true) {
    const { data } = await supabase
      .from('substances')
      .select('cas_number')
      .not('cas_number', 'is', null)
      .range(from, from + 999)
    if (!data?.length) break
    data.forEach((r: { cas_number: string }) => {
      casUrls.push(`https://ghspictograms.com/pictograms/${encodeURIComponent(r.cas_number)}/`)
    })
    if (data.length < 1000) break
    from += 1000
  }

  // Посты блога из content collection (MDX), не из Supabase
  const blogUrls: string[] = []
  const posts = await getCollection('blog')
  posts.forEach((p) => {
    blogUrls.push(`https://ghspictograms.com/blog/${p.id}/`)
  })

  const allUrls = [...staticPages, ...casUrls, ...blogUrls]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (url) => `  <url>
    <loc>${url}</loc>
    <changefreq>monthly</changefreq>
    <priority>${url === 'https://ghspictograms.com/' ? '1.0' : '0.8'}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
