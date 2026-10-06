/**
 * scripts/import-directory.ts — заливка каталога /directory/ (№148, s92) из scripts/data/directory-v3.json.
 *
 * Запуск из корня ghspictograms (PowerShell, по одной команде):
 *   npm run import:directory -- --dry      ← ничего не пишет, печатает, что будет
 *   npm run import:directory               ← пишет
 *
 * Требуется .env.local: PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (таблицы закрыты на запись
 * для anon — 92-directory.sql; anon их только читает при сборке).
 *
 * ОТКУДА ДАННЫЕ. Три прохода проверки 05.10.2026 по 152 строкам посевного списка: (1) живость,
 * вендор, страна, факты; (2) тарифы, возможности, сертификаты, интеграции; (3) что вендор сам
 * пишет о своей ответственности (Terms / AGB / disclaimer). Каждый факт несёт source_url.
 * Сводка решений по каждой строке — claude/session-92-directory.md.
 *
 * ⚠⚠ confirmed НЕ приходит из файла. Его ставит только отчёт scripts/check-directory.ts
 * (страница-источник прочитана заново, evidence найден). При повторной заливке подтверждение
 * ПЕРЕНОСИТСЯ на строку с тем же id, если не изменились value, quote, evidence и source_url, —
 * иначе сбрасывается: изменённый факт обязан пройти проверку снова.
 *
 * ⚠ Записи, которых нет в файле, НЕ удаляются (правило 5: ничего не удаляется). Факты записей из
 * файла заменяются целиком.
 *
 * ⚠ s93: у каждой цитаты об ответственности обязателен `source_kind` (тип документа-источника —
 * directoryModel.SourceKind); печатаются только terms / legal_notice / policy. И цитата, начатая
 * со строчной буквы, — обрывок фразы: ей положено ведущее «…» (урок Avery #621), иначе файл не
 * принимается.
 *
 * ⚠⚠ s96: ПОСЕВ — ИСТОЧНИК ПРАВДЫ И ДЛЯ ПРОФИЛЯ ВЛАДЕЛЬЦА (tier, claimed_on, owner_confirmed_on, logo_path,
 * owner_description, pricing_url, terms_url, also_in, subcategory, featured_*). Заявка (tiers-doc §4) вносится
 * СНАЧАЛА в посев, потом в базу — иначе следующая заливка молча вернёт запись в `listed`. Чего в посеве НЕТ
 * и быть не должно: адрес, имя и роль заявителя — они в закрытой directory_claims (96-directory-claim.sql);
 * репозиторий публичный. Проверки файла: описание владельца ≤ 60 слов и без превосходных степеней
 * (SUPERLATIVE_RE из directoryModel), у каждой дополнительной категории (`also_in`) — факт-основание
 * (`basis_for`) у той же записи, подраздел только у услуг и у всех услуг, claimed без даты не принимается.
 */
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  ALSO_IN_CATEGORIES, SUBCATEGORIES, SUBCATEGORY_PARENT, ownerDescriptionProblems,
} from '../src/lib/directoryModel'

config({ path: resolve(process.cwd(), '.env.local') })
config()

const FILE = resolve(process.cwd(), 'scripts/data/directory-v3.json')
const DRY = process.argv.includes('--dry')
const BATCH = 300

type Row = Record<string, unknown>

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

const url = process.env.PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) die('нужны PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local')

const data = JSON.parse(readFileSync(FILE, 'utf8')) as { entries: Row[]; facts: Row[] }
const entries = data.entries
const facts = data.facts

