/**
 * scripts/check-seo.ts — SEO-здоровье собранного dist/. БЕЗ СЕТИ И БЕЗ БАЗЫ.
 *
 * Запуск из корня ghspictograms, ПОСЛЕ сборки:
 *   npm run check:seo
 *   npm run check:seo -- --dist ..\some\other\dist
 *   npm run check:seo -- --only links
 *
 * ⚠ Зачем отдельно от check-dist.ts. Тот сверяет dist с ЖИВОЙ БАЗОЙ и отвечает
 * на вопрос «доехало ли содержимое». Этот отвечает на другой: «может ли робот
 * это обойти и не запутаться». Ему база не нужна вовсе — только папка dist,
 * поэтому он гоняется где угодно и за секунды.
 *
 * ПРАВИЛА (session 32):
 *  1. Ни одного порога «из головы»: то, что не является объективной ошибкой
 *     (длина title, глубина клика), печатается как ПРЕДУПРЕЖДЕНИЕ и не роняет
 *     прогон. Красным становится только сломанное: битая ссылка, кривой
 *     canonical, дубль title, невалидный JSON-LD, расхождение с sitemap.
 *  2. Страницы с <meta name="robots" content="noindex"> исключаются из
 *     индексных проверок: /subscribed/ — экран после подписки, у него нет
 *     ни canonical, ни места в sitemap, и требовать их — ложная тревога.
 *  3. Считаются СТРАНИЦЫ, а не вхождения.
 *
 * Код возврата: 0 — ошибок нет (предупреждения могут быть); 1 — есть ошибка.
 */

import { resolve, join } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const SITE = 'https://ghspictograms.com'

// ─────────────────────────── аргументы ───────────────────────────

const ARGV = process.argv.slice(2)
function argValue(name: string): string | null {
  const i = ARGV.indexOf(name)
  if (i >= 0 && ARGV[i + 1] && !ARGV[i + 1].startsWith('--')) return ARGV[i + 1]
  const eq = ARGV.find((a) => a.startsWith(`${name}=`))
  return eq ? eq.slice(name.length + 1) : null
}

const DIST = resolve(process.cwd(), argValue('--dist') ?? 'dist')
const ONLY = argValue('--only')

if (!existsSync(DIST)) {
  console.error(`Нет папки ${DIST}. Сначала соберите проект.`)
  process.exit(1)
}

// ─────────────────────────── чтение dist ───────────────────────────

interface Page {
  /** URL с ведущим и замыкающим слэшем: /sds/toluene/ */
  url: string
  /** путь файла относительно dist */
  rel: string
  html: string
}

/** Все .html рекурсивно. _astro пропускаем — там ассеты, а не страницы. */
function readPages(): Page[] {
  const out: Page[] = []
  const walk = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === '_astro') continue
        walk(join(dir, e.name), `${prefix}${e.name}/`)
      } else if (e.name.endsWith('.html')) {
        const rel = `${prefix}${e.name}`
        const url = e.name === 'index.html' ? `/${prefix}` : `/${rel}`
        out.push({ url, rel, html: readFileSync(join(dir, e.name), 'utf8') })
      }
    }
  }
  walk(DIST, '')
  return out
}

/** Все файлы dist — чтобы отличить «ссылка на несуществующую страницу» от ссылки на ассет. */
function readAllFiles(): Set<string> {
  const out = new Set<string>()
  const walk = (dir: string, prefix: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${prefix}${e.name}/`)
      else out.add(`${prefix}${e.name}`)
    }
  }
  walk(DIST, '')
  return out
}

const PAGES = readPages()
const FILES = readAllFiles()
const BY_URL = new Map(PAGES.map((p) => [p.url, p]))

// ─────────────────────────── разбор HTML ───────────────────────────

const rx = (html: string, re: RegExp): string[] => [...html.matchAll(re)].map((m) => m[1])

function tagContent(html: string, tag: string): string | null {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

function metaContent(html: string, name: string): string | null {
  const m =
    html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i')) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${name}["']`, 'i'))
  return m ? m[1].trim() : null
}

function linkHref(html: string, rel: string): string | null {
  const m =
    html.match(new RegExp(`<link[^>]+rel=["']${rel}["'][^>]*href=["']([^"']*)["']`, 'i')) ??
    html.match(new RegExp(`<link[^>]+href=["']([^"']*)["'][^>]*rel=["']${rel}["']`, 'i'))
  return m ? m[1].trim() : null
}

