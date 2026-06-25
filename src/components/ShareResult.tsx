import { useEffect, useState, type CSSProperties } from 'react';

interface Props {
  /** Absolute share URL with the encoded result state already baked in. */
  url: string;
  /** Text used for the X tweet + the native share sheet. */
  title: string;
}

const btn: CSSProperties = {
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
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};

// GA4 'share' event — same name as SharePage so analytics stays unified.
function trackShare(method: string) {
  if (typeof window === 'undefined') return;
  const g = (window as any).gtag;
  if (typeof g === 'function') {
    g('event', 'share', { page: window.location.pathname, method });
  }
}

export default function ShareResult({ url, title }: Props) {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  // navigator is client-only — detect after hydration, never during SSR.
  useEffect(() => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      setCanNativeShare(true);
    }
  }, []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      trackShare('copy');
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const onNative = async () => {
    try {
      await navigator.share({ title, url });
      trackShare('native');
    } catch {
      /* user cancelled — ignore */
    }
  };

  const xHref = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`;
  const liHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>Share result:</span>

      <button type="button" style={btn} onClick={onCopy}>
        {copied ? 'Copied' : 'Copy link'}
      </button>

      {canNativeShare && (
        <button type="button" style={btn} onClick={onNative}>
          Share…
        </button>
      )}

      <a style={btn} href={xHref} target="_blank" rel="noopener noreferrer" onClick={() => trackShare('x')}>
        X
      </a>

      <a style={btn} href={liHref} target="_blank" rel="noopener noreferrer" onClick={() => trackShare('linkedin')}>
        LinkedIn
      </a>
    </div>
  );
}
