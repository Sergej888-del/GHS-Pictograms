// DirectoryClaimForm — «Claim or correct this listing» и «Suggest a listing» (№148, s92, §18.3).
//
// ⚠ НОВОЙ ТАБЛИЦЫ И НОВОГО RPC НЕТ — форма идёт существующим путём сигналов:
// браузер → POST /api/signal (kind 'feedback') → Turnstile → лимит по IP → RPC
// record_tool_feedback(tool='directory', wants=['claim'|'correct'|'suggest'], comment, email).
// Email дублируется в leads (use_case='tool_feedback', source_tool='directory') — как требует
// §18.3 («форма пишет в leads через существующий путь»). Лимиты RPC: ≤ 3 отправки на посетителя
// в сутки, комментарий ≤ 500 знаков — поэтому сообщение режется здесь, с запасом под префикс.
//
// Шаг 1 по §18.3: заявки разбираются руками (Claude правит directory_entries / directory_facts
// MCP-миграцией с архивом и ставит tier='claimed', claimed_on). Шаг 2 (magic link с проверкой
// домена почты) — когда заявок станет больше ~10 в месяц.
//
// Отчёт: select created_at::date, wants, page, comment, email from public.tool_feedback
//        where tool = 'directory' order by created_at desc;

import { useState, type FormEvent } from 'react'
import { recordToolFeedback, track } from '../lib/toolSignals'

interface Props {
  /** 'entry' — форма на странице записи; 'suggest' — на хабе («предложить запись»). */
  mode: 'entry' | 'suggest'
  /** Слуг записи — уходит префиксом комментария, чтобы заявку нельзя было спутать с соседней. */
  slug?: string
  title?: string
}

type Kind = 'claim' | 'correct' | 'suggest'
type SendState = 'idle' | 'sending' | 'done' | 'error'

const EMAIL_RE = /^\S+@\S+\.\S+$/
const MAX_COMMENT = 500

export default function DirectoryClaimForm({ mode, slug, title }: Props) {
  const [kind, setKind] = useState<Kind>(mode === 'suggest' ? 'suggest' : 'claim')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('employee')
  const [message, setMessage] = useState('')
  const [authorised, setAuthorised] = useState(false)
  // s96: вторая галочка заявки — прислать код вставки бейджа «Verified listing» (tiers-doc §4 п. 1, §8).
  const [badge, setBadge] = useState(true)
  const [state, setState] = useState<SendState>('idle')
  const [error, setError] = useState('')

  const prefix = mode === 'suggest'
    ? '[suggest]'
    : `[${kind}:${slug ?? '?'}] role=${role}${name ? `; name=${name.trim()}` : ''}${kind === 'claim' ? `; badge=${badge ? 'yes' : 'no'}` : ''};`
  const room = Math.max(0, MAX_COMMENT - prefix.length - 1)

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    setError('')
    if (!EMAIL_RE.test(email.trim())) return setError('Please enter a work e-mail address we can reply to.')
    if (mode === 'entry' && kind === 'claim' && !authorised)
      return setError('Please confirm that you work for, or are authorised to represent, this company.')
    if (!message.trim() && kind !== 'claim') return setError('Please tell us what to add or correct.')
    setState('sending')
    const comment = `${prefix} ${message.trim()}`.slice(0, MAX_COMMENT)
    const ok = await recordToolFeedback('directory', [kind], comment, email)
    track('directory_request', { kind, slug: slug ?? null })
    setState(ok ? 'done' : 'error')
  }

  if (state === 'done') {
    return (
      <div className="dir-form dir-form-done" role="status">
        <p className="dir-form-h">Thank you — it has reached us.</p>
        <p>
          A person reads every request. We reply from <strong>hello@ghspictograms.com</strong>, usually within a few
          working days, with the list of facts the card prints so you can confirm or correct each line. A claimed listing
          shows “Verified by owner” with the date, your logo and a short description once the facts are confirmed;
          claiming is free, and verified listings come first in their section.
        </p>
      </div>
    )
  }

  return (
    <form className="dir-form" onSubmit={onSubmit} noValidate data-dir-form={mode}>
      {mode === 'entry' && (
        <fieldset className="dir-form-kind">
          <legend className="sr-only">What would you like to do?</legend>
          <label>
            <input type="radio" name="kind" checked={kind === 'claim'} onChange={() => setKind('claim')} />
            Claim this listing <span>— free; confirm or correct the facts as the owner</span>
          </label>
          <label>
            <input type="radio" name="kind" checked={kind === 'correct'} onChange={() => setKind('correct')} />
            Report a correction <span>— anyone; tell us what is wrong and where you saw it</span>
          </label>
        </fieldset>
      )}

      <div className="dir-form-row">
        <label>
          Work e-mail
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} />
        </label>
        {mode === 'entry' && (
          <label>
            Your name <span className="opt">(optional)</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} />
          </label>
        )}
      </div>

      {mode === 'entry' && kind === 'claim' && (
        <label className="dir-form-wide">
          Your relationship to {title ?? 'the company'}
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="employee">I work for this company</option>
            <option value="agency">I represent it (agency, partner)</option>
            <option value="other">Other</option>
          </select>
        </label>
      )}

      <label className="dir-form-wide">
        {mode === 'suggest'
          ? 'Which tool or service should we look at? Name, website, and what it does.'
          : kind === 'claim'
            ? 'Anything to correct now? (optional — we will reply either way)'
            : 'What is wrong, and where can we check the right fact?'}
        <textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, room))} rows={4} />
        <span className="dir-form-count">{message.length} / {room}</span>
      </label>

      {mode === 'entry' && kind === 'claim' && (
        <>
          <label className="dir-form-check">
            <input type="checkbox" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} />
            I work for, or am authorised to represent, this company. We check that the reply address belongs to its domain.
          </label>
          <label className="dir-form-check">
            <input type="checkbox" checked={badge} onChange={(e) => setBadge(e.target.checked)} />
            Send me the embed code for the “Verified listing” badge once the facts are confirmed (free; it links to this card).
          </label>
        </>
      )}

      {error && <p className="dir-form-error" role="alert">{error}</p>}
      {state === 'error' && (
        <p className="dir-form-error" role="alert">
          The request did not go through. Please try again, or write to hello@ghspictograms.com.
        </p>
      )}

      <div className="dir-form-actions">
        <button type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : mode === 'suggest' ? 'Suggest it' : kind === 'claim' ? 'Claim this listing' : 'Send the correction'}
        </button>
        <span className="dir-form-fine">
          Your address is used only to reply about this listing. No newsletter, no sale of data.{' '}
          <a href="/privacy/">Privacy</a>
        </span>
      </div>
    </form>
  )
}