/** Декодирует то немногое, что Astro экранирует в атрибутах. */
const unesc = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&#43;/g, '+').replace(/&quot;/g, '"')

// ⚠ Проверяем УЖЕ ИЗВЛЕЧЁННОЕ значение, а не разметку вокруг него. Первая версия
// искала в нём же подстроку `content="…noindex`, то есть не находила никогда —
// и /subscribed/ (у неё честный `noindex, follow`) попадала во все индексные
// проверки сразу как сирота без canonical и без description (session 32).
const isNoindex = (html: string): boolean => /\bnoindex\b/i.test(metaContent(html, 'robots') ?? '')

/**
 * Внутренние ссылки страницы, приведённые к виду /path/.
 * ⚠ Только href. Ссылки внутри <script type="application/ld+json"> в разбор
 * не попадают — там URL не кликают, и требовать от них файла бессмысленно.
 */
function internalLinks(html: string): string[] {
  const out: string[] = []
  for (const raw of rx(html, /<a[^>]+href=["']([^"']+)["']/gi)) {
    let href = unesc(raw).trim()
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue
    if (href.startsWith(SITE)) href = href.slice(SITE.length) || '/'
    if (/^[a-z]+:\/\//i.test(href)) continue // внешний домен
    href = href.split('#')[0].split('?')[0]
    if (!href) continue
    if (!href.startsWith('/')) continue // относительных на сайте нет; если появятся — отдельный разговор
    out.push(href)
  }
  return out
}

// ─────────────────────────── отчёт ───────────────────────────

type Level = 'error' | 'warn'
interface Result {
  id: string
  group: string
  ok: boolean
  level: Level
  headline: string
  detail: string[]
}
interface Check {
  id: string
  group: string
  title: string
  level: Level
  run: () => Result
}

const preview = (list: string[], max = 15): string[] =>
  list.length <= max ? list : [...list.slice(0, max), `... и ещё ${list.length - max}`]

// ─────────────────────────── проверки ───────────────────────────

const CHECKS: Check[] = [
  {
    id: 'links-broken',
    group: 'Ссылки',
    title: 'Внутренние ссылки ведут на существующие страницы',
    level: 'error',
    run: () => {
      // ⚠ Это ровно тот дефект, что дал 30 битых ссылок в session 29 и живую
      // битую ссылку на /compliance/global-ghs/, которая висит с тех пор.
      const broken = new Map<string, Set<string>>()
      for (const p of PAGES) {
        for (const href of internalLinks(p.html)) {
          const asPage = href.endsWith('/') ? `${href}index.html` : null
          const direct = href.slice(1)
          const okPage = BY_URL.has(href) || (asPage && FILES.has(asPage.slice(1)))
          const okFile = FILES.has(direct)
          // Ссылка без замыкающего слэша на существующую папку — тоже рабочая
          // (сервер отдаст редирект), но пусть будет видно.
          const okDir = !href.endsWith('/') && FILES.has(`${direct}/index.html`)
          if (!okPage && !okFile && !okDir) {
            if (!broken.has(href)) broken.set(href, new Set())
            broken.get(href)!.add(p.url)
          }
        }
      }
      const detail = [...broken.entries()]
        .sort((a, b) => b[1].size - a[1].size)
        .map(([href, from]) => `${href} <- ${from.size} стр.: ${[...from].slice(0, 4).join(', ')}`)
      return {
        id: 'links-broken',
        group: 'Ссылки',
        ok: detail.length === 0,
        level: 'error',
        headline: detail.length === 0 ? `битых внутренних ссылок нет` : `битых адресов: ${broken.size}`,
        detail: detail.length ? preview(detail) : [`проверено страниц: ${PAGES.length}`],
      }
    },
  },
  {
    id: 'links-trailing-slash',
    group: 'Ссылки',
    title: 'Внутренние ссылки на страницы идут со слэшем на конце',
    level: 'warn',
    run: () => {
      // Сайт собран в режиме «папка + index.html»: /sds/toluene и /sds/toluene/
      // — это лишний редирект и раздвоенный адрес для робота.
      const bad = new Map<string, Set<string>>()
      for (const p of PAGES) {
        for (const href of internalLinks(p.html)) {
          if (href.endsWith('/')) continue
          if (FILES.has(href.slice(1))) continue // это файл, ему слэш не нужен
          if (FILES.has(`${href.slice(1)}/index.html`)) {
            if (!bad.has(href)) bad.set(href, new Set())
            bad.get(href)!.add(p.url)
          }
        }
      }
      const detail = [...bad.entries()].map(([href, from]) => `${href} <- ${from.size} стр.`)
      return {
        id: 'links-trailing-slash',
        group: 'Ссылки',
        ok: detail.length === 0,
        level: 'warn',
        headline: detail.length === 0 ? 'все ссылки со слэшем' : `без слэша: ${bad.size} адресов`,
        detail: preview(detail),
      }
    },
  },
  {
    id: 'canonical-self',
    group: 'Мета',
    title: 'canonical совпадает с собственным адресом страницы',
    level: 'error',
    run: () => {
      const missing: string[] = []
      const wrong: string[] = []
      for (const p of PAGES) {
        if (isNoindex(p.html)) continue
        const c = linkHref(p.html, 'canonical')
        if (!c) {
          missing.push(p.url)
          continue
        }
        const expected = `${SITE}${p.url}`
        if (unesc(c) !== expected) wrong.push(`${p.url} -> ${c}`)
      }
      const detail: string[] = []
      if (missing.length) detail.push(`без canonical (${missing.length}): ${preview(missing, 8).join(', ')}`)
      if (wrong.length) detail.push(...preview(wrong.map((w) => `не свой canonical: ${w}`)))
      return {
        id: 'canonical-self',
        group: 'Мета',
        ok: detail.length === 0,
        level: 'error',
        headline:
          detail.length === 0
            ? `canonical на месте у всех ${PAGES.filter((p) => !isNoindex(p.html)).length} индексируемых страниц`
            : `проблем: ${missing.length + wrong.length}`,
        detail,
      }
    },
  },
  {
    id: 'title-unique',
    group: 'Мета',
    title: 'title есть у каждой страницы и не повторяется',
    level: 'error',
    run: () => {
      const byTitle = new Map<string, string[]>()
      const empty: string[] = []
      for (const p of PAGES) {
        if (isNoindex(p.html)) continue
        const t = tagContent(p.html, 'title')
        if (!t) {
          empty.push(p.url)
          continue
        }
        if (!byTitle.has(t)) byTitle.set(t, [])
        byTitle.get(t)!.push(p.url)
      }
      const dups = [...byTitle.entries()].filter(([, urls]) => urls.length > 1)
      const detail: string[] = []
      if (empty.length) detail.push(`без title (${empty.length}): ${preview(empty, 8).join(', ')}`)
      for (const [t, urls] of dups.slice(0, 10)) {
        detail.push(`"${t.slice(0, 70)}" -> ${urls.length}: ${urls.slice(0, 4).join(', ')}`)
      }
      if (dups.length > 10) detail.push(`... и ещё ${dups.length - 10} повторов`)
      return {
        id: 'title-unique',
        group: 'Мета',
        ok: empty.length === 0 && dups.length === 0,
        level: 'error',
        headline:
          empty.length === 0 && dups.length === 0
            ? `${byTitle.size} уникальных title`
            : `пустых ${empty.length}, повторов ${dups.length}`,
        detail,
      }
    },
  },
  {
    id: 'description-unique',
    group: 'Мета',
    title: 'description есть у каждой страницы и не повторяется',
    level: 'error',
    run: () => {
      const byDesc = new Map<string, string[]>()
      const empty: string[] = []
      for (const p of PAGES) {
        if (isNoindex(p.html)) continue
        const d = metaContent(p.html, 'description')
        if (!d) {
          empty.push(p.url)
          continue
        }
        if (!byDesc.has(d)) byDesc.set(d, [])
        byDesc.get(d)!.push(p.url)
      }
      const dups = [...byDesc.entries()].filter(([, urls]) => urls.length > 1)
      const detail: string[] = []
      if (empty.length) detail.push(`без description (${empty.length}): ${preview(empty, 8).join(', ')}`)
      for (const [d, urls] of dups.slice(0, 10)) {
        detail.push(`"${d.slice(0, 70)}" -> ${urls.length}: ${urls.slice(0, 4).join(', ')}`)
      }
      if (dups.length > 10) detail.push(`... и ещё ${dups.length - 10} повторов`)
      return {
        id: 'description-unique',
        group: 'Мета',
        ok: empty.length === 0 && dups.length === 0,
        level: 'error',
        headline:
          empty.length === 0 && dups.length === 0
            ? `${byDesc.size} уникальных description`
            : `пустых ${empty.length}, повторов ${dups.length}`,
        detail,
      }
    },
  },
  {
    id: 'meta-length',
    group: 'Мета',
    title: 'Длины title и description в разумных пределах',
    level: 'warn',
    run: () => {
      // ⚠ Предупреждение, не ошибка: Google всё равно переписывает сниппет, и
      // ронять из-за длины прогон значило бы заводить красный там, где решение
      // редакторское. Границы взяты по ширине выдачи: title до ~60 знаков,
      // description 70–165.
      const longT: string[] = []
      const shortT: string[] = []
      const longD: string[] = []
      const shortD: string[] = []
      for (const p of PAGES) {
        if (isNoindex(p.html)) continue
        const t = tagContent(p.html, 'title') ?? ''
        const d = metaContent(p.html, 'description') ?? ''
        if (t.length > 65) longT.push(`${p.url} (${t.length})`)
        if (t && t.length < 25) shortT.push(`${p.url} (${t.length})`)
        if (d.length > 165) longD.push(`${p.url} (${d.length})`)
        if (d && d.length < 70) shortD.push(`${p.url} (${d.length})`)
      }
      const detail: string[] = []
      if (longT.length) detail.push(`title длиннее 65 (${longT.length}): ${preview(longT, 6).join(', ')}`)
      if (shortT.length) detail.push(`title короче 25 (${shortT.length}): ${preview(shortT, 6).join(', ')}`)
      if (longD.length) detail.push(`description длиннее 165 (${longD.length}): ${preview(longD, 6).join(', ')}`)
      if (shortD.length) detail.push(`description короче 70 (${shortD.length}): ${preview(shortD, 6).join(', ')}`)
      const n = longT.length + shortT.length + longD.length + shortD.length
      return {
        id: 'meta-length',
        group: 'Мета',
        ok: n === 0,
        level: 'warn',
        headline: n === 0 ? 'длины в пределах' : `за пределами: ${n} случаев`,
        detail,
      }
    },
  },
  {
    id: 'jsonld-valid',
    group: 'Разметка',
    title: 'Каждый блок JSON-LD разбирается и несёт @type',
    level: 'error',
    run: () => {
      const bad: string[] = []
      let blocks = 0
      for (const p of PAGES) {
        const scripts = rx(p.html, /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
        for (const s of scripts) {
          blocks++
          try {
            const data = JSON.parse(s)
            // ⚠ Три законные формы блока, и все три надо принимать:
            //   объект · массив объектов · объект с @graph (им собраны страницы
            //   /ghs/<code>/ и калькулятор ATE). Первая версия проверки знала
            //   только две и объявила 10 валидных блоков сломанными.
            const root = data as any
            const items: unknown[] = Array.isArray(data)
              ? data
              : root && typeof root === 'object' && Array.isArray(root['@graph'])
                ? root['@graph']
                : [data]
            if (!Array.isArray(data) && root && typeof root === 'object' && !('@context' in root)) {
              bad.push(`${p.url}: блок без @context`)
            }
            for (const item of items) {
              if (!item || typeof item !== 'object') bad.push(`${p.url}: элемент не объект`)
              else if (!('@type' in item)) bad.push(`${p.url}: элемент без @type`)
            }
          } catch (e) {
            bad.push(`${p.url}: не разбирается — ${String(e).slice(0, 80)}`)
          }
        }
      }
      return {
        id: 'jsonld-valid',
        group: 'Разметка',
        ok: bad.length === 0,
        level: 'error',
        headline: bad.length === 0 ? `${blocks} блоков JSON-LD, все валидны` : `сломанных блоков: ${bad.length}`,
        detail: bad.length ? preview(bad) : [`проверено блоков: ${blocks}`],
      }
    },
  },
  {
    id: 'h1-single',
    group: 'Разметка',
    title: 'На странице ровно один <h1>',
    level: 'warn',
    run: () => {
      const bad: string[] = []
      for (const p of PAGES) {
        if (isNoindex(p.html)) continue
        const n = (p.html.match(/<h1[\s>]/gi) ?? []).length
        if (n !== 1) bad.push(`${p.url} (${n})`)
      }
      return {
        id: 'h1-single',
        group: 'Разметка',
        ok: bad.length === 0,
        level: 'warn',
        headline: bad.length === 0 ? 'у всех страниц ровно один h1' : `не один h1: ${bad.length} страниц`,
        detail: preview(bad),
      }
    },
  },
  {
    id: 'sitemap-both-ways',
    group: 'Sitemap',
    title: 'sitemap.xml и dist сходятся в обе стороны',
    level: 'error',
    run: () => {
      // ⚠ В ОБЕ стороны. Отсутствие страницы в sitemap — потерянный обход;
      // лишний URL в sitemap — обещание страницы, которой нет (session 29:
      // sitemap объявлял пути, которых маршрут не порождал).
      const xmlPath = join(DIST, 'sitemap.xml')
      if (!existsSync(xmlPath)) {
        return {
          id: 'sitemap-both-ways',
          group: 'Sitemap',
          ok: false,
          level: 'error',
          headline: 'нет dist/sitemap.xml',
          detail: [],
        }
      }
      const xml = readFileSync(xmlPath, 'utf8')
      const inMap = new Set(
        rx(xml, /<loc>([^<]+)<\/loc>/g)
          .map((u) => unesc(u).trim())
          .filter((u) => u.startsWith(SITE))
          .map((u) => u.slice(SITE.length) || '/'),
      )
      const indexable = PAGES.filter((p) => !isNoindex(p.html)).map((p) => p.url)
      const missing = indexable.filter((u) => !inMap.has(u)).sort()
      const extra = [...inMap].filter((u) => !BY_URL.has(u)).sort()
      const detail: string[] = []
      if (missing.length) detail.push(`есть в dist, нет в sitemap (${missing.length}): ${preview(missing, 12).join(', ')}`)
      if (extra.length) detail.push(`есть в sitemap, нет в dist (${extra.length}): ${preview(extra, 12).join(', ')}`)
      return {
        id: 'sitemap-both-ways',
        group: 'Sitemap',
        ok: missing.length === 0 && extra.length === 0,
        level: 'error',
        headline: `${inMap.size} URL в sitemap, ${indexable.length} индексируемых страниц в dist`,
        detail: detail.length ? detail : ['сошлось в обе стороны'],
      }
    },
  },
  {
    id: 'orphans',
    group: 'Обход',
    title: 'На каждую страницу ведёт хотя бы одна внутренняя ссылка',
    level: 'error',
    run: () => {
      const linked = new Set<string>(['/'])
      for (const p of PAGES) for (const href of internalLinks(p.html)) linked.add(href.endsWith('/') ? href : `${href}/`)
      const orphans = PAGES.filter((p) => !isNoindex(p.html) && !linked.has(p.url)).map((p) => p.url).sort()
      return {
        id: 'orphans',
        group: 'Обход',
        ok: orphans.length === 0,
        level: 'error',
        headline: orphans.length === 0 ? 'страниц-сирот нет' : `сирот: ${orphans.length}`,
        detail: orphans.length ? preview(orphans, 20) : [`проверено страниц: ${PAGES.length}`],
      }
    },
  },
  {
    id: 'click-depth',
    group: 'Обход',
    title: 'Глубина клика от главной не больше 4',
    level: 'warn',
    run: () => {
      // Обход в ширину от «/». Глубина 5+ — не ошибка, но такие страницы
      // обходятся реже: если их много, значит хабу не хватает ссылок.
      const depth = new Map<string, number>([['/', 0]])
      let frontier = ['/']
      while (frontier.length) {
        const next: string[] = []
        for (const url of frontier) {
          const page = BY_URL.get(url)
          if (!page) continue
          for (const raw of internalLinks(page.html)) {
            const href = raw.endsWith('/') ? raw : `${raw}/`
            if (!BY_URL.has(href) || depth.has(href)) continue
            depth.set(href, depth.get(url)! + 1)
            next.push(href)
          }
        }
        frontier = next
      }
      const deep = PAGES.filter((p) => !isNoindex(p.html) && (depth.get(p.url) ?? 99) > 4)
        .map((p) => `${p.url} (${depth.get(p.url) ?? 'не достижима'})`)
        .sort()
      const unreachable = PAGES.filter((p) => !isNoindex(p.html) && !depth.has(p.url)).map((p) => p.url)
      const hist = new Map<number, number>()
      for (const [, d] of depth) hist.set(d, (hist.get(d) ?? 0) + 1)
      const detail = [
        `по уровням: ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}:${n}`).join('  ')}`,
      ]
      if (unreachable.length) detail.push(`недостижимы от главной (${unreachable.length}): ${preview(unreachable, 10).join(', ')}`)
      if (deep.length) detail.push(`глубже 4 (${deep.length}): ${preview(deep, 10).join(', ')}`)
      return {
        id: 'click-depth',
        group: 'Обход',
        ok: deep.length === 0 && unreachable.length === 0,
        level: 'warn',
        headline: `максимум ${Math.max(...[...depth.values()])} кликов от главной`,
        detail,
      }
    },
  },
  {
    id: 'robots-txt',
    group: 'Обход',
    title: 'robots.txt на месте и указывает на sitemap',
    level: 'error',
    run: () => {
      const p = join(DIST, 'robots.txt')
      if (!existsSync(p)) {
        return { id: 'robots-txt', group: 'Обход', ok: false, level: 'error', headline: 'нет dist/robots.txt', detail: [] }
      }
      const txt = readFileSync(p, 'utf8')
      const hasSitemap = /sitemap:\s*https?:\/\/\S+sitemap\.xml/i.test(txt)
      const blanketDisallow = /^\s*disallow:\s*\/\s*$/im.test(txt)
      const detail: string[] = []
      if (!hasSitemap) detail.push('нет строки Sitemap: …/sitemap.xml')
      if (blanketDisallow) detail.push('⚠ "Disallow: /" — сайт закрыт от обхода целиком')
      return {
        id: 'robots-txt',
        group: 'Обход',
        ok: detail.length === 0,
        level: 'error',
        headline: detail.length === 0 ? 'robots.txt в порядке' : `проблем: ${detail.length}`,
        detail: detail.length ? detail : [`${txt.split('\n').length} строк`],
      }
    },
  },
  {
    id: 'noindex-inventory',
    group: 'Обход',
    title: 'Список noindex-страниц — чтобы закрытое было закрыто осознанно',
    level: 'warn',
    run: () => {
      // Не ошибка сама по себе: noindex — законный инструмент. Но список должен
      // быть коротким и знакомым, иначе однажды под него уедет что-то нужное.
      const list = PAGES.filter((p) => isNoindex(p.html)).map((p) => p.url).sort()
      return {
        id: 'noindex-inventory',
        group: 'Обход',
        ok: true,
        level: 'warn',
        headline: list.length === 0 ? 'noindex-страниц нет' : `noindex: ${list.length}`,
        detail: list.length ? preview(list, 20) : [],
      }
    },
  },
]

// ─────────────────────────── прогон ───────────────────────────

function main(): void {
  const selected = ONLY
    ? CHECKS.filter((c) => c.group.toLowerCase() === ONLY.toLowerCase() || c.id.includes(ONLY))
    : CHECKS

  if (!selected.length) {
    console.error(`Под --only ${ONLY} ничего не подошло. Группы: ${[...new Set(CHECKS.map((c) => c.group))].join(', ')}`)
    process.exit(1)
  }

  console.log('')
  console.log('GHS SEO check (по dist, без сети)')
  console.log(`  dist:   ${DIST}`)
  console.log(`  страниц: ${PAGES.length}`)
  console.log('')

  const results: Result[] = []
  let group = ''
  for (const check of selected) {
    if (check.group !== group) {
      group = check.group
      console.log(group)
    }
    let r: Result
    try {
      r = check.run()
    } catch (e) {
      r = { id: check.id, group: check.group, ok: false, level: 'error', headline: `проверка упала: ${String(e)}`, detail: [] }
    }
    results.push(r)
    const mark = r.ok ? ' OK ' : r.level === 'error' ? 'FAIL' : 'ВНИМ'
    console.log(`  [${mark}] ${check.title}`)
    console.log(`         ${r.headline}`)
    for (const line of r.detail) console.log(`         ${line}`)
  }

  const errors = results.filter((r) => !r.ok && r.level === 'error')
  const warns = results.filter((r) => !r.ok && r.level === 'warn')
  console.log('')
  if (errors.length === 0) {
    console.log(`Итог: ${results.length} проверок, ошибок нет${warns.length ? `, предупреждений ${warns.length}` : ''}.`)
    process.exit(0)
  }
  console.log(`Итог: ошибок ${errors.length}, предупреждений ${warns.length}:`)
  for (const f of errors) console.log(`  - ${f.id}: ${f.headline}`)
  process.exit(1)
}

main()
