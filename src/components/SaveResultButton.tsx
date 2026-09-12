// SaveResultButton — №142 замер спроса + форма пожеланий (session 88).
//
// Стоит ТОЛЬКО там, где у человека уже есть результат — в ряду действий рядом
// с Download / Share. Два входа, одна панель (решение Сергея 12.09):
//   • кнопка «Save this result» (teal) — клик считается голосом за сохранение
//     (таблица feature_interest, RPC record_feature_interest) и открывает панель;
//   • ссылка «Suggest a feature» — открывает ту же панель без «голоса за сохранение».
// Панель: чекбоксы пожеланий по инструменту + «Something else» + email →
// record_tool_feedback (таблица tool_feedback). В режиме «save» пункт
// «save_results» в форму не выводится, но в отправку добавляется сам — человек
// уже проголосовал кликом.
//
// ⚠ Счётчик — НЕ GA4 (см. src/lib/toolSignals.ts). Порог решения по №142 назван
// заранее (12.09): ≥ 15 уникальных на конструкторе или ≥ 30 по всем за 30 дней.
// Отчёты — SELECT в шапках scripts/sql/88-*.sql и 89-*.sql.

import { useState, type CSSProperties, type FormEvent } from 'react'
import { recordSaveClick, recordToolFeedback, track } from '../lib/toolSignals'

interface Props {
  /** Короткий ключ инструмента — колонка tool (≤ 40 символов, [a-z0-9-]). */
  tool: string
  /** Класс для кнопки, чтобы встать в ряд соседей (напр. `mx-btn`); цвет всё равно teal — инлайн поверх класса. */
  buttonClassName?: string
  /** Класс/стиль обёртки — если ряд у родителя flex, обёртку можно сделать `display: contents`. */
  className?: string
  style?: CSSProperties
}

/* ── пожелания: общие для всех + по инструменту ──────────────────────────── */

interface Want { key: string; label: string }

const COMMON: Want[] = [
  { key: 'save_results',  label: 'Save results and history — come back to them later' },
  { key: 'batch',         label: 'Several substances or mixtures at once' },
  { key: 'export',        label: 'Export to Excel / CSV' },
  { key: 'jurisdictions', label: 'More jurisdictions (WHMIS, GB CLP, Japan…)' },
  { key: 'api',           label: 'API access for our own systems' },
]

const EXTRA: Record<string, Want> = {
  'label-maker':          { key: 'multilang',     label: 'Multi-language labels' },
  'pictogram-selector':   { key: 'multilang',     label: 'Multi-language label elements' },
  'clp-classifier':       { key: 'skin_eye_aquatic', label: 'Skin / eye corrosion and aquatic toxicity classes' },
  'ate-calculator':       { key: 'from_classifier', label: 'Take the composition straight from the mixture classifier' },
  'storage-matrix':       { key: 'inventory',     label: 'A whole inventory at once — how many storage zones it needs' },
  'p-statement-selector': { key: 'print_sheet',   label: 'Print-ready P-statement sheet' },
}

function wantsFor(tool: string): Want[] {
  const extra = EXTRA[tool]
  return extra ? [...COMMON, extra] : COMMON
}

/* ── стили (инлайн — компонент стоит в островах с разными системами классов) ── */

const TEAL = '#0d9488'

const btn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  lineHeight: 1.2,
  fontWeight: 600,
  padding: '7px 12px',
  borderRadius: 8,
  border: `1px solid ${TEAL}`,
  background: TEAL,
  color: '#ffffff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
}

// поверх чужого класса (mx-btn) перекрашиваем только цвет — размеры остаются от класса
const tealOverride: CSSProperties = { background: TEAL, borderColor: TEAL, color: '#ffffff' }

const linkBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: '6px 4px',
  fontSize: 13,
  color: '#0f766e',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}

const panel: CSSProperties = {
  marginTop: 8,
  flexBasis: '100%', // в flex-ряду кнопок (mx-out) панель занимает всю строку под ними
  padding: '12px 14px',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  background: '#f8fafc',
  color: '#334155',
  fontSize: 13,
  lineHeight: 1.5,
}

const field: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontSize: 13,
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#0f172a',
  fontFamily: 'inherit',
}

const EMAIL_RE = /^\S+@\S+\.\S+$/

type Mode = 'save' | 'suggest'
type SendState = 'idle' | 'sending' | 'done' | 'error'

