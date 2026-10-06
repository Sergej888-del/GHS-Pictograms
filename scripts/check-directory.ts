/**
 * scripts/check-directory.ts — живость и перепроверка фактов каталога /directory/ (№148, s92, §18.3).
 *
 * Запуск из корня ghspictograms, на машине Сергея (нужна сеть к сайтам вендоров; из облака Claude и
 * из VM моста эти адреса закрыты):
 *   npm run check:directory
 *   npm run check:directory -- --only 24,1        (только эти записи)
 *
 * Что делает:
 *   1. Читает directory_entries и directory_facts на anon-ключе (только чтение, как check:dist).
 *   2. Скачивает каждый адрес, который каталог печатает (сайт записи и все source_url), по 8 сразу.
 *   3. Для каждого факта с `evidence` ищет его на странице-источнике:
 *        price          — число тарифа (разделители тысяч игнорируются: 1,499 = 1499 = 1 499);
 *        responsibility — начало дословной цитаты (регистр, кавычки и пунктуация игнорируются);
 *        прочие         — слово-маркер (CLP, OSHA, WHMIS, 17100, UFI…).
 *   4. Пишет отчёт `directory-check-<дата>.json` в корень репозитория и печатает сводку.
 *   5. s93: предупреждает о цитатах об ответственности, у которых источник — не юридический документ
 *      (`source_kind` не terms/legal_notice/policy: такие в базе остаются, но не печатаются), и о цитатах,
 *      начатых со строчной буквы без «…» (обрывок фразы, напечатанный как целая, — урок Avery #621).
 *      ⚠ «Найдено на странице» подтверждает ДОСЛОВНОСТЬ, не то, что документ — об этом продукте: тип
 *      документа и его предмет проверяет человек, глазами, и записывает в source_kind.
 *
 * ⚠⚠ СКРИПТ НИЧЕГО НЕ ПИШЕТ В БАЗУ. Подтверждения (`confirmed = true`) по отчёту ставит Claude
 * MCP-запросом — check-скрипты в этом репозитории только читают (как check:dist). Пока факт не
 * подтверждён, цены и цитаты на страницах НЕ печатаются (directoryModel.printable).
 *
 * ⚠ Как читать «мёртвый». DNS-ошибка, отказ соединения, 404 и 410 — мёртвый адрес. 401/403/429 и
 * страница-заглушка Cloudflare — «закрыт от скриптов»: сайт жив, проверить его можно только глазами
 * в браузере. Мёртвый адрес записи → кандидат в `closed` (правило 5), решает человек, не скрипт.
 * ⚠ Страница, которая рисует текст скриптом (меньше 600 знаков текста), тоже не мёртвая —
 * evidence на ней искать бесполезно; такие факты остаются неподтверждёнными до ручной проверки.
 *
 * Код возврата: 1, если у живой записи мёртв её собственный адрес; иначе 0.
 */
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

config({ path: resolve(process.cwd(), '.env.local') })
config()

type Entry = { id: number; title: string; state: string; url: string | null; description_source: string | null; hq_country_source: string | null; closed_source: string | null; reason_source: string | null }
type Fact = { id: number; entry_id: number; kind: string; value: string; quote: string | null; evidence: string | null; source_url: string; confirmed: boolean | null; source_kind: string | null }
type Page = { url: string; status: number | null; finalUrl: string | null; error: string | null; text: string; textLength: number; verdict: 'ok' | 'dead' | 'blocked' | 'script-only' | 'error' }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const TIMEOUT = 25_000
const CONCURRENCY = 8
const onlyArg = process.argv.indexOf('--only')
const ONLY = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(',').map((s) => Number(s.trim()))) : null

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

