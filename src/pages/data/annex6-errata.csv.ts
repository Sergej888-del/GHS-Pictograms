/**
 * `/data/annex6-errata.csv` — то же досье, что в `annex6-errata.json`, для
 * Excel и таблиц редакций. Строки берутся из того же модуля — второго списка нет.
 */
import type { APIRoute } from 'astro'
import { errataRows } from '../../lib/annex6ErrataExport'

export const prerender = true

const COLS = [
  'index_number', 'language', 'kind', 'published_name', 'english_name', 'ec', 'cas',
  'belongs_to_entry', 'note', 'act', 'oj_page', 'citation', 'eur_lex_url', 'status', 'status_date',
] as const

/** RFC 4180: кавычки удваиваются, поле с запятой/кавычкой/переводом строки берётся в кавычки. */
function cell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const GET: APIRoute = () => {
  const lines = [COLS.join(',')]
  for (const r of errataRows()) lines.push(COLS.map((c) => cell((r as Record<string, unknown>)[c])).join(','))
  // ⚠ BOM — чтобы Excel на Windows открыл латышские и греческие имена, а не «кракозябры».
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8' },
  })
}
