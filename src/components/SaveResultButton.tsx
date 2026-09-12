// SaveResultButton — №142 (session 88): замер спроса на сохранение результатов.
//
// Кнопка стоит ТОЛЬКО там, где у человека уже есть результат — в ряду действий
// рядом с Download / Share. По клику: спокойная строка «пока нет, этот клик —
// голос», необязательное поле email «Tell me when it's ready».
//
// ⚠ Счётчик — НЕ GA4. GA4 слеп на consent/блокировщики/боты (s86: 2 клика
// против ~110 в FirstPromoter). Источник правды — таблица feature_interest,
// закрытая для anon; вход только через RPC record_feature_interest
// (SECURITY DEFINER, ≤ 5 кликов и ≤ 2 email на visitor_id в сутки).
// GA4-событие `save_result_click` шлётся параллельно как вторая линейка.
//
// visitor_id — случайный UUID в localStorage: по нему считаем УНИКАЛЬНЫХ
// нажавших, а не клики. Без localStorage (приватное окно) — UUID на сессию.
//
// Порог решения назван заранее (12.09): за 30 дней ≥ 15 уникальных на
// конструкторе ИЛИ ≥ 30 уникальных по всем инструментам → строим кабинет.
// Отчёт — SELECT в шапке scripts/sql/88-feature-interest.sql.

import { useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  /** Короткий ключ инструмента — колонка feature_interest.tool (≤ 40 символов). */
  tool: string
  /** Класс для кнопки, чтобы встать в ряд соседей (напр. `mx-btn` в классификаторе). Без него — свой стиль в духе ShareResult. */
  buttonClassName?: string
  /** Класс/стиль обёртки — если ряд кнопок у родителя flex, обёртку можно сделать `contents`. */
  className?: string
  style?: CSSProperties
}

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

function visitorId(): string {
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

function track(event: string, params: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  const g = (window as any).gtag
  if (typeof g === 'function') g('event', event, params)
}

async function record(tool: string, email?: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('record_feature_interest', {
      p_feature: 'save_result',
      p_tool: tool,
      p_page: typeof window !== 'undefined' ? window.location.pathname : null,
      p_visitor: visitorId(),
      p_email: email ?? null,
    })
    if (error) return false
    return !!(data && (data as { ok?: boolean }).ok)
  } catch {
    return false
  }
}

const EMAIL_RE = /^\S+@\S+\.\S+$/

const btnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  lineHeight: 1.2,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#334155',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
}

const noteStyle: CSSProperties = {
  marginTop: 8,
  flexBasis: '100%', // в flex-ряду кнопок (mx-out) записка занимает всю строку под ними
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  background: '#f8fafc',
  color: '#334155',
  fontSize: 13,
  lineHeight: 1.5,
}

const inputStyle: CSSProperties = {
  flex: '1 1 180px',
  minWidth: 0,
  fontSize: 13,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#0f172a',
  fontFamily: 'inherit',
}

type EmailState = 'idle' | 'sending' | 'done' | 'error'

export default function SaveResultButton({ tool, buttonClassName, className, style }: Props) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [emailState, setEmailState] = useState<EmailState>('idle')

  const onClick = () => {
    if (!open) {
      setOpen(true)
      // не ждём ответа: строка показывается сразу, счётчик — фоном
      void record(tool)
      track('save_result_click', { tool, page: typeof window !== 'undefined' ? window.location.pathname : '' })
    } else {
      setOpen(false)
    }
  }

  const onNotify = async (e: FormEvent) => {
    e.preventDefault()
    const v = email.trim()
    if (!EMAIL_RE.test(v) || emailState === 'sending') return
    setEmailState('sending')
    const ok = await record(tool, v)
    setEmailState(ok ? 'done' : 'error')
    if (ok) track('save_result_notify', { tool })
  }

  return (
    <div className={className} style={style} data-save-result={tool}>
      <button
        type="button"
        onClick={onClick}
        aria-expanded={open}
        className={buttonClassName}
        style={buttonClassName ? undefined : btnStyle}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <path d="M17 21v-8H7v8M7 3v5h8" />
        </svg>
        Save this result
      </button>
      {open && (
        <div role="status" style={noteStyle} data-save-result-note="">
          <p style={{ margin: 0 }}>
            <b>Saved results and history are not available yet.</b> We are deciding whether to build them, and this click counts as a vote.
            For now, <b>Download</b> or <b>Share link</b> keeps this result.
          </p>
          {emailState === 'done' ? (
            <p style={{ margin: '8px 0 0', color: '#047857' }}>Thanks — we will write once, when it is ready.</p>
          ) : (
            <form onSubmit={onNotify} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                aria-label="Email — tell me when saving results is available"
                autoComplete="email"
                style={inputStyle}
              />
              <button
                type="submit"
                disabled={!EMAIL_RE.test(email.trim()) || emailState === 'sending'}
                style={{ ...btnStyle, background: '#062A78', color: '#fff', border: '1px solid #062A78', opacity: EMAIL_RE.test(email.trim()) ? 1 : 0.6 }}
              >
                {emailState === 'sending' ? 'Sending…' : 'Tell me when it’s ready'}
              </button>
              <span style={{ flexBasis: '100%', fontSize: 11.5, color: '#64748b' }}>
                One email when it launches — no newsletter, no sharing. <a href="/privacy/" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy</a>.
                {emailState === 'error' && <span style={{ color: '#b91c1c' }}> Could not send — please try again.</span>}
              </span>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
