// src/lib/labelArtifact.ts
// Builds a self-contained "GHS Label Elements" artifact (SVG) from result data,
// and provides SVG + PDF download helpers. Reusable across the Pictogram Selector,
// Label Constructor and Safety Summary.
// No build-time deps; jsPDF is lazy-loaded only when a PDF is requested.
export type LabelArtifactInput = {
  jurisdictionTag: string; // e.g. "EU CLP"
  pictograms: { code: string; name: string; svg: string; optional: boolean }[];
  signalWord: string | null; // "Danger" | "Warning" | null
  hStatements: { code: string; text: string }[];
};
export type LabelArtifact = { svg: string; width: number; height: number };

// Full CLP supplier-label artifact input (Label Constructor).
// Mirrors the data already available in GHSLabelConstructor's UnifiedLabelPreview.
export type FullLabelInput = {
  productName: string;
  casNumber: string;
  ecNumber?: string | null;
  nominalQty?: string;
  batchNumber?: string;
  ufiCode?: string;
  signalWord: string | null; // "Danger" | "Warning" | null
  pictograms: { code: string; svg: string }[]; // svg = pictograms_signals.svg_content
  hStatements: { code: string; text: string }[];
  pStatements: { code: string; text: string }[]; // the "shown" subset
  pFormat: 'codes' | 'combined';
  combinedPText?: string; // pre-combined string when pFormat === 'combined'
  hiddenPCount?: number;
  supplier: { name?: string; address?: string; phone?: string };
};

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
// Like wrapText, but also hard-breaks tokens longer than maxChars (e.g. long
// IUPAC names with few/no spaces), so they cannot overflow a narrow column.
function hardWrapText(text: string, maxChars: number): string[] {
  const raw = String(text).split(/\s+/).filter(Boolean);
  const words: string[] = [];
  for (const w of raw) {
    if (w.length <= maxChars) {
      words.push(w);
    } else {
      for (let i = 0; i < w.length; i += maxChars) words.push(w.slice(i, i + maxChars));
    }
  }
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

// Full CLP supplier label (Label Constructor). Two-column layout matching the
// on-screen UnifiedLabelPreview: left rail = pictograms + signal word; right
// column = product identifier + meta + hazard + precautionary statements; a
// dashed supplier footer; 3px red border. Height is content-driven.
export function buildFullLabelSvg(input: FullLabelInput): LabelArtifact {
  const W = 600;
  const pad = 20;
  const border = 3;
  const railW = 84; // pictogram column width
  const picBox = 84;
  const picGap = 8;
  const colGap = 16;

  const pics = input.pictograms.filter((p) => p.svg && p.svg.trim());
  const hasLeft = pics.length > 0 || !!input.signalWord;
  const rightX = hasLeft ? pad + railW + colGap : pad;
  const rightW = W - rightX - pad;

  const FS_NAME = 16, LH_NAME = 21;
  const FS_META = 12, LH_META = 16;
  const FS_SEC = 11;
  const FS_STMT = 11.5, LH_STMT = 16;
  const codeColW = 56;
  const stmtTextX = rightX + codeColW;
  const stmtTextMax = Math.max(16, Math.floor((rightW - codeColW) / 6.2));
  const nameMax = Math.max(10, Math.floor(rightW / 8.8));

  const top = pad + 8;
  let ry = top; // right-column baseline cursor

  const rightParts: string[] = [];
  const txt = (
    x: number,
    y: number,
    s: string,
    opt: { size: number; weight?: number; fill: string; anchor?: string; mono?: boolean }
  ) =>
    `<text x="${x}" y="${y}" font-family="${opt.mono ? "'Courier New', monospace" : FONT}" font-size="${opt.size}"${
      opt.weight ? ` font-weight="${opt.weight}"` : ''
    }${opt.anchor ? ` text-anchor="${opt.anchor}"` : ''} fill="${opt.fill}">${escapeXml(s)}</text>`;

  // product name
  const nameLines = hardWrapText(input.productName || '', nameMax);
  ry += FS_NAME;
  nameLines.forEach((ln, i) => {
    rightParts.push(txt(rightX, ry + i * LH_NAME, ln, { size: FS_NAME, weight: 700, fill: '#1f2937' }));
  });
  ry += (nameLines.length - 1) * LH_NAME;

  // CAS · EC
  ry += LH_META + 4;
  const casLine = `CAS: ${input.casNumber || '\u2014'}${input.ecNumber ? `  \u00b7  EC: ${input.ecNumber}` : ''}`;
  rightParts.push(txt(rightX, ry, casLine, { size: FS_META, fill: '#6b7280' }));

  // qty / batch
  if (input.nominalQty) {
    ry += LH_META;
    rightParts.push(txt(rightX, ry, `Qty: ${input.nominalQty}`, { size: FS_META, fill: '#4b5563' }));
  }
  if (input.batchNumber) {
    ry += LH_META;
    rightParts.push(txt(rightX, ry, `Batch: ${input.batchNumber}`, { size: FS_META, fill: '#4b5563' }));
  }
  if (input.ufiCode) {
    ry += LH_META;
    rightParts.push(txt(rightX, ry, `UFI: ${input.ufiCode}`, { size: FS_META, fill: '#374151', mono: true }));
  }

  const hasH = input.hStatements.length > 0;
  const hasP = input.pStatements.length > 0 || (input.pFormat === 'combined' && !!input.combinedPText);

  if (hasH || hasP) {
    ry += 10;
    rightParts.push(`<line x1="${rightX}" y1="${ry}" x2="${W - pad}" y2="${ry}" stroke="#e5e7eb" stroke-width="1"/>`);
    ry += 6;
  }

  const secLabel = (s: string) => {
    ry += FS_SEC + 4;
    rightParts.push(
      `<text x="${rightX}" y="${ry}" font-family="${FONT}" font-size="${FS_SEC}" font-weight="700" letter-spacing="0.8" fill="#9ca3af">${escapeXml(
        s
      )}</text>`
    );
  };

  const stmtBlock = (code: string, text: string) => {
    const lines = hardWrapText(text || '', stmtTextMax);
    ry += LH_STMT;
    rightParts.push(txt(rightX, ry, code, { size: FS_STMT, weight: 700, fill: '#1f2937' }));
    lines.forEach((ln, i) => {
      rightParts.push(txt(stmtTextX, ry + i * LH_STMT, ln, { size: FS_STMT, fill: '#374151' }));
    });
    ry += (lines.length - 1) * LH_STMT + 3;
  };

  if (hasH) {
    secLabel('HAZARD STATEMENTS');
    for (const h of input.hStatements) stmtBlock(h.code, h.text);
  }

  if (hasP) {
    secLabel('PRECAUTIONARY STATEMENTS');
    if (input.pFormat === 'combined' && input.combinedPText) {
      const lines = hardWrapText(input.combinedPText, Math.max(20, Math.floor(rightW / 6.2)));
      lines.forEach((ln, i) => {
        if (i === 0) ry += LH_STMT;
        rightParts.push(txt(rightX, ry + i * LH_STMT, ln, { size: FS_STMT, fill: '#374151' }));
      });
      ry += (lines.length - 1) * LH_STMT + 3;
    } else {
      for (const p of input.pStatements) stmtBlock(p.code, p.text);
    }
    if (input.hiddenPCount && input.hiddenPCount > 0) {
      ry += LH_STMT;
      rightParts.push(txt(rightX, ry, `+${input.hiddenPCount} more \u2014 see SDS`, { size: FS_META, fill: '#92400e' }));
    }
  }

  const rightBottom = ry + 6;

  // left rail
  const leftParts: string[] = [];
  let leftBottom = top;
  if (hasLeft) {
    let py = top;
    const railCx = pad + railW / 2;
    for (const p of pics) {
      const px = pad + (railW - picBox) / 2;
      leftParts.push(placePictogram(p.svg, px, py, picBox));
      py += picBox + picGap;
    }
    if (input.signalWord) {
      const sw = input.signalWord;
      const swColor = sw === 'Danger' ? '#dc2626' : sw === 'Warning' ? '#d97706' : '#6b7280';
      py += 18;
      leftParts.push(
        `<text x="${railCx}" y="${py}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="800" fill="${swColor}">${escapeXml(
          sw.toUpperCase()
        )}</text>`
      );
      py += 6;
    }
    leftBottom = py;
  }

  const contentBottom = Math.max(rightBottom, leftBottom);

  // supplier footer
  const supLine = [input.supplier?.name, input.supplier?.address, input.supplier?.phone]
    .filter(Boolean)
    .join('  |  ');
  const footParts: string[] = [];
  let H = contentBottom + pad;
  if (supLine) {
    const fy0 = contentBottom + 12;
    footParts.push(
      `<line x1="${pad}" y1="${fy0}" x2="${W - pad}" y2="${fy0}" stroke="#d1d5db" stroke-width="1" stroke-dasharray="3 3"/>`
    );
    const supMax = Math.max(20, Math.floor((W - pad * 2) / 6.0));
    const supLines = hardWrapText(`SUPPLIER: ${supLine}`, supMax);
    const sy = fy0 + 16;
    supLines.forEach((ln, i) => {
      footParts.push(
        `<text x="${pad}" y="${sy + i * 14}" font-family="${FONT}" font-size="10.5" fill="#4b5563">${escapeXml(ln)}</text>`
      );
    });
    H = sy + (supLines.length - 1) * 14 + pad;
  }

  // assemble
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(
    `<rect x="${border / 2}" y="${border / 2}" width="${W - border}" height="${H - border}" fill="none" stroke="#dc2626" stroke-width="${border}"/>`
  );
  parts.push(...leftParts);
  parts.push(...rightParts);
  parts.push(...footParts);

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

// ── Phase B: physical sizing engine ──────────────────────────────────────────
// CLP Annex I, Table 1.3 (verified against Reg. (EC) 1272/2008 consolidated text):
// minimum label + pictogram dimensions by package capacity. For <= 3 L the
// pictogram target is 16 mm ("if possible, at least 16 x 16"); 10 mm is the
// absolute floor, used only when space is constrained (deferred to a later pass).
export type ClpTierKey = 'le3' | 'gt3le50' | 'gt50le500' | 'gt500';
export type ClpTier = {
  key: ClpTierKey;
  capacityLabel: string; // e.g. "<= 3 L"
  examples: string; // plain-language container examples
  labelMinW: number; // mm
  labelMinH: number; // mm
  pictogramMm: number; // target pictogram side (mm)
  pictogramFloorMm: number; // absolute floor (mm)
};
export const CLP_TIERS: ClpTier[] = [
  { key: 'le3', capacityLabel: '\u2264 3 L', examples: 'bottles, cans', labelMinW: 52, labelMinH: 74, pictogramMm: 16, pictogramFloorMm: 10 },
  { key: 'gt3le50', capacityLabel: '> 3\u201350 L', examples: 'jerrycans, pails', labelMinW: 74, labelMinH: 105, pictogramMm: 23, pictogramFloorMm: 23 },
  { key: 'gt50le500', capacityLabel: '> 50\u2013500 L', examples: 'drums', labelMinW: 105, labelMinH: 148, pictogramMm: 32, pictogramFloorMm: 32 },
  { key: 'gt500', capacityLabel: '> 500 L', examples: 'IBC, tanks', labelMinW: 148, labelMinH: 210, pictogramMm: 46, pictogramFloorMm: 46 },
];

// Common label-stock presets (ISO A-series). The size selector filters these to
// those that meet the chosen tier's CLP minimum; a custom size is offered too.
export type StockSize = { name: string; widthMm: number; heightMm: number };
export const LABEL_STOCK: StockSize[] = [
  { name: 'A7', widthMm: 74, heightMm: 105 },
  { name: 'A6', widthMm: 105, heightMm: 148 },
  { name: 'A5', widthMm: 148, heightMm: 210 },
];

// Rendering resolution: SVG user-units per millimetre. The PDF rasteriser scales
// further, so 4 px/mm gives ~200 dpi after the 2x canvas pass.
export const PX_PER_MM = 4;

// Fill behaviour: when content is shorter than the label, type is scaled up to
// fill ~FILL_TARGET of the height (bounded by MAX_FILL_SCALE), then the block is
// vertically centred so any residual whitespace is balanced top/bottom.
const FILL_TARGET = 0.95;
const MAX_FILL_SCALE = 4;

export type SizedLabelArtifact = LabelArtifact & {
  layout: 'two-col' | 'stacked';
  fit: {
    fits: boolean; // does all content fit within the chosen height at the legible minimum font?
    neededHeightMm: number; // minimum height (at the chosen width, min font) that fits everything
    pictogramMm: number; // pictogram side actually rendered (mm)
    belowClpMin: boolean; // chosen size is below the CLP minimum for the tier
    clpMinLabel: string; // e.g. "52 x 74 mm"
  };
};

// Build the full CLP label at a chosen physical size.
// - Pictograms scale with the label width (bigger label => bigger pictogram),
//   floored at the CLP-tier minimum and capped to 40% of the label width.
// - Fonts use the legible minimum when content is tight (so the most fits), and
//   scale UP to fill the label when there is spare height; the content block is
//   then vertically centred. When even the minimum font overflows, the label
//   grows downward and fit.fits is false (caller warns: larger label / fold-out).
// - Layout is responsive: pictogram rail + text column when wide enough, else a
//   stacked layout (pictogram row on top, full-width text below).
export function buildSizedLabel(
  input: FullLabelInput,
  opt: { tierKey: ClpTierKey; widthMm: number; heightMm: number }
): SizedLabelArtifact {
  const tier = CLP_TIERS.find((t) => t.key === opt.tierKey) || CLP_TIERS[0];
  const W = Math.round(opt.widthMm * PX_PER_MM);
  const pad = Math.round(3 * PX_PER_MM);
  const border = 3;
  const colGap = Math.round(3 * PX_PER_MM);
  const cw = (fs: number) => fs * 0.56;

  // Pictogram size: proportional to how much wider the label is than the tier
  // minimum, floored at the CLP minimum, capped at 40% of the label width.
  const picScale = opt.widthMm / tier.labelMinW;
  const picMm = Math.min(Math.max(tier.pictogramMm * picScale, tier.pictogramMm), opt.widthMm * 0.4);
  const picBox = Math.round(picMm * PX_PER_MM);
  const railW = picBox;

  // Layout chosen once (stable across fill iterations).
  const twoColTextMm = (W - railW - colGap - 2 * pad) / PX_PER_MM;
  const layout: 'two-col' | 'stacked' = twoColTextMm >= 50 ? 'two-col' : 'stacked';
  const pics = input.pictograms.filter((p) => p.svg && p.svg.trim());

  // Build the content (pictograms + text + footer) at a given font scale.
  const buildBody = (scale: number): { parts: string[]; neededHeightPx: number } => {
    const s = scale;
    const g = (n: number) => Math.round(n * s);
    const FS_NAME = Math.round(13 * s);
    const LH_NAME = Math.round(13 * 1.3 * s);
    const FS_META = Math.round(11 * s);
    const LH_META = Math.round(11 * 1.35 * s);
    const FS_SEC = Math.round(9 * s);
    const FS_STMT = Math.round(11 * s);
    const LH_STMT = Math.round(11 * 1.35 * s);
    const picGap = Math.round(2 * PX_PER_MM * s);

    const txt = (
      x: number,
      y: number,
      str: string,
      o: { size: number; weight?: number; fill: string; anchor?: string; mono?: boolean }
    ) =>
      `<text x="${x}" y="${y}" font-family="${o.mono ? "'Courier New', monospace" : FONT}" font-size="${o.size}"${
        o.weight ? ` font-weight="${o.weight}"` : ''
      }${o.anchor ? ` text-anchor="${o.anchor}"` : ''} fill="${o.fill}">${escapeXml(str)}</text>`;

    const textBlock = (x: number, width: number, startY: number): { parts: string[]; bottom: number } => {
      const parts: string[] = [];
      let ry = startY;
      const codeColW = Math.round(FS_STMT * 4.5);
      const stmtTextX = x + codeColW;
      const stmtMax = Math.max(10, Math.floor((width - codeColW) / cw(FS_STMT)));
      const nameMax = Math.max(8, Math.floor(width / cw(FS_NAME)));

      const nameLines = hardWrapText(input.productName || '', nameMax);
      ry += FS_NAME;
      nameLines.forEach((ln, i) => parts.push(txt(x, ry + i * LH_NAME, ln, { size: FS_NAME, weight: 700, fill: '#111827' })));
      ry += (nameLines.length - 1) * LH_NAME;

      ry += LH_META + g(4);
      const casLine = `CAS: ${input.casNumber || '\u2014'}${input.ecNumber ? `  \u00b7  EC: ${input.ecNumber}` : ''}`;
      parts.push(txt(x, ry, casLine, { size: FS_META, fill: '#6b7280' }));
      if (input.nominalQty) {
        ry += LH_META;
        parts.push(txt(x, ry, `Qty: ${input.nominalQty}`, { size: FS_META, fill: '#4b5563' }));
      }
      if (input.batchNumber) {
        ry += LH_META;
        parts.push(txt(x, ry, `Batch: ${input.batchNumber}`, { size: FS_META, fill: '#4b5563' }));
      }
      if (input.ufiCode) {
        ry += LH_META;
        parts.push(txt(x, ry, `UFI: ${input.ufiCode}`, { size: FS_META, fill: '#374151', mono: true }));
      }

      const hasH = input.hStatements.length > 0;
      const hasP = input.pStatements.length > 0 || (input.pFormat === 'combined' && !!input.combinedPText);
      if (hasH || hasP) {
        ry += g(10);
        parts.push(`<line x1="${x}" y1="${ry}" x2="${x + width}" y2="${ry}" stroke="#e5e7eb" stroke-width="1"/>`);
        ry += g(6);
      }
      const secLabel = (str: string) => {
        ry += FS_SEC + g(4);
        parts.push(txt(x, ry, str, { size: FS_SEC, weight: 700, fill: '#9ca3af' }));
      };
      const stmtBlock = (code: string, text: string) => {
        const lines = hardWrapText(text || '', stmtMax);
        ry += LH_STMT;
        parts.push(txt(x, ry, code, { size: FS_STMT, weight: 700, fill: '#111827' }));
        lines.forEach((ln, i) => parts.push(txt(stmtTextX, ry + i * LH_STMT, ln, { size: FS_STMT, fill: '#374151' })));
        ry += (lines.length - 1) * LH_STMT + g(3);
      };
      if (hasH) {
        secLabel('HAZARD STATEMENTS');
        for (const h of input.hStatements) stmtBlock(h.code, h.text);
      }
      if (hasP) {
        secLabel('PRECAUTIONARY STATEMENTS');
        if (input.pFormat === 'combined' && input.combinedPText) {
          const lines = hardWrapText(input.combinedPText, Math.max(14, Math.floor(width / cw(FS_STMT))));
          lines.forEach((ln, i) => {
            if (i === 0) ry += LH_STMT;
            parts.push(txt(x, ry + i * LH_STMT, ln, { size: FS_STMT, fill: '#374151' }));
          });
          ry += (lines.length - 1) * LH_STMT + g(3);
        } else {
          for (const p of input.pStatements) stmtBlock(p.code, p.text);
        }
        if (input.hiddenPCount && input.hiddenPCount > 0) {
          ry += LH_STMT;
          parts.push(txt(x, ry, `+${input.hiddenPCount} more \u2014 see SDS`, { size: FS_META, fill: '#92400e' }));
        }
      }
      return { parts, bottom: ry + g(6) };
    };

    const top = pad + Math.round(FS_NAME * 0.5);
    let body: string[] = [];
    let contentBottom = top;
    const signalColor =
      input.signalWord === 'Danger' ? '#dc2626' : input.signalWord === 'Warning' ? '#d97706' : '#6b7280';

    if (layout === 'two-col') {
      const rightX = pad + railW + colGap;
      const rightW = W - rightX - pad;
      const tb = textBlock(rightX, rightW, top);
      let py = top;
      for (const p of pics) {
        body.push(placePictogram(p.svg, pad, py, picBox));
        py += picBox + picGap;
      }
      if (input.signalWord) {
        py += Math.round(FS_NAME * 1.1);
        body.push(
          `<text x="${pad + railW / 2}" y="${py}" text-anchor="middle" font-family="${FONT}" font-size="${Math.max(
            12,
            Math.round(picBox * 0.22)
          )}" font-weight="800" fill="${signalColor}">${escapeXml(input.signalWord.toUpperCase())}</text>`
        );
        py += g(6);
      }
      body = body.concat(tb.parts);
      contentBottom = Math.max(py, tb.bottom);
    } else {
      let rowY = top;
      let x = pad;
      let rowBottom = top;
      for (const p of pics) {
        if (x + picBox > W - pad && x > pad) {
          rowY = rowBottom + picGap;
          x = pad;
        }
        body.push(placePictogram(p.svg, x, rowY, picBox));
        x += picBox + picGap;
        rowBottom = Math.max(rowBottom, rowY + picBox);
      }
      // Signal word on its own line below the pictogram row (prevents overlap when
      // pictograms span the full width of the row).
      let blockTop = rowBottom;
      if (input.signalWord) {
        const sfs = Math.max(16, Math.round(picBox * 0.42));
        blockTop += g(2) + sfs;
        body.push(
          `<text x="${pad}" y="${blockTop}" font-family="${FONT}" font-size="${sfs}" font-weight="800" fill="${signalColor}">${escapeXml(
            input.signalWord.toUpperCase()
          )}</text>`
        );
      }
      const tb = textBlock(pad, W - 2 * pad, blockTop + g(2));
      body = body.concat(tb.parts);
      contentBottom = tb.bottom;
    }

    // Supplier footer (full width, dashed rule).
    const footParts: string[] = [];
    let bottom = contentBottom + pad;
    const supLine = [input.supplier?.name, input.supplier?.address, input.supplier?.phone].filter(Boolean).join('  |  ');
    if (supLine) {
      const fy0 = contentBottom + g(12);
      footParts.push(
        `<line x1="${pad}" y1="${fy0}" x2="${W - pad}" y2="${fy0}" stroke="#d1d5db" stroke-width="1" stroke-dasharray="3 3"/>`
      );
      const supMax = Math.max(16, Math.floor((W - pad * 2) / cw(FS_META)));
      const supLines = hardWrapText(`SUPPLIER: ${supLine}`, supMax);
      const sy = fy0 + FS_META + g(4);
      supLines.forEach((ln, i) => footParts.push(txt(pad, sy + i * LH_META, ln, { size: FS_META, fill: '#4b5563' })));
      bottom = sy + (supLines.length - 1) * LH_META + pad;
    }

    return { parts: [...body, ...footParts], neededHeightPx: bottom };
  };

  const targetHpx = Math.round(opt.heightMm * PX_PER_MM);
  const base = buildBody(1);
  let result = base;
  let fits: boolean;
  if (base.neededHeightPx <= targetHpx) {
    fits = true;
    let scale = Math.min(MAX_FILL_SCALE, (targetHpx * FILL_TARGET) / base.neededHeightPx);
    result = buildBody(scale);
    // Bigger fonts wrap more (super-linear height), so correct any overshoot.
    let guard = 0;
    while (result.neededHeightPx > targetHpx && scale > 1 && guard < 4) {
      scale = Math.max(1, scale * (targetHpx / result.neededHeightPx) * 0.98);
      result = buildBody(scale);
      guard++;
    }
  } else {
    fits = false;
  }

  const Hpx = fits ? targetHpx : result.neededHeightPx;
  const offY = fits ? Math.max(0, Math.round((Hpx - result.neededHeightPx) / 2)) : 0;
  const content = offY > 0 ? `<g transform="translate(0, ${offY})">${result.parts.join('')}</g>` : result.parts.join('');
  const belowClpMin = opt.widthMm < tier.labelMinW - 0.5 || opt.heightMm < tier.labelMinH - 0.5;

  const all = [
    `<rect x="0" y="0" width="${W}" height="${Hpx}" fill="#ffffff"/>`,
    `<rect x="${border / 2}" y="${border / 2}" width="${W - border}" height="${Hpx - border}" fill="none" stroke="#dc2626" stroke-width="${border}"/>`,
    content,
  ];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hpx}" viewBox="0 0 ${W} ${Hpx}" font-family="${FONT}">` +
    all.join('') +
    `</svg>`;
  return {
    svg,
    width: W,
    height: Hpx,
    layout,
    fit: {
      fits,
      neededHeightMm: Math.ceil(base.neededHeightPx / PX_PER_MM),
      pictogramMm: Math.round(picMm),
      belowClpMin,
      clpMinLabel: `${tier.labelMinW} \u00d7 ${tier.labelMinH} mm`,
    },
  };
}

// Physical-size PDF: the page equals the label's TRUE size (which may have grown
// past the requested height to fit content), so printing at 100% / "actual size"
// yields a correctly-sized label. Use downloadPdf (A4-fit) for reference documents.
export async function downloadLabelPdf(artifact: LabelArtifact, filename: string) {
  const { jsPDF } = await import('jspdf');
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
  const pageWmm = artifact.width / PX_PER_MM;
  const pageHmm = artifact.height / PX_PER_MM;
  const pdf = new jsPDF({
    unit: 'mm',
    format: [pageWmm, pageHmm],
    orientation: pageHmm >= pageWmm ? 'portrait' : 'landscape',
  });
  pdf.addImage(png, 'PNG', 0, 0, pageWmm, pageHmm);
  pdf.save(filename);
}
