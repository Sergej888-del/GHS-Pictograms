import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { supabase } from '../lib/supabase';
import { hSlug } from '../lib/hStatementSlug';
// ⚠ Имя и адрес вещества берём из тех же функций, по которым getStaticPaths
// строит /substances/[slug]. Собрать адрес здесь второй раз — значит рано или
// поздно объявить в sitemap страницу, которой нет.
import { substanceNameFull, substanceTitleName, NAME_COLUMNS } from '../lib/substanceName';
import { substanceHref } from '../lib/substanceSlug';

export const prerender = true;

const SITE_URL = 'https://ghspictograms.com';
const GHS_CODES = [
  'GHS01','GHS02','GHS03','GHS04',
  'GHS05','GHS06','GHS07','GHS08','GHS09'
];

/** Хабы и ключевые разделы (без отдельных статей блога — они из коллекции). */
const STATIC_PAGES = [
  { url: '/', changefreq: 'weekly', priority: '1.0' },
  // ⚠ session 23: /pictograms/ — хаб пиктограмм под головной запрос кластера,
  // /substances/ — переехавший браузер веществ. Раньше на первом стоял браузер,
  // и адрес отдавал 301 на ghssymbols: sitemap звал краулера на редирект.
  { url: '/pictograms/', changefreq: 'weekly', priority: '0.9' },
  // ⚠ session 29: /hazard-classes/ — верхний этаж иерархии (класс → категория →
  // пиктограмма/H/P). Волна 4 Semrush: `hazard classes` 1300, `ghs classification` 1300,
  // `how many hazard classes are there` 1000 при KD 26. Раздаёт вес на 225 страниц H/P-кодов.
  { url: '/hazard-classes/', changefreq: 'weekly', priority: '0.9' },
  { url: '/substances/', changefreq: 'weekly', priority: '0.8' },
  { url: '/inspector/', changefreq: 'monthly', priority: '0.8' },
  { url: '/faq/', changefreq: 'monthly', priority: '0.7' },
  { url: '/blog/', changefreq: 'weekly', priority: '0.8' },
  { url: '/tools/', changefreq: 'weekly', priority: '0.85' },
  { url: '/tools/ate-mixture-calculator/', changefreq: 'weekly', priority: '0.85' },
  { url: '/label-constructor/', changefreq: 'weekly', priority: '0.85' },
  { url: '/pictogram-selector/', changefreq: 'weekly', priority: '0.85' },
  { url: '/compliance/', changefreq: 'weekly', priority: '0.9' },
  // ⚠ session 32: юридические страницы отсутствовали в sitemap, хотя индексируются
  // и на них ведут ссылки из подвала. Нашла проверка sitemap-both-ways в check-seo.
  { url: '/privacy/', changefreq: 'yearly', priority: '0.3' },
  { url: '/terms/', changefreq: 'yearly', priority: '0.3' },
  { url: '/affiliate-disclosure/', changefreq: 'yearly', priority: '0.3' },
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
  { url: '/compliance/ehs/', changefreq: 'weekly', priority: '0.85' },
];