export default function SaveResultButton({ tool, buttonClassName, className, style }: Props) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [wants, setWants] = useState<Set<string>>(new Set())
  const [comment, setComment] = useState('')
  const [email, setEmail] = useState('')
  const [send, setSend] = useState<SendState>('idle')

  const open = mode !== null
  const emailOk = email.trim() === '' || EMAIL_RE.test(email.trim())
  const hasContent = wants.size > 0 || comment.trim().length > 0 || (mode === 'save' && email.trim().length > 0)
  const canSend = hasContent && emailOk && send !== 'sending'

  const onSave = () => {
    if (mode === 'save') { setMode(null); return }
    setMode('save')
    // не ждём ответа: панель открывается сразу, счётчик — фоном
    void recordSaveClick(tool)
    track('save_result_click', { tool, page: typeof window !== 'undefined' ? window.location.pathname : '' })
  }

  const onSuggest = () => {
    if (mode === 'suggest') { setMode(null); return }
    setMode('suggest')
    track('suggest_feature_open', { tool })
  }

  const toggle = (key: string) =>
    setWants((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSend) return
    setSend('sending')
    const list = Array.from(wants)
    if (mode === 'save' && !list.includes('save_results')) list.unshift('save_results')
    const ok = await recordToolFeedback(tool, list, comment, email)
    setSend(ok ? 'done' : 'error')
    if (ok) track('tool_feedback_sent', { tool, wants: list.join(','), has_email: email.trim() !== '' })
  }

  const list = wantsFor(tool).filter((w) => !(mode === 'save' && w.key === 'save_results'))

  return (
    <div className={className} style={style} data-save-result={tool}>
      <button
        type="button"
        onClick={onSave}
        aria-expanded={mode === 'save'}
        className={buttonClassName}
        style={buttonClassName ? tealOverride : btn}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <path d="M17 21v-8H7v8M7 3v5h8" />
        </svg>
        Save this result
      </button>
      <button type="button" onClick={onSuggest} aria-expanded={mode === 'suggest'} style={linkBtn} data-suggest-feature="">
        Suggest a feature
      </button>

      {open && (
        <div role="region" aria-label="Feedback on this tool" style={panel} data-save-result-note="">
          {mode === 'save' && (
            <p style={{ margin: '0 0 10px' }}>
              <b>Saved results and history are not available yet.</b> We are deciding whether to build them, and this
              click counts as a vote. For now, <b>Download</b> or <b>Share link</b> keeps this result.
            </p>
          )}

          {send === 'done' ? (
            <p style={{ margin: 0, color: '#047857' }}>
              <b>Thank you — noted.</b>{' '}
              {email.trim() ? 'We will write once, when there is something to show.' : 'Every answer here goes straight into what we build next.'}
            </p>
          ) : (
            <form onSubmit={onSubmit}>
              <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#0f172a' }}>
                {mode === 'save' ? 'What else would make this tool more useful?' : 'What would make this tool more useful?'}
              </p>
              <div style={{ display: 'grid', gap: 4, marginBottom: 10 }}>
                {list.map((w) => (
                  <label key={w.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={wants.has(w.key)} onChange={() => toggle(w.key)} style={{ marginTop: 3, accentColor: TEAL }} />
                    <span>{w.label}</span>
                  </label>
                ))}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                placeholder="Something else? A substance that is missing, a step that gets in the way, a format you need…"
                aria-label="Something else"
                rows={2}
                style={{ ...field, resize: 'vertical', marginBottom: 8 }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email — optional, only if you want to hear back"
                  aria-label="Email, optional"
                  autoComplete="email"
                  style={{ ...field, flex: '1 1 220px', width: 'auto', borderColor: emailOk ? '#cbd5e1' : '#f87171' }}
                />
                <button type="submit" disabled={!canSend} style={{ ...btn, opacity: canSend ? 1 : 0.55, cursor: canSend ? 'pointer' : 'default' }}>
                  {send === 'sending' ? 'Sending…' : 'Send'}
                </button>
                <span style={{ flexBasis: '100%', fontSize: 11.5, color: '#64748b' }}>
                  No account, no newsletter. An email is used only to reply to you.{' '}
                  <a href="/privacy/" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy</a>.
                  {send === 'error' && <span style={{ color: '#b91c1c' }}> Could not send — please try again.</span>}
                </span>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
