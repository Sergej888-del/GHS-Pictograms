import type { APIRoute } from 'astro';
import { supabase } from '../lib/supabase';

export const prerender = true;

const SITE_URL = 'https://ghspictograms.com';

const GHS_CODES = [
  'GHS01','GHS02','GHS03','GHS04',
  'GHS05','GHS06','GHS07','GHS08','GHS09'
];

const STATIC_PAGES = [
  { url: '/', changefreq: 'weekly', priority: '1.0' },
  { url: '/pictograms/', changefreq: 'weekly', priority: '0.9' },
  { url: '/inspector/', changefreq: 'monthly', priority: '0.8' },
  { url: '/faq/', changefreq: 'monthly', priority: '0.7' },
  { url: '/blog/', changefreq: 'weekly', priority: '0.8' },
  { url: '/blog/ghs-vs-adr-key-differences/', changefreq: 'monthly', priority: '0.8' },
  { url: '/blog/adr-hazard-classes-guide/', changefreq: 'monthly', priority: '0.8' },
  { url: '/blog/how-to-read-ghs-label/', changefreq: 'monthly', priority: '0.8' },
  { url: '/label-constructor/', changefreq: 'weekly', priority: '0.85' },
];

const GHS_PAGES = GHS_CODES.map(code => ({
  url: `/ghs/${code.toLowerCase()}/`,
  changefreq: 'monthly',
  priority: '0.8',
}));

async function fetchPictogramsSubstanceUrls(): Promise<{ url: string; changefreq: string; priority: string }[]> {
  const rows: { cas_number: string }[] = [];
  let from = 0;
  const batch = 1000;
  while (true) {
    const { data } = await supabase
      .from('substances')
      .select('cas_number, ghs_pictogram_codes')
      .not('cas_number', 'is', null)
      .not('ghs_pictogram_codes', 'is', null)
      .range(from, from + batch - 1);

    if (!data?.length) break;
    for (const r of data as { cas_number: string; ghs_pictogram_codes: string[] | null }) {
      if ((r.ghs_pictogram_codes?.length ?? 0) > 0 && r.cas_number?.trim()) {
        rows.push({ cas_number: r.cas_number });
      }
    }
    if (data.length < batch) break;
    from += batch;
  }

  return rows.map((s) => ({
    url: `/pictograms/${encodeURIComponent(s.cas_number)}/`,
    changefreq: 'monthly',
    priority: '0.72',
  }));
}

export const GET: APIRoute = async () => {
  const pictogramPages = await fetchPictogramsSubstanceUrls();

  const allPages = [
    ...STATIC_PAGES,
    ...GHS_PAGES,
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
