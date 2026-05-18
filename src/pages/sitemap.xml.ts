import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

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
  { url: '/compliance/', changefreq: 'weekly', priority: '0.9' },
];

const GHS_PAGES = GHS_CODES.map(code => ({
  url: `/ghs/${code.toLowerCase()}/`,
  changefreq: 'monthly',
  priority: '0.8',
}));

/** Pillar landing pages для Compliance Hub — 4 штуки */
const COMPLIANCE_PILLAR_PAGES = [
  { url: '/compliance/un-ghs/', changefreq: 'weekly', priority: '0.85' },
  { url: '/compliance/osha-hcs/', changefreq: 'weekly', priority: '0.85' },
  { url: '/compliance/clp/', changefreq: 'weekly', priority: '0.85' },
  { url: '/compliance/sds/', changefreq: 'weekly', priority: '0.85' },
  { url: '/compliance/reach/', changefreq: 'weekly', priority: '0.85' },
  { url: '/compliance/svhc/', changefreq: 'weekly', priority: '0.85' },
];

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

async function fetchComplianceSitemapEntries(): Promise<
  { url: string; changefreq: string; priority: string }[]
> {
  const articles = await getCollection('compliance', ({ data }) => !data.draft && data.type !== 'pillar');
  return articles.map((article) => ({
    url: `/compliance/${article.data.pillar}/${article.data.slug}/`,
    changefreq: 'monthly',
    priority: '0.85',
  }));
}

export const GET: APIRoute = async () => {
  const [blogPages, compliancePages] = await Promise.all([
    fetchBlogSitemapEntries(),
    fetchComplianceSitemapEntries(),
  ]);

  const allPages = [
    ...STATIC_PAGES,
    ...GHS_PAGES,
    ...COMPLIANCE_PILLAR_PAGES,
    ...compliancePages,
    ...blogPages,
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