/** Текст страницы: без скриптов, стилей и тегов, с раскрытыми сущностями. */
function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Та же нормализация, что у evidence цитат в seed: нижний регистр, только буквы и цифры. */
function normWords(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Числа без разделителей тысяч: «1,499» / «1 499» / «1.499,00» → «1499». */
function normNumbers(s: string): string {
  return s.replace(/(\d)[,\u00a0\u202f '](?=\d{3}(?!\d))/g, '$1')
}

function priceFound(evidence: string, text: string): boolean {
  const m = evidence.match(/\d[\d,.\u00a0 ']*/)
  if (!m) return new RegExp(`\\b${evidence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)
  let n = normNumbers(m[0].trim().replace(/[.,]$/, ''))
  n = n.replace(/[.,]00$/, '')
  const esc = n.replace(/[.]/g, '[.,]')
  return new RegExp(`(?<![\\d.,])${esc}(?:[.,]0{1,2})?(?![\\d])`).test(normNumbers(text))
}

function evidenceFound(f: Fact, text: string): boolean {
  if (!f.evidence) return false
  if (f.kind === 'price') return priceFound(f.evidence, text)
  // Цитата с пропусками хранит куски через « ||| » — на странице обязан найтись КАЖДЫЙ.
  if (f.kind === 'responsibility') {
    const page = normWords(text)
    return f.evidence.split(' ||| ').every((part) => page.includes(normWords(part)))
  }
  return new RegExp(`\\b${f.evidence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)
}

async function fetchPage(url: string): Promise<Page> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en' },
    })
    const ctype = res.headers.get('content-type') ?? ''
    const body = /text|html|xml|json/i.test(ctype) || !ctype ? await res.text() : ''
    const text = pageText(body)
    const cfChallenge = /cf-chl|challenge-platform|Just a moment\.\.\./i.test(body)
    let verdict: Page['verdict'] = 'ok'
    if (res.status === 404 || res.status === 410) verdict = 'dead'
    else if ([401, 403, 429].includes(res.status) || cfChallenge) verdict = 'blocked'
    else if (res.status >= 500) verdict = 'error'
    else if (text.length < 600 && !/pdf/i.test(ctype)) verdict = 'script-only'
    return { url, status: res.status, finalUrl: res.url, error: null, text, textLength: text.length, verdict }
  } catch (e) {
    const msg = String((e as any)?.cause?.code ?? (e as Error)?.message ?? e)
    const dead = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|CERT_HAS_EXPIRED/i.test(msg)
    return { url, status: null, finalUrl: null, error: msg, text: '', textLength: 0, verdict: dead ? 'dead' : 'error' }
  } finally {
    clearTimeout(t)
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  let done = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++
        if (i >= items.length) return
        out[i] = await fn(items[i], i)
        done++
        if (done % 25 === 0 || done === items.length) process.stdout.write(`\r  страниц: ${done}/${items.length}`)
      }
    }),
  )
  process.stdout.write('\n')
  return out
}

