import { useState } from 'react';
import NewsletterOptIn from './NewsletterOptIn';

interface SvgDownloadButtonProps {
  svgUrl: string;      // URL SVG файла (например Wikimedia Commons)
  fileName: string;    // Имя файла для скачивания (например "GHS02.svg")
  ghsCode: string;     // Например "GHS02"  (передаётся со страницы; оставлен в контракте)
  ghsName: string;     // Например "Flame" (передаётся со страницы; оставлен в контракте)
}

export default function SvgDownloadButton({ svgUrl, fileName }: SvgDownloadButtonProps) {
  const [downloading, setDownloading] = useState(false);

  // Un-gated (§7.10): скачивание сразу, без email и без /api/leads.
  // Email собираем отдельно — опциональный newsletter ниже (DOI → /api/subscribe).
  const handleDownload = async () => {
    setDownloading(true);
    try {
      // fetch → blob → ссылка: обходит CORS прямых ссылок Wikimedia.
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
      // Fallback: открыть в новой вкладке.
      window.open(svgUrl, '_blank');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      {/* Кнопка скачивания — без gate */}
      <button
        onClick={handleDownload}
        disabled={downloading}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors duration-200 text-sm shadow-sm"
      >
        {downloading ? (
          <>
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Preparing…
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download {fileName}
          </>
        )}
      </button>

      {/* Опциональная подписка (вариант 2) — DOI, НЕ gate */}
      <NewsletterOptIn source="svg_download" />
    </div>
  );
}
