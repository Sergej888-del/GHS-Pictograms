// toolSignals — общий слой сигналов от инструментов (session 88).
//
// Три сигнала, одна таблица на каждый, один паттерн: закрытая таблица + RPC
// SECURITY DEFINER с лимитом на visitor_id в сутки (scripts/sql/88-*, 89-*):
//   • record_feature_interest — клик «Save this result» (№142, замер спроса);
//   • record_tool_feedback    — форма пожеланий (чекбоксы + текст + email);
//   • record_search_miss      — «искал вещество и не нашёл» (пассивный сигнал).
//
// ⚠ Источник правды — база, не GA4 (s86: GA4 показал 2 партнёрских клика
// против ~110 в FirstPromoter). GA4-события шлются параллельно как вторая линейка.
//
// visitor_id — случайный UUID в localStorage['ghsp_visitor']: по нему считаются
// УНИКАЛЬНЫЕ люди, а не клики. Без localStorage (приватное окно) — UUID на сессию.
// Ничего личного в нём нет, и ни с чем он не связан.

import { supabase } from './supabase'

const VISITOR_KEY = 'ghsp_visitor'
let sessionVisitor: string | null = null

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // запасной путь для старых WebView — RFC 4122 v4 из Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function visitorId(): string {
  if (sessionVisitor) return sessionVisitor
  try {
    const saved = localStorage.getItem(VISITOR_KEY)
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) { sessionVisitor = saved; return saved }
    const fresh = uuid()
    localStorage.setItem(VISITOR_KEY, fresh)
    sessionVisitor = fresh
    return fresh
  } catch {
    sessionVisitor = uuid()
    return sessionVisitor
  }
}

export function pagePath(): string | null {
  return typeof window !== 'undefined' ? window.location.pathname : null
}

export function track(event: string, params: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  const g = (window as any).gtag
  if (typeof g === 'function') g('event', event, params)
}

async function rpc(name: string, args: Record<string, unknown>): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc(name, args)
    if (error) return false
    return !!(data && (data as { ok?: boolean }).ok)
  } catch {
    return false
  }
}

/** Клик «Save this result» — одна строка на клик, ≤ 5 на посетителя в сутки (в RPC). */
export function recordSaveClick(tool: string): Promise<boolean> {
  return rpc('record_feature_interest', {
    p_feature: 'save_result',
    p_tool: tool,
    p_page: pagePath(),
    p_visitor: visitorId(),
    p_email: null,
  })
}

/** Форма пожеланий — ≤ 3 на посетителя в сутки; хотя бы одно из wants / comment / email. */
export function recordToolFeedback(tool: string, wants: string[], comment: string, email: string): Promise<boolean> {
  return rpc('record_tool_feedback', {
    p_tool: tool,
    p_page: pagePath(),
    p_visitor: visitorId(),
    p_wants: wants,
    p_comment: comment.trim() || null,
    p_email: email.trim() || null,
  })
}

/**
 * «Искал и не нашёл». Вызывается из островов на КАЖДОЕ состояние «запрос ≥ 2 знаков,
 * результатов 0», поэтому вся дисциплина здесь:
 *   • отправка через 900 мс тишины — пока человек печатает, ничего не уходит;
 *   • расширение уже отправленного промаха («acetonx» → «acetonxy») не отправляется:
 *     это тот же промах; новая строка — только когда запрос перестал быть его продолжением;
 *   • тот же запрос дважды за сессию не уходит (RPC ещё и сам гасит дубли за день).
 * Логировать можно смело: строка поиска — не персональные данные, а название вещества.
 */
const missTimers = new Map<string, number>()
const missSent = new Map<string, string>() // tool → последний отправленный запрос (в нижнем регистре)

export function logSearchMiss(tool: string, query: string): void {
  if (typeof window === 'undefined') return
  const q = query.replace(/\s+/g, ' ').trim()
  const prev = missTimers.get(tool)
  if (prev) window.clearTimeout(prev)
  if (q.length < 2 || q.length > 120) return
  const norm = q.toLowerCase()
  const last = missSent.get(tool)
  if (last && (norm === last || norm.startsWith(last))) return
  const t = window.setTimeout(() => {
    missTimers.delete(tool)
    missSent.set(tool, norm)
    void rpc('record_search_miss', { p_tool: tool, p_query: q, p_visitor: visitorId(), p_page: pagePath() })
    track('search_miss', { tool, query_length: q.length })
  }, 900)
  missTimers.set(tool, t)
}

/** Отмена отложенной отправки — когда результаты появились или поле очищено. */
export function cancelSearchMiss(tool: string): void {
  if (typeof window === 'undefined') return
  const prev = missTimers.get(tool)
  if (prev) { window.clearTimeout(prev); missTimers.delete(tool) }
}