async function main() {
  const url = process.env.PUBLIC_SUPABASE_URL
  const key = process.env.PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) die('нужны PUBLIC_SUPABASE_URL и PUBLIC_SUPABASE_ANON_KEY в .env.local')
  const db = createClient(url, key, { auth: { persistSession: false } })

  const { data: entriesRaw, error: e1 } = await db
    .from('directory_entries')
    .select('id, title, state, url, description_source, hq_country_source, closed_source, reason_source')
    .order('id')
  if (e1) die(`directory_entries: ${e1.message}`)
  const facts: Fact[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('directory_facts')
      .select('id, entry_id, kind, value, quote, evidence, source_url, confirmed, source_kind')
      .order('id')
      .range(from, from + 999)
    if (error) die(`directory_facts: ${error.message}`)
    facts.push(...((data ?? []) as Fact[]))
    if (!data || data.length < 1000) break
  }
  const entries = ((entriesRaw ?? []) as Entry[]).filter((e) => !ONLY || ONLY.has(e.id))
  const scopedFacts = facts.filter((f) => !ONLY || ONLY.has(f.entry_id))
  if (entries.length === 0) die('каталог пуст — сначала npm run import:directory')

  const urls = new Set<string>()
  for (const e of entries) {
    for (const u of [e.url, e.description_source, e.hq_country_source, e.closed_source, e.reason_source]) if (u) urls.add(u)
  }
  for (const f of scopedFacts) urls.add(f.source_url)
  const list = [...urls].sort()
  console.log(`Каталог: ${entries.length} записей, ${scopedFacts.length} фактов, ${list.length} адресов`)
  const pages = await pool(list, CONCURRENCY, (u) => fetchPage(u))
  const byUrl = new Map(pages.map((p) => [p.url, p]))

  const factResults = scopedFacts
    .filter((f) => f.evidence)
    .map((f) => {
      const p = byUrl.get(f.source_url)!
      const usable = p.verdict === 'ok'
      const found = usable && evidenceFound(f, p.text)
      return {
        id: f.id,
        entry_id: f.entry_id,
        kind: f.kind,
        evidence: f.evidence,
        source_url: f.source_url,
        page: p.verdict,
        found,
        was: f.confirmed,
      }
    })

  const deadOwn = entries
    .filter((e) => e.state === 'live' && e.url && byUrl.get(e.url)?.verdict === 'dead')
    .map((e) => ({ id: e.id, title: e.title, url: e.url, error: byUrl.get(e.url!)?.error ?? byUrl.get(e.url!)?.status }))

  const date = new Date().toISOString().slice(0, 10)
  const report = {
    date,
    pages: pages.map(({ text, ...p }) => p),
    facts: factResults,
    confirm: factResults.filter((r) => r.found).map((r) => r.id),
    unconfirm: factResults.filter((r) => !r.found && r.was === true && r.page === 'ok').map((r) => r.id),
    deadOwnUrl: deadOwn,
  }
  const out = resolve(process.cwd(), `directory-check-${date}.json`)
  writeFileSync(out, JSON.stringify(report, null, 1))

  // ── сводка ──
  const verdicts = new Map<string, number>()
  for (const p of pages) verdicts.set(p.verdict, (verdicts.get(p.verdict) ?? 0) + 1)
  console.log(`Страницы: ${[...verdicts].map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  const kinds = new Map<string, { found: number; total: number }>()
  for (const r of factResults) {
    const k = kinds.get(r.kind) ?? { found: 0, total: 0 }
    k.total++
    if (r.found) k.found++
    kinds.set(r.kind, k)
  }
  console.log('Факты с evidence (найдено / всего):')
  for (const [k, v] of [...kinds].sort()) console.log(`  ${k.padEnd(16)} ${v.found} / ${v.total}`)
  if (report.unconfirm.length) console.log(`⚠ Были подтверждены, а теперь не найдены: ${report.unconfirm.length} — цены/цитаты могли измениться`)
  if (deadOwn.length) {
    console.log(`\n✗ Мёртвый адрес у живой записи (${deadOwn.length}) — кандидаты в closed, решает человек:`)
    for (const d of deadOwn) console.log(`  #${d.id} ${d.title} — ${d.url} (${d.error})`)
  }
  // s93: цитаты, которые не печатаются по типу источника, и обрывки фраз без «…».
  const LEGAL = new Set(['terms', 'legal_notice', 'policy'])
  const resp = scopedFacts.filter((f) => f.kind === 'responsibility')
  const nonLegal = resp.filter((f) => !f.source_kind || !LEGAL.has(f.source_kind))
  const fragments = resp.filter((f) => /^[a-z]/.test(f.quote ?? ''))
  if (nonLegal.length) {
    console.log(`\nЦитат об ответственности не из юридических документов (не печатаются): ${nonLegal.length} из ${resp.length}`)
    const byKind = new Map<string, number>()
    for (const f of nonLegal) byKind.set(f.source_kind ?? 'null', (byKind.get(f.source_kind ?? 'null') ?? 0) + 1)
    console.log(`  ${[...byKind].map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  }
  if (fragments.length) console.log(`⚠ Цитата со строчной буквы без «…» (обрывок фразы?): ${fragments.map((f) => `#${f.id}`).join(', ')}`)
  const blocked = pages.filter((p) => p.verdict === 'blocked' || p.verdict === 'script-only').length
  if (blocked) console.log(`\n${blocked} страниц закрыты от скриптов или рисуются скриптом — их факты остаются неподтверждёнными.`)
  console.log(`\nОтчёт: ${out}`)
  process.exit(deadOwn.length ? 1 : 0)
}

main().catch((e) => die(String(e)))
