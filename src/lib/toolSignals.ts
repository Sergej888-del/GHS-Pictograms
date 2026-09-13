// toolSignals — общий слой сигналов от инструментов (session 88).
//
// Три сигнала, одна таблица на каждый, один паттерн: закрытая таблица + RPC
// SECURITY DEFINER с лимитом на visitor_id в сутки (scripts/sql/88-*, 89-*).
//   • save     — клик «Save this result» (№142, замер спроса);
//   • feedback — форма пожеланий (чекбоксы + текст + email);
//   • miss     — «искал вещество и не нашёл» (пассивный сигнал).
//
// ⚠ С №120 (s88) сигналы НЕ зовут RPC напрямую: браузер → POST /api/signal
// (functions/api/signal.ts) → Turnstile → лимит по IP → RPC service-ключом.
// У anon EXECUTE на трёх RPC отозван — прямой вызов из браузера вернёт 42501.
//
// ⚠ Источник правды — база, не GA4 (s86: GA4 показал 2 партнёрских клика
// против ~110 в FirstPromoter). GA4-события шлются параллельно как вторая линейка.
//
// visitor_id — случайный UUID в localStorage['ghsp_visitor']: по нему считаются
// УНИКАЛЬНЫЕ люди, а не клики. Без localStorage (приватное окно) — UUID на сессию.
// Ничего личного в нём нет, и ни с чем он не связан.

import { getTurnstileToken } from './turnstile'

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

type Kind = 'save' | 'feedback' | 'miss'

/**
 * Одна отправка = один свежий токен Turnstile (одноразовый) + один POST.
 * Ответ `ok` означает, что функция приняла и RPC отработал; `counted:false`
 * (лимит/дубль) — тоже ok: сигнал был, просто не учтён второй раз.
 */
async function signal(kind: Kind, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const turnstileToken = await getTurnstileToken()
    const res = await fetch('/api/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, turnstileToken, visitor: visitorId(), page: pagePath(), ...payload }),
    })
    if (!res.ok) return false
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: { ok?: boolean } } | null
    return !!(data && data.ok && data.result && data.result.ok)
  } catch {
    return false
  }
}

/** Клик «Save this result» — одна строка на клик, ≤ 5 на посетителя в сутки (в RPC). */
export function recordSaveClick(tool: string): Promise<boolean> {
  return signal('save', { tool })
}

/** Форма пожеланий — ≤ 3 на посетителя в сутки; хотя бы одно из wants / comment / email. */
export function recordToolFeedback(tool: string, wants: string[], comment: string, email: string): Promise<boolean> {
  return signal('feedback', { tool, wants, comment: comment.trim() || null, email: email.trim() || null })
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
    void signal('miss', { tool, query: q })
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
