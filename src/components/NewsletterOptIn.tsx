import { useState } from 'react';
import type React from 'react';

interface NewsletterOptInProps {
  /** Какой инструмент под собой держит opt-in — уходит в GA4-событие (напр. "svg_download"). */
  source: string;
}

type Status = 'idle' | 'loading' | 'success' | 'already' | 'error';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export default function NewsletterOptIn({ source }: NewsletterOptInProps) {
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit = consent && emailValid && status !== 'loading';

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setStatus('loading');
    setErrorMsg('');

    try {
      // Working DOI endpoint (Phase 1): Brevo double opt-in → list #6.
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        // GA4 — меряем opt-in rate (вариант 2). Consent Mode gtag учитывает сам.
        // SSR-safe: вызывается только в обработчике, не при рендере.
        if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
          (window as any).gtag('event', 'newsletter_subscribe', { source });
        }
        setStatus(data.alreadySubscribed ? 'already' : 'success');
      } else {
        setStatus('error');
        setErrorMsg('Something went wrong. Please try again.');
      }
    } catch {
      setStatus('error');
      setErrorMsg('Something went wrong. Please try again.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  // Успех / уже подписан — заменяем форму сообщением.
  if (status === 'success' || status === 'already') {
    return (
      <div className="mt-4 border-t border-gray-200 pt-4">
        <p className="text-sm text-green-700 flex items-start gap-2">
          <span aria-hidden="true">✓</span>
          <span>
            {status === 'already'
              ? "You're already on the list — thanks!"
              : 'Almost there — check your inbox and click the link to confirm your subscription.'}
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-gray-200 pt-4">
      {/* Согласие — НЕ отмечено по умолчанию (GDPR Art 7, affirmative action). */}
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-blue-600 flex-shrink-0 cursor-pointer"
        />
        <span className="text-xs text-gray-500 leading-snug">
          Email me GHS / CLP / OSHA compliance updates and regulatory deadline alerts, plus a free 2026–2029 compliance deadline calendar. Unsubscribe anytime.{' '}
          <a href="/privacy/" className="underline hover:text-gray-700">Privacy Policy</a>
        </span>
      </label>

      <div className="flex flex-col sm:flex-row gap-2 mt-2">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (status === 'error') setStatus('idle'); }}
          onKeyDown={handleKeyDown}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-sm whitespace-nowrap flex items-center justify-center gap-2"
        >
          {status === 'loading' ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Subscribing…
            </>
          ) : (
            'Subscribe'
          )}
        </button>
      </div>

      {status === 'error' && (
        <p className="text-red-500 text-xs mt-2">{errorMsg}</p>
      )}
    </div>
  );
}
