import { useState } from 'react';
import type React from 'react';

interface SvgDownloadButtonProps {
  svgUrl: string;      // URL SVG файла (например Wikimedia Commons)
  fileName: string;    // Имя файла для скачивания (например "GHS02.svg")
  ghsCode: string;     // Например "GHS02"
  ghsName: string;     // Например "Flame"
}

export default function SvgDownloadButton({ svgUrl, fileName, ghsCode, ghsName }: SvgDownloadButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleDownloadClick = () => {
    setShowModal(true);
    setStatus('idle');
    setEmail('');
    setErrorMsg('');
  };

  const handleSubmit = async () => {
    if (!email || !email.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setStatus('loading');

    try {
      // Отправляем лид в Brevo через уже существующий endpoint
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          source: 'svg-download',
          ghsCode,
          ghsName,
          tool: `SVG Download: ${fileName}`,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Submission failed');
      }

      setStatus('success');

      // Скачиваем SVG через fetch → blob → ссылка
      // Это обходит CORS для прямых ссылок Wikimedia
      setTimeout(async () => {
        try {
          const svgRes = await fetch(svgUrl);
          const blob = await svgRes.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        } catch {
          // Fallback: открыть в новой вкладке
          window.open(svgUrl, '_blank');
        }
        setTimeout(() => setShowModal(false), 1500);
      }, 600);

    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Something went wrong. Please try again.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') setShowModal(false);
  };

  return (
    <>
      {/* Кнопка скачивания */}
      <button
        onClick={handleDownloadClick}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors duration-200 text-sm shadow-sm"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Download {fileName}
      </button>

      {/* Модальное окно */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 relative">
            {/* Закрыть */}
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl font-bold leading-none"
              aria-label="Close"
            >
              ×
            </button>

            {status === 'success' ? (
              /* Успех */
              <div className="text-center py-4">
                <div className="text-5xl mb-4">✅</div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Download starting…</h3>
                <p className="text-gray-500 text-sm">Check your downloads folder for <strong>{fileName}</strong></p>
              </div>
            ) : (
              /* Форма */
              <>
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                    🏷️
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Get your free SVG</h3>
                    <p className="text-sm text-gray-500">
                      High-resolution <strong>{ghsCode}</strong> ({ghsName}) pictogram
                    </p>
                  </div>
                </div>

                <p className="text-sm text-gray-600 mb-5">
                  Enter your email to download <strong>{fileName}</strong>. We'll also send you occasional GHS compliance tips — unsubscribe anytime.
                </p>

                <div className="space-y-3">
                  <input
                    type="email"
                    placeholder="your@company.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setErrorMsg(''); }}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400"
                  />

                  {errorMsg && (
                    <p className="text-red-500 text-xs">{errorMsg}</p>
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={status === 'loading'}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
                  >
                    {status === 'loading' ? (
                      <>
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                        </svg>
                        Preparing download…
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download Free SVG
                      </>
                    )}
                  </button>
                </div>

                <p className="text-xs text-gray-400 mt-4 text-center">
                  🔒 No spam. GHS compliance updates only. Unsubscribe anytime.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