/** Storage-compatibility tool, hub and the 5 indexable category pages (P4 prose). */
const STORAGE_PAGES = [
  { url: '/tools/chemical-storage-compatibility/', changefreq: 'weekly', priority: '0.85' },
  { url: '/storage-compatibility/', changefreq: 'weekly', priority: '0.9' },
  { url: '/storage-compatibility/flammable-liquids/', changefreq: 'monthly', priority: '0.7' },
  { url: '/storage-compatibility/oxidizers/', changefreq: 'monthly', priority: '0.7' },
  { url: '/storage-compatibility/water-reactives/', changefreq: 'monthly', priority: '0.7' },
  { url: '/storage-compatibility/organic-peroxides/', changefreq: 'monthly', priority: '0.7' },
  { url: '/storage-compatibility/acute-toxics/', changefreq: 'monthly', priority: '0.7' },
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

/** SDS library: hub + every live page from the sds_pages registry (grows with no code change). */
async function fetchSdsSitemapEntries(): Promise<
  { url: string; changefreq: string; priority: string }[]
> {
  // ⚠ Падать громко на ошибке, деградировать тихо на пустоте (session 31).
  // Молча пустой ответ здесь означает sitemap без 109 URL и никакого следа в логе.
  const res = await supabase.from('sds_pages').select('slug').eq('status', 'live');
  if (res.error) throw new Error(`sitemap: sds_pages — ${res.error.message}`);
  const live = res.data ?? [];
  return [
    { url: '/sds/', changefreq: 'weekly', priority: '0.9' },
    ...live.map((p) => ({
      url: `/sds/${p.slug}/`,
      changefreq: 'monthly',
      priority: '0.85',
    })),
  ];
}

/**
 * SDS format: the /sds-sections/ hub + one page per section that has a prose
 * entry. Read from the collection, not from SDS_SECTIONS — the spine knows all
 * 16, but only an entry gives a section a URL, and the sitemap must never
 * announce a page the route does not build.
 */
async function fetchSdsSectionSitemapEntries(): Promise<
  { url: string; changefreq: string; priority: string }[]
> {
  const entries = await getCollection('sdsSections', ({ data }) => !data.draft);
  return [
    { url: '/sds-sections/', changefreq: 'weekly', priority: '0.9' },
    ...entries
      .sort((a, b) => a.data.n - b.data.n)
      .map((e) => ({
        url: `/sds-sections/${e.data.slug}/`,
        changefreq: 'monthly',
        priority: '0.85',
      })),
  ];
}

/** Precautionary statements: hub + every code in the registry (grows with no code change). */
async function fetchPStatementSitemapEntries(): Promise<
  { url: string; changefreq: string; priority: string }[]
> {
  const res = await supabase.from('p_statements').select('code');
  if (res.error) throw new Error(`sitemap: p_statements — ${res.error.message}`);
  const codes = res.data ?? [];
  return [
    { url: '/p-statements/', changefreq: 'weekly', priority: '0.9' },
    ...codes.map((c: { code: string }) => ({
      url: `/p-statements/${c.code}/`,
      changefreq: 'monthly',
      priority: '0.7',
    })),
  ];
}

/** Hazard statements: hub + every code in the registry (grows with no code change). */
async function fetchHStatementSitemapEntries(): Promise<
  { url: string; changefreq: string; priority: string }[]
> {
  const res = await supabase.from('h_statements').select('code');
  if (res.error) throw new Error(`sitemap: h_statements — ${res.error.message}`);
  const codes = res.data ?? [];
  return [
    { url: '/h-statements/', changefreq: 'weekly', priority: '0.9' },
    ...codes.map((c: { code: string }) => ({
      url: `/h-statements/${hSlug(c.code)}/`,
      changefreq: 'monthly',
      priority: '0.7',
    })),
  ];
}

/**
 * Справочник веществ: по странице на каждое вещество с пригодным CAS.
 *
 * ⚠ Хаб /substances/ сюда НЕ входит — он уже стоит в STATIC_PAGES,
 * и второй <loc> на тот же адрес — это дубль в sitemap.
 *
 * ⚠⚠ ОТБОР ОБЯЗАН СОВПАДАТЬ СО СТРАНИЦЕЙ.
 * getStaticPaths в src/pages/substances/[slug].astro берёт cas_number строгой
 * формы \d{2,7}-\d{2}-\d — ровно это же здесь. 156 записей несут многосоставный
 * CAS, обрезанный varchar(20) («110-45-2[1]35073-27-»), ещё 3 — склеенный или
 * пустой; страниц для них нет.
 * Сверка в обе стороны живёт в check:dist, проверка subs-sitemap.
 *
 * ⚠ Пагинация по 1000 с order('cas_number'): PostgREST отдаёт не больше 1000
 * строк за раз, а веществ 4 178. Без ORDER BY окна range() могут перекрыться
 * и разойтись с набором страниц.
 */
async function fetchSubstanceSitemapEntries(): Promise<
  { url: string; changefreq: string; priority: string }[]
> {
  type Row = {
    cas_number: string;
    common_name: string | null;
    display_name_short: string | null;
    iupac_name: string | null;
  };

  const PAGE = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await supabase
      .from('substances')
      .select(`cas_number, ${NAME_COLUMNS}`)
      .not('cas_number', 'is', null)
      .order('cas_number')
      .range(from, from + PAGE - 1);
    // ⚠ Падать громко на ошибке, деградировать тихо на пустоте (session 31).
    if (res.error) throw new Error(`sitemap: substances — ${res.error.message}`);
    const chunk = (res.data ?? []) as Row[];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }

  // ⚠⚠ Отбор ОБЯЗАН совпадать с getStaticPaths в src/pages/substances/[slug].astro:
  // строгая форма CAS, а не просто отсутствие '['. Три записи (`-`,
  // `127087-87-09016-45-9`, `3811-73-215922-78-8`) скобки не содержат, но CAS не являются.
  const clean = rows.filter((r) => r.cas_number && /^\d{2,7}-\d{2}-\d$/.test(r.cas_number));

  // ⚠ Буквенные страницы указателя строятся из ТОГО ЖЕ набора, что и страницы
  // веществ, и по тому же правилу первой буквы, что в
  // src/pages/substances/browse/[letter].astro. Разъедься они — в sitemap попадёт
  // буква, для которой страницы нет.
  const letters = new Set<string>();
  for (const r of clean) {
    const c = substanceTitleName(substanceNameFull(r)).trim().charAt(0).toLowerCase();
    letters.add(c >= 'a' && c <= 'z' ? c : '0-9');
  }

  return [
    ...[...letters]
      .sort()
      .map((l) => ({ url: `/substances/browse/${l}/`, changefreq: 'weekly', priority: '0.5' })),
    ...clean.map((r) => ({
      url: substanceHref(substanceNameFull(r), r.cas_number),
      changefreq: 'monthly',
      priority: '0.7',
    })),
  ];
}

export const GET: APIRoute = async () => {
  const [
    blogPages,
    compliancePages,
    sdsPages,
    sdsSectionPages,
    pStatementPages,
    hStatementPages,
    substancePages,
  ] = await Promise.all([
    fetchBlogSitemapEntries(),
    fetchComplianceSitemapEntries(),
    fetchSdsSitemapEntries(),
    fetchSdsSectionSitemapEntries(),
    fetchPStatementSitemapEntries(),
    fetchHStatementSitemapEntries(),
    fetchSubstanceSitemapEntries(),
  ]);

  const allPages = [
    ...STATIC_PAGES,
    ...GHS_PAGES,
    ...COMPLIANCE_PILLAR_PAGES,
    ...STORAGE_PAGES,
    ...sdsPages,
    ...sdsSectionPages,
    ...pStatementPages,
    ...hStatementPages,
    ...substancePages,
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