// ── проверки файла до любой записи ──
const ids = new Set(entries.map((e) => e.id as number))
if (ids.size !== entries.length) die('в файле повторяются id записей')
const fids = new Set(facts.map((f) => f.id as number))
if (fids.size !== facts.length) die('в файле повторяются id фактов')
const orphan = facts.filter((f) => !ids.has(f.entry_id as number))
if (orphan.length) die(`факты без записи: ${orphan.slice(0, 5).map((f) => f.id).join(', ')}`)
const noSource = facts.filter((f) => !/^https?:\/\//.test(String(f.source_url ?? '')))
if (noSource.length) die(`факты без source_url: ${noSource.slice(0, 5).map((f) => f.id).join(', ')}`)
const SOURCE_KINDS = new Set(['terms', 'legal_notice', 'policy', 'inline_disclaimer', 'other'])
const resp = facts.filter((f) => f.kind === 'responsibility')
const noKind = resp.filter((f) => !SOURCE_KINDS.has(String(f.source_kind ?? '')))
if (noKind.length) die(`цитаты без source_kind (terms/legal_notice/policy/inline_disclaimer/other): ${noKind.slice(0, 8).map((f) => f.id).join(', ')}`)
const strayKind = facts.filter((f) => f.kind !== 'responsibility' && f.source_kind != null)
if (strayKind.length) die(`source_kind положен только цитатам об ответственности: ${strayKind.slice(0, 5).map((f) => f.id).join(', ')}`)
// Обрывок фразы, напечатанный как целая («You are responsible for…» у Avery был хвостом инструкции), —
// в кавычках так нельзя: строчная буква в начале без «…» = ошибка посева.
const fragment = resp.filter((f) => /^[a-z]/.test(String(f.quote ?? '')))
if (fragment.length) die(`цитата начинается со строчной буквы без «…» (обрывок фразы?): ${fragment.slice(0, 8).map((f) => f.id).join(', ')}`)
const legalKinds = resp.filter((f) => ['terms', 'legal_notice', 'policy'].includes(String(f.source_kind))).length
console.log(`  цитат об ответственности ${resp.length}: из юридических документов ${legalKinds}, не печатаются ${resp.length - legalKinds}`)

// ── s96: профиль владельца, несколько категорий, подразделы ──
const PII_KEYS = ['owner_email', 'owner_name', 'owner_role', 'owner_domains', 'claim_requested_at', 'claim_verified_at']
const pii = entries.filter((e) => PII_KEYS.some((k) => k in e))
if (pii.length) die(`в посеве поля заявителя (${PII_KEYS.join(', ')}) — им место в directory_claims, не в публичном файле: записи ${pii.slice(0, 5).map((e) => e.id).join(', ')}`)
const badTier = entries.filter((e) => e.tier !== 'listed' && (!e.claimed_on || !e.owner_confirmed_on))
if (badTier.length) die(`claimed/featured без claimed_on или owner_confirmed_on: ${badTier.map((e) => e.id).join(', ')}`)
const badDesc = entries.flatMap((e) => ownerDescriptionProblems(e.owner_description as string | null).map((p) => `#${e.id}: ${p}`))
if (badDesc.length) die(`описание владельца не принимается:\n  ${badDesc.join('\n  ')}`)
const SUB_SLUGS = new Set<string>(SUBCATEGORIES.map((s) => s.slug))
const badSub = entries.filter((e) =>
  e.category === SUBCATEGORY_PARENT ? !SUB_SLUGS.has(String(e.subcategory)) : e.subcategory != null)
if (badSub.length) die(`подраздел: у услуг обязателен из {${[...SUB_SLUGS].join(', ')}}, у прочих — null: записи ${badSub.map((e) => e.id).join(', ')}`)
const subClash = entries.filter((e) => e.category === SUBCATEGORY_PARENT && SUB_SLUGS.has(String(e.slug)))
if (subClash.length) die(`слуг записи совпадает со слугом подраздела (один путь): ${subClash.map((e) => e.slug).join(', ')}`)
for (const e of entries) {
  const also = (e.also_in as string[] | undefined) ?? []
  for (const c of also) {
    if (!(ALSO_IN_CATEGORIES as readonly string[]).includes(c) || c === e.category) die(`#${e.id}: also_in «${c}» вне словаря или равна основной категории`)
    const basis = facts.find((f) => f.entry_id === e.id && f.kind === 'feature' && f.basis_for === c)
    if (!basis) die(`#${e.id}: дополнительная категория «${c}» без факта-основания (feature с basis_for = «${c}»)`)
  }
}
const strayBasis = facts.filter((f) => f.basis_for != null && (f.kind !== 'feature' ||
  !((entries.find((e) => e.id === f.entry_id)?.also_in as string[] | undefined) ?? []).includes(String(f.basis_for))))
if (strayBasis.length) die(`basis_for у факта, которого нет в also_in записи (или не feature): ${strayBasis.slice(0, 5).map((f) => f.id).join(', ')}`)
const badProvided = facts.filter((f) => f.provided_by != null && f.provided_by !== 'editor' && f.provided_by !== 'owner')
if (badProvided.length) die(`provided_by только editor/owner: ${badProvided.slice(0, 5).map((f) => f.id).join(', ')}`)
console.log(`  заявленных ${entries.filter((e) => e.tier !== 'listed').length} · с also_in ${entries.filter((e) => ((e.also_in as string[]) ?? []).length).length} · подразделов услуг ${new Set(entries.filter((e) => e.subcategory).map((e) => e.subcategory)).size}`)

const byState = new Map<string, number>()
for (const e of entries) byState.set(String(e.state), (byState.get(String(e.state)) ?? 0) + 1)
const byKind = new Map<string, number>()
for (const f of facts) byKind.set(String(f.kind), (byKind.get(String(f.kind)) ?? 0) + 1)
console.log(`Файл: ${entries.length} записей (${[...byState].map(([k, v]) => `${k} ${v}`).join(', ')}), ${facts.length} фактов`)
console.log(`  по видам: ${[...byKind].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`)

const ENTRY_COLS = [
  'id', 'slug', 'category', 'state', 'tier', 'title', 'vendor', 'url', 'description', 'description_source',
  'hq_country', 'hq_country_source', 'reason', 'reason_source', 'closed_on', 'closed_source', 'successor',
  'affiliate', 'affiliate_url', 'tags', 'last_verified',
  // s96 — профиль владельца и устройство каталога (без полей заявителя, см. шапку)
  'claimed_on', 'owner_confirmed_on', 'logo_path', 'owner_description', 'pricing_url', 'terms_url',
  'screenshot_path', 'contact_url', 'rfq_opt_in', 'featured_from', 'featured_until', 'featured_slots', 'also_in', 'subcategory',
]
const FACT_COLS = ['id', 'entry_id', 'kind', 'label', 'value', 'detail', 'quote', 'source_url', 'evidence', 'sort', 'checked_on', 'source_kind', 'provided_by', 'basis_for']
// ⚠ NOT NULL-колонки с умолчанием: пустой массив / false, а не null (иначе 23502 на первой же строке).
const DEFAULTS: Record<string, unknown> = { tags: [], featured_slots: [], also_in: [], rfq_opt_in: false, provided_by: 'editor' }
const pick = (r: Row, cols: string[]) => Object.fromEntries(cols.map((c) => [c, r[c] ?? DEFAULTS[c] ?? null]))

async function main() {
  const db = createClient(url!, key!, { auth: { persistSession: false } })

  // Подтверждения, которые уже стоят в базе, — чтобы не потерять их при повторной заливке.
  const prev = new Map<number, Row>()
  for (let from = 0; ; from += 1000) {
    const { data: chunk, error } = await db
      .from('directory_facts')
      .select('id, value, quote, evidence, source_url, confirmed, confirmed_on')
      .order('id')
      .range(from, from + 999)
    if (error) die(`чтение directory_facts: ${error.message}`)
    for (const r of chunk ?? []) prev.set(r.id as number, r)
    if (!chunk || chunk.length < 1000) break
  }
  let kept = 0
  let reset = 0
  const factRows = facts.map((f) => {
    const row: Row = pick(f, FACT_COLS)
    const p = prev.get(f.id as number)
    const same =
      p && p.confirmed !== null && p.value === f.value && (p.quote ?? null) === (f.quote ?? null) &&
      (p.evidence ?? null) === (f.evidence ?? null) && p.source_url === f.source_url
    if (same) {
      row.confirmed = p!.confirmed
      row.confirmed_on = p!.confirmed_on
      kept++
    } else {
      row.confirmed = null
      row.confirmed_on = null
      if (p && p.confirmed !== null) reset++
    }
    return row
  })
  console.log(`Подтверждения из базы: перенесено ${kept}, сброшено (факт изменился) ${reset}`)

  if (DRY) {
    console.log('\n--dry: ничего не записано.')
    return
  }

  for (let i = 0; i < entries.length; i += BATCH) {
    const { error } = await db.from('directory_entries').upsert(entries.slice(i, i + BATCH).map((e) => pick(e, ENTRY_COLS)), { onConflict: 'id' })
    if (error) die(`запись directory_entries: ${error.message}`)
  }
  const entryIds = [...ids]
  const { error: delErr } = await db.from('directory_facts').delete().in('entry_id', entryIds)
  if (delErr) die(`очистка фактов: ${delErr.message}`)
  for (let i = 0; i < factRows.length; i += BATCH) {
    const { error } = await db.from('directory_facts').insert(factRows.slice(i, i + BATCH))
    if (error) die(`запись directory_facts (с ${i}): ${error.message}`)
  }

  // ── сверка после записи ──
  const { count: nE, error: e1 } = await db.from('directory_entries').select('id', { count: 'exact', head: true }).in('id', entryIds)
  const { count: nF, error: e2 } = await db.from('directory_facts').select('id', { count: 'exact', head: true }).in('entry_id', entryIds)
  if (e1 || e2) die(`сверка: ${(e1 ?? e2)!.message}`)
  if (nE !== entries.length || nF !== facts.length) die(`сверка не сошлась: записей ${nE}/${entries.length}, фактов ${nF}/${facts.length}`)
  console.log(`\n✓ Записано: ${nE} записей, ${nF} фактов. Дальше: npm run check:directory`)
}

main().catch((e) => die(String(e)))
