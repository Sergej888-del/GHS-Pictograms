// src/lib/labelArtifact.ts
// Собирает самодостаточный SVG «GHS Label Elements» (пиктограммы + сигнальное
// слово + H-фразы) и даёт выгрузку в SVG и PDF.
// Сборочных зависимостей нет; jsPDF подгружается лениво, только под PDF.
//
// ⚠⚠ ЕДИНСТВЕННЫЙ ПОТРЕБИТЕЛЬ — `PictogramSelector.tsx`, и он берёт ровно три
// экспорта: `buildLabelElementsSvg`, `downloadSvg`, `downloadPdf`. Это НЕ движок
// этикетки. Полную этикетку CLP/OSHA строит `labelEngine.ts` (`layoutLabel` +
// `renderSvg`), и только он.
//
// ⚠⚠ ЧТО ОТСЮДА СНЕСЕНО В SESSION 68 И ПОЧЕМУ ЭТОГО НЕ НАДО ВОЗВРАЩАТЬ.
// Файл держал 602 строки, которые не читал никто, — вторую реализацию полной
// этикетки (`buildFullLabelSvg`, `buildSizedLabel`, `FullLabelInput`,
// `SizedLabelArtifact`, `PX_PER_MM`) и при ней ВТОРУЮ копию Table 1.3
// (`CLP_TIERS`) и третью копию форматов этикеточной бумаги (`LABEL_STOCK`).
//
// ⛔⛔ Копии УЖЕ разошлись с живыми — предсказанный отказ успел случиться:
//   · `CLP_SIZE_TIERS` в `jurisdictions.ts` держит `maxLitres` (ярус по объёму
//     тары) и `labelSidesBinding` (у ≤ 3 л таблица говорит «if possible», то есть
//     минимума НЕ ставит) — в снесённой копии обоих полей не было вовсе;
//   · примеры тары разъехались текстом: `bottles, cans, aerosols` против
//     `bottles, cans`, `IBCs, tanks` против `IBC, tanks`.
// Поднять мёртвый код из истории значит вернуть дефект, закрытый в session 65.
//
// ⛔ И отдельно: здесь лежала `downloadLabelPdf` — ОДНОИМЁННАЯ с живой из
// `labelEngine.ts:1650`, но берущая другой аргумент. Импорт «не из того файла»
// собрался бы и молча дал другую страницу PDF.
//
// ⭐ Авторитетные источники, если понадобятся: размеры CLP Table 1.3 —
// `CLP_SIZE_TIERS` и `labelSizeVerdict` в `src/lib/jurisdictions.ts`; форматы
// этикеточной бумаги — `LABEL_STOCK_ALL` в `src/lib/labelStock.ts`.
// Старый текст целиком: `git show 0b03c83:src/lib/labelArtifact.ts`.
export type LabelArtifactInput = {
  jurisdictionTag: string; // e.g. "EU CLP"
  pictograms: { code: string; name: string; svg: string; optional: boolean }[];
  signalWord: string | null; // "Danger" | "Warning" | null
  hStatements: { code: string; text: string }[];
};
export type LabelArtifact = { svg: string; width: number; height: number };

