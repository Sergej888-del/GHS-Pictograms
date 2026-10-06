// src/lib/directoryData.ts — чтение каталога при сборке (№148, s92).
//
// ⚠ Одна загрузка на сборку: обещание кэшируется на уровне модуля, и хаб, семь страниц
// категорий, ~140 страниц записей и sitemap читают ОДИН и тот же снимок. Два запроса на всю
// сборку вместо трёхсот — урок Disk IO s90 касается и сборки.
//
// ⚠ must(): отказ запроса роняет сборку. Пустой каталог при живых шапке и подвале — хуже, чем
// сборка, которая не состоялась (claude/silent-supabase-failures.md).
//
// ⚠ PostgREST отдаёт ≤ 1 000 строк на запрос при любом range — фактов ~1 900, поэтому
// постранично с фиксированным порядком (§15.3).

import { supabase } from './supabase'
import { must } from './mustQuery'
import type { DirectoryEntry, DirectoryFact } from './directoryModel'

const ENTRY_COLS =
  'id, slug, category, state, tier, title, vendor, url, description, description_source, hq_country, hq_country_source, reason, reason_source, closed_on, closed_source, successor, affiliate, affiliate_url, tags, claimed_on, last_verified'
const FACT_COLS =
  'id, entry_id, kind, label, value, detail, quote, source_url, evidence, sort, checked_on, confirmed, confirmed_on, source_kind'

export interface DirectorySnapshot {
  entries: DirectoryEntry[]
  facts: DirectoryFact[]
}

async function loadAll(): Promise<DirectorySnapshot> {
  const entries = must(
    'directory_entries for /directory/',
    await supabase.from('directory_entries').select(ENTRY_COLS).order('id').range(0, 999),
  ) as DirectoryEntry[]
  if (entries.length >= 1000) throw new Error('build: directory_entries reached 1000 rows — page through them')
  const facts: DirectoryFact[] = []
  for (let from = 0; ; from += 1000) {
    const chunk = must(
      `directory_facts ${from}-${from + 999}`,
      await supabase.from('directory_facts').select(FACT_COLS).order('id').range(from, from + 999),
    ) as DirectoryFact[]
    facts.push(...chunk)
    if (chunk.length < 1000) break
  }
  // ⚠ Пустой каталог — не «нечего показать», а сломанный доступ (грант, политика, ключ).
  if (entries.length === 0) throw new Error('build: directory_entries is empty — check the anon GRANT (92-directory.sql)')
  return { entries, facts }
}

let cache: Promise<DirectorySnapshot> | null = null

export function loadDirectory(): Promise<DirectorySnapshot> {
  return (cache ??= loadAll())
}
