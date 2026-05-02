import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { supabase } from '../lib/supabase';
import { prioritizePictogramSubstances, type SubstanceRow } from '../lib/pictogramCasPaths';

export const prerender = true;

const SITE_URL = 'https://ghspictograms.com';

const GHS_CODES = [
  'GHS01','GHS02','GHS03','GHS04',
  'GHS05','GHS06','GHS07','GHS08','GHS09'
];

/** Хабы и ключевые разделы (без отдельных статей блога — они из коллекции). */
const STATIC_PAGES = [
  { url: '/', changefreq: 'weekly', priority: '1.0' },
  { url: '/pictograms/', changefreq: 'weekly', priority: '0.9' },
  { url: '/inspector/', changefreq: 'monthly', priority: '0.8' },
  { url: '/faq/', changefreq: 'monthly', priority: '0.7' },
  { url: '/blog/', changefreq: 'weekly', priority: '0.8' },
  { url: '/label-constructor/', changefreq: 'weekly', priority: '0.85' },
];

const GHS_PAGES = GHS_CODES.map(code => ({
  url: `/ghs/${code.toLowerCase()}/`,
  changefreq: 'monthly',
  priority: '0.8',
}));

async function fetchTop200PictogramUrls(): Promise<
  { url: string; changefreq: string; priority: string }[]
> {
  const rows: SubstanceRow[] = [];
  let from = 0;
  const batch = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('substances')
      .select(
        'cas_number, common_name, iupac_name, ghs_pictogram_codes, h_statement_codes, p_statement_codes, signal_word, ec_number'
      )
      .not('ghs_pictogram_codes', 'is', null)
      .range(from, from + batch - 1);

    if (error) throw error;
    if (!data?.length) break;

    for (const row of data as SubstanceRow[]) {
      if ((row.ghs_pictogram_codes?.length ?? 0) > 0 && row.cas_number?.trim()) {
        rows.push(row);
      }
    }
    if (data.length < batch) break;
    from += batch;
  }

  const top200 = prioritizePictogramSubstances(rows).slice(0, 200);

  return top200.map((s) => ({
    url: `/pictograms/${encodeURIComponent(s.cas_number)}/`,
    changefreq: 'monthly',
    priority: '0.72',
  }));
}

async function fetchBlogSitemapEntries(): Promise<
  { url: string; changefreq: string; priority: string }[]
> {
  const posts = await getCollection('blog', ({ data }) => !data.draft)
  return posts.map((post) => ({
    url: `/blog/${post.id}/`,
    changefreq: 'monthly',
    priority: '0.8',
  }))
}

export const GET: APIRoute = async () => {
  const [pictogramPages, blogPages] = await Promise.all([
    fetchTop200PictogramUrls(),
    fetchBlogSitemapEntries(),
  ]);

  const allPages = [
    ...STATIC_PAGES,
    ...GHS_PAGES,
    ...blogPages,
    ...pictogramPages,
  ];

  const today = new Date().toISOString().split('T')[0];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map(page => `  <url>
    <loc>${SITE_URL}${page.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