const FONT = "Arial, Helvetica, 'Helvetica Neue', sans-serif";
function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function wrapText(text: string, maxChars: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
// Nest a pictogram's inline SVG at (x,y) sized box×box.
// Pictogram SVGs may already carry width/height/x/y/preserveAspectRatio on the root <svg>
// (e.g. GHS01 has width/height in pt), so strip those from the opening tag first, then
// inject our own — otherwise duplicate attributes make the composed SVG invalid.
function placePictogram(svgContent: string, x: number, y: number, box: number): string {
  const s = String(svgContent).trim();
  const m = s.match(/^<svg\b[^>]*>/i);
  if (!m) return s;
  const openTag = m[0]
    .replace(/\s(?:width|height|x|y|preserveAspectRatio)\s*=\s*"[^"]*"/gi, '')
    .replace(/\s(?:width|height|x|y|preserveAspectRatio)\s*=\s*'[^']*'/gi, '')
    .replace(/^<svg\b/i, `<svg x="${x}" y="${y}" width="${box}" height="${box}" preserveAspectRatio="xMidYMid meet"`);
  return openTag + s.slice(m[0].length);
}
export function buildLabelElementsSvg(input: LabelArtifactInput): LabelArtifact {
  const W = 720;
  const padX = 40;
  const usable = W - padX * 2;
  // ---- layout math (everything relative) ----
  const headerTop = 36;
  const headerH = 54;
  let y = headerTop + headerH;
  const picBox = 64;
  const cellW = 86;
  const cellH = 106;
  const cellGap = 12;
  const perRow = Math.max(1, Math.floor((usable + cellGap) / (cellW + cellGap)));
  const picList = input.pictograms;
  const hasPics = picList.length > 0;
  const picRows = hasPics ? Math.ceil(picList.length / perRow) : 0;
  const secLabelH = 26;
  const picSectionTop = y + 8;
  const picGridTop = picSectionTop + secLabelH;
  const picSectionBottom = hasPics
    ? picGridTop + picRows * cellH + (picRows - 1) * 8
    : picGridTop + 22;
  const sigTop = picSectionBottom + 18;
  const sigLabelY = sigTop;
  const sigValueY = sigTop + secLabelH + 6;
  const sigBottom = sigValueY + 22;
  const hsTop = sigBottom + 18;
  const hsLabelY = hsTop;
  let hsCur = hsTop + secLabelH;
  const codeColW = 48;
  const textX = padX + codeColW;
  const textMaxChars = Math.max(20, Math.floor((usable - codeColW) / 6.7));
  const lineH = 19;
  const hsBlocks: string[] = [];
  if (input.hStatements.length > 0) {
    for (const h of input.hStatements) {
      const lines = wrapText(h.text || '', textMaxChars);
      hsBlocks.push(
        `<text x="${padX}" y="${hsCur}" font-family="${FONT}" font-size="13" font-weight="700" fill="#16224a">${escapeXml(
          h.code
        )}</text>`
      );
      lines.forEach((ln, i) => {
        hsBlocks.push(
          `<text x="${textX}" y="${hsCur + i * lineH}" font-family="${FONT}" font-size="13" fill="#2a3656">${escapeXml(
            ln
          )}</text>`
        );
      });
      hsCur += Math.max(1, lines.length) * lineH + 8;
    }
  } else {
    hsBlocks.push(
      `<text x="${padX}" y="${hsCur}" font-family="${FONT}" font-size="13" fill="#8a94a6">&#8212;</text>`
    );
    hsCur += lineH + 8;
  }
  const hsBottom = hsCur;
  const footTop = hsBottom + 18;
  const H = footTop + 40;
  // ---- build pieces ----
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#e6e9f0" stroke-width="1"/>`
  );
  // header
  parts.push(
    `<text x="${padX}" y="${headerTop + 22}" font-family="${FONT}" font-size="20" font-weight="700" fill="#16224a">GHS Label Elements</text>`
  );
  const jtag = escapeXml(input.jurisdictionTag || '');
  const chipW = 14 + jtag.length * 7.2;
  const chipX = W - padX - chipW;
  parts.push(
    `<rect x="${chipX}" y="${headerTop + 3}" width="${chipW}" height="22" rx="5" fill="#eaf1fd" stroke="#d4e3fb"/>`
  );
  parts.push(
    `<text x="${chipX + chipW / 2}" y="${headerTop + 18}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" fill="#1f5fd0">${jtag}</text>`
  );
  parts.push(
    `<line x1="${padX}" y1="${headerTop + headerH - 4}" x2="${W - padX}" y2="${headerTop + headerH - 4}" stroke="#eef1f6" stroke-width="1"/>`
  );
  const secLabel = (label: string, yy: number) =>
    `<text x="${padX}" y="${yy}" font-family="${FONT}" font-size="11" font-weight="700" letter-spacing="1.2" fill="#8a94a6">${escapeXml(
      label.toUpperCase()
    )}</text>`;
  // pictograms
  parts.push(secLabel('Pictograms', picSectionTop + 14));
  if (hasPics) {
    picList.forEach((p, idx) => {
      const row = Math.floor(idx / perRow);
      const col = idx % perRow;
      const cx = padX + col * (cellW + cellGap);
      const cyTop = picGridTop + row * (cellH + 8);
      parts.push(
        `<rect x="${cx}" y="${cyTop}" width="${cellW}" height="${cellH}" rx="10" fill="#ffffff" stroke="#f0d6d7"/>`
      );
      const iconX = cx + (cellW - picBox) / 2;
      const iconY = cyTop + 10;
      if (p.svg) parts.push(placePictogram(p.svg, iconX, iconY, picBox));
      parts.push(
        `<text x="${cx + cellW / 2}" y="${cyTop + 90}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="#16224a">${escapeXml(
          p.code
        )}</text>`
      );
      parts.push(
        `<text x="${cx + cellW / 2}" y="${cyTop + 102}" text-anchor="middle" font-family="${FONT}" font-size="9.5" fill="#7a8398">${escapeXml(
          p.name || ''
        )}</text>`
      );
      if (p.optional) {
        parts.push(
          `<rect x="${cx + cellW - 50}" y="${cyTop - 7}" width="56" height="15" rx="7.5" fill="#f6c453"/>`
        );
        parts.push(
          `<text x="${cx + cellW - 22}" y="${cyTop + 3.5}" text-anchor="middle" font-family="${FONT}" font-size="8.5" font-weight="700" fill="#5b4708">optional</text>`
        );
      }
    });
  } else {
    parts.push(
      `<text x="${padX}" y="${picGridTop + 6}" font-family="${FONT}" font-size="13" fill="#8a94a6">No pictogram required for the selected classification.</text>`
    );
  }
  // signal word
  parts.push(secLabel('Signal word', sigLabelY + 14));
  const sw = input.signalWord;
  const swColor = sw === 'Danger' ? '#d8232a' : sw === 'Warning' ? '#c77700' : '#8a94a6';
  parts.push(
    `<text x="${padX}" y="${sigValueY + 6}" font-family="${FONT}" font-size="24" font-weight="700" fill="${swColor}">${escapeXml(
      sw || '\u2014'
    )}</text>`
  );
  // hazard statements
  parts.push(secLabel('Hazard statements', hsLabelY + 14));
  parts.push(...hsBlocks);
  // footer
  parts.push(
    `<line x1="${padX}" y1="${footTop}" x2="${W - padX}" y2="${footTop}" stroke="#eef1f6" stroke-width="1"/>`
  );
  parts.push(
    `<text x="${padX}" y="${footTop + 20}" font-family="${FONT}" font-size="10.5" fill="#9aa3b5">Generated with ghspictograms.com &#8212; reference only. Verify against the current legal text for your jurisdiction.</text>`
  );
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">` +
    parts.join('') +
    `</svg>`;
  return { svg, width: W, height: H };
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export function downloadSvg(svg: string, filename: string) {
  triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), filename);
}
export async function downloadPdf(artifact: LabelArtifact, filename: string) {
  const { jsPDF } = await import('jspdf');
  // Rasterize the SVG via <img> -> canvas (reliable; avoids SVG-parser quirks).
  const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(artifact.svg);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('SVG render failed'));
    img.src = svgUrl;
  });
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = artifact.width * scale;
  canvas.height = artifact.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 36;
  const ratio = artifact.height / artifact.width;
  let drawW = pageW - margin * 2;
  let drawH = drawW * ratio;
  if (drawH > pageH - margin * 2) {
    drawH = pageH - margin * 2;
    drawW = drawH / ratio;
  }
  const x = (pageW - drawW) / 2;
  pdf.addImage(png, 'PNG', x, margin, drawW, drawH);
  pdf.save(filename);
}
