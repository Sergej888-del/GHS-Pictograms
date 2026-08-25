// src/lib/classifier/reportHtml.ts — та же модель отчёта, но строкой для PDF.
//
// ⭐⭐⭐ ВТОРАЯ ПРОЕКЦИЯ ОДНОЙ МОДЕЛИ (`report.ts`). Этот файл НЕ решает, что
// печатать, — только как. Поэтому экран и PDF не могут разойтись содержимым:
// разойтись им нечем, оба читают `ReportModel`.
//
// ⚠⚠ ЦВЕТА — ШЕСТНАДЦАТЕРИЧНЫЕ, И ЭТО НЕ НАРУШЕНИЕ ДИЗАЙН-СИСТЕМЫ. html2canvas
// 1.4.1 не разбирает `oklch(…)` Tailwind v4 (урок s79): токен, доехавший до
// клона документа, роняет рендер целиком. Отсюда же `onclone` в острове.
//
// ⚠ Файл грузится ДИНАМИЧЕСКИМ import() по клику вместе с html2pdf — в основной
// бандл страницы он не попадает.
//
// ⛔ Тексты — по-английски.

import type { ReportModel, ReportRuleBlock, ReportSection } from './report.ts';

const ROOT = 'mxr-pdf-root';

/** ⛔ Всё, что приходит из ответа движка, проходит через это — включая цитаты. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * ⭐⭐⭐ Пиктограмма в PDF — НАСТОЯЩИЙ СИМВОЛ из базы, если он пришёл в модели,
 * иначе прежний ромб с кодом. Лист, который показывают инспектору, обязан нести
 * знак Annex V, а не наше изображение кода (решение Сергея, s84).
 *
 * ⚠⚠ Разметка символа НЕ ЭКРАНИРУЕТСЯ — это единственное место в файле, где так
 * можно, и вот почему: она приходит из `pictograms_signals`, куда её кладём мы,
 * а не из запроса. Всё, что пришло от браузера (имена компонентов, цитаты),
 * по-прежнему проходит через `esc()`.
 * ⚠ У части строк базы стоят СВОИ `width`/`height` (например `579pt`) — они
 * перебили бы размер в листе, поэтому режем их и задаём свои.
 */
function picto(p: { code: string; svg: string | null }): string {
  if (p.svg) {
    const sized = p.svg
      .replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
        const cleaned = attrs.replace(/\s(width|height)="[^"]*"/gi, '');
        return `<svg${cleaned} width="58" height="58">`;
      });
    return `<span class="pic" title="${esc(p.code)}">${sized}</span>`;
  }
  return `<svg class="pic" viewBox="0 0 100 100" width="58" height="58" role="img" aria-label="${esc(p.code)}">`
    + '<polygon points="50,3 97,50 50,97 3,50" fill="#ffffff" stroke="#b91c1c" stroke-width="7"/>'
    + `<text x="50" y="55" text-anchor="middle" font-family="monospace" font-size="17" font-weight="700" fill="#0f172a">${esc(p.code)}</text>`
    + '</svg>';
}

function kv(list: { label: string; value: string }[]): string {
  return `<table class="kv"><tbody>${list
    .map((x) => `<tr><td class="k">${esc(x.label)}</td><td>${esc(x.value)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function ruleHtml(r: ReportRuleBlock): string {
  const head = `<p class="rk">${esc(r.ruleKey)}${r.sourceRef ? ` · ${esc(r.sourceRef)}` : ''}${r.marker ? ` · ${esc(r.marker)}` : ''}</p>`;
  const quote = r.raw ? `<p class="q">${esc(r.raw)}</p>` : '';
  const agg = r.aggregate ? `<p class="ag">${esc(r.aggregate)}</p>` : '';
  const contrib = r.contributions.length
    ? `<table class="ct"><thead><tr><th>Ingredient</th><th>C</th><th>Value</th><th>Limit</th><th>Provenance</th></tr></thead><tbody>${r.contributions
        .map((c) => `<tr class="${c.counted ? '' : 'out'}"><td>${esc(c.name)}</td><td class="m">${esc(c.conc)}</td><td class="m">${esc(c.value)}</td><td class="m">${esc(c.limit)}</td><td>${esc(c.provenance)}</td></tr>`)
        .join('')}</tbody></table>`
    : '';
  const cands = r.candidates.length
    ? `<p class="cd"><b>Thresholds checked:</b> ${r.candidates.map((c) => esc(c.text)).join(' · ')}</p>`
    : '';
  const warns = r.warnings.map((w) => `<p class="wn ${w.level}"><b>${esc(w.code)}</b> ${esc(w.text)}</p>`).join('');
  return head + quote + agg + contrib + cands + warns;
}

/** Сжатые группы: класс назван, но карточки не занимает (s84). */
function compactHtml(s: ReportSection): string {
  return s.compact
    .map((g) => `<div class="cg"><p class="lb">${esc(g.label)}</p>`
      + `<p class="cl">${g.classNames.map(esc).join(' · ')}</p>`
      + `<p class="nt">${esc(g.note)}</p></div>`)
    .join('');
}

function sectionHtml(s: ReportSection): string {
  if (!s.lines.length && !s.compact.length) {
    return `<section><h2>${esc(s.title)}</h2><p class="lead">${esc(s.lead)}</p><p class="none">None — every class computed came back with another status. The rows below say which rule decided that.</p></section>`;
  }
  // ⚠ «not computed» печатается КОРОТКО и целиком: правила у этих строк нет по
  // определению, а причина есть, и она — весь смысл строки.
  if (s.key === 'not_computed') {
    return `<section><h2>${esc(s.title)}</h2><p class="lead">${esc(s.lead)}</p>`
      + (s.lines.length
        ? `<table class="nc"><tbody>${s.lines
          .map((l) => `<tr><td class="nm">${esc(l.className)}</td><td>${esc(l.reason ?? '')}</td><td class="m">module ${esc(l.module)}</td></tr>`)
          .join('')}</tbody></table>`
        : '')
      + compactHtml(s) + '</section>';
  }
  return `<section><h2>${esc(s.title)}</h2><p class="lead">${esc(s.lead)}</p>`
    + s.lines
      .map((l) => `<div class="cl"><div class="clh"><span class="nm">${esc(l.className)}</span>`
        + `<span class="tag ${l.status}">${esc(l.statusLabel)}</span>`
        + `${l.provisional ? '<span class="tag prov">Provisional</span>' : ''}`
        // ⚠ У «not classified» категории нет, и печатать вместо неё прочерк
        // ВНУТРИ СТРОКИ нельзя: «Not classified — module A4» читается как фраза
        // с тире, а не как пустая ячейка (замечено чтением отчёта, s84).
        + (l.category === '—' && l.hCode === '—' ? ''
          : `<span class="cat">${esc(l.category)}${l.hCode !== '—' ? ` · ${esc(l.hCode)}` : ''}</span>`)
        + `<span class="mod">module ${esc(l.module)}</span></div>`
        + `${l.reason ? `<p class="rs">${esc(l.reason)}</p>` : ''}`
        + ruleHtml(l.rule)
        + l.additional
          .map((a) => `<div class="add"><p class="ah">${esc(a.title)}</p>${ruleHtml(a.rule)}</div>`)
          .join('')
        + '</div>')
      .join('')
    + compactHtml(s)
    + '</section>';
}

/**
 * Готовый фрагмент для html2pdf. Возвращается ОДИН корневой элемент: остров
 * отдаёт html2pdf именно его, а не обёртку (иначе поля страницы считаются от
 * невидимого div-а).
 */
export function reportPdfHtml(m: ReportModel): string {
  const ing = m.composition.lines
    .map((c) => {
      const extra: string[] = [];
      if (c.classifications.length) extra.push(`<b>Annex VI:</b> ${c.classifications.map(esc).join('; ')}`);
      // ⚠ Каждый предел — СВОЕЙ строкой: внутри дословного SCL уже есть точка с
      // запятой («STOT SE 1; H370: C≥10 %»), и склейка через «; » превращала два
      // предела в одну кашу (замечено чтением отчёта, s84).
      if (c.scl.length) extra.push(`<b>SCL:</b><br>${c.scl.map(esc).join('<br>')}`);
      if (c.mFactors.length) extra.push(`<b>M-factors:</b><br>${c.mFactors.map(esc).join('<br>')}`);
      if (c.ate.length) extra.push(`<b>ATE:</b> ${c.ate.map(esc).join(' · ')}`);
      if (c.knownNonhazard) extra.push('<b>Declared:</b> data available, not classified for acute toxicity (3.1.3.6.1(b))');
      if (c.notes.length) extra.push(`<b>Annex VI notes (shown, not applied):</b> ${c.notes.map(esc).join('; ')}`);
      if (!extra.length) extra.push('No harmonised classification in Annex VI.');
      return `<tr><td><div class="nm">${esc(c.name)}</div><div class="id">${esc(c.identity)}</div></td>`
        + `<td class="m">${esc(c.entered)}</td><td class="m">${esc(c.used)}${c.worstCase ? '<div class="wc">worst case</div>' : ''}</td>`
        + `<td class="dt">${extra.join('<br>')}</td></tr>`;
    })
    .join('');

  const supp = m.supplemental.length
    ? `<section><h2>Supplemental label information</h2>${m.supplemental
        .map((s) => `<p class="sp"><b>${esc(s.code)}</b> ${esc(s.text)}${s.raw ? `<span class="q inline">${esc(s.raw)}</span>` : ''}${s.ruleKey ? `<span class="m"> · ${esc(s.ruleKey)}</span>` : ''}</p>`)
        .join('')}</section>`
    : '';

  const warn = m.warnings.length
    ? `<section><h2>Warnings on this calculation</h2>${m.warnings
        .map((w) => `<p class="wn ${w.level}"><b>${esc(w.code)}</b> ${esc(w.text)}</p>`)
        .join('')}</section>`
    : '';

  const stampNotes = m.stamp.notes.length
    ? m.stamp.notes.map((t) => `<p class="wn caution">${esc(t)}</p>`).join('')
    : '';

  return `<div class="${ROOT}">
    <style>
      .${ROOT}{font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:12px;line-height:1.5;color:#0f172a;background:#ffffff;width:760px;padding:30px}
      .${ROOT} *{box-sizing:border-box}
      .${ROOT} h1{font-size:20px;margin:0 0 2px}
      .${ROOT} .meta{color:#64748b;font-size:10.5px;margin:0 0 16px}
      .${ROOT} h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#475569;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin:20px 0 8px}
      .${ROOT} section{page-break-inside:auto}
      .${ROOT} .cl,.${ROOT} tr,.${ROOT} .vd{page-break-inside:avoid;break-inside:avoid}
      .${ROOT} .vd{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:4px}
      .${ROOT} .hl{font-size:15px;font-weight:800;margin:0 0 4px}
      .${ROOT} .as{margin:0;font-size:12px;color:#334155}
      .${ROOT} .sig{display:inline-block;margin-top:8px;padding:4px 14px;border-radius:14px;font-weight:800;font-size:12px}
      .${ROOT} .sig.Danger{background:#fee2e2;color:#991b1b}
      .${ROOT} .sig.Warning{background:#fef9c3;color:#854d0e}
      .${ROOT} .hc{display:inline-block;margin-left:10px;font-family:monospace;font-size:11px;color:#334155}
      .${ROOT} .pics{margin-top:8px}
      .${ROOT} .pic{display:inline-block;width:58px;height:58px;margin-right:8px;vertical-align:middle}
      .${ROOT} .pic svg{width:58px;height:58px;display:block}
      .${ROOT} .cg{margin-top:8px;border:1px solid #eef2f7;border-left:3px solid #cbd5e1;border-radius:8px;padding:8px 11px}
      .${ROOT} .cg .lb{margin:0;font-size:10.5px;font-weight:700;color:#475569}
      .${ROOT} .cg .cl{margin:4px 0 0;font-size:11px;color:#0f172a}
      .${ROOT} .cg .nt{margin:4px 0 0;font-size:10px;color:#64748b}
      .${ROOT} .bd{display:inline-block;margin:8px 6px 0 0;padding:3px 9px;border:1px solid #fcd34d;background:#fffbeb;color:#92400e;border-radius:9px;font-size:10px}
      .${ROOT} .lead{margin:0 0 8px;font-size:11px;color:#64748b}
      .${ROOT} table{width:100%;border-collapse:collapse;font-size:11px}
      .${ROOT} th{background:#f1f5f9;text-align:left;padding:5px 7px;border:1px solid #e2e8f0;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#475569}
      .${ROOT} td{padding:5px 7px;border:1px solid #eef2f7;vertical-align:top}
      .${ROOT} .kv{width:100%;margin-bottom:6px}
      .${ROOT} .kv .k{width:38%;color:#64748b}
      .${ROOT} .m{font-family:monospace;font-size:10px}
      .${ROOT} .nm{font-weight:700}
      .${ROOT} .id{font-family:monospace;font-size:9.5px;color:#64748b}
      .${ROOT} .dt{font-size:10px;color:#334155}
      .${ROOT} .wc{font-size:9px;color:#b45309}
      .${ROOT} .cl{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;margin-bottom:8px}
      .${ROOT} .clh{margin-bottom:6px}
      .${ROOT} .clh .nm{font-size:12.5px}
      .${ROOT} .tag{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:9px;font-size:9.5px;font-weight:700;border:1px solid #cbd5e1;color:#334155}
      .${ROOT} .tag.classified{background:#fee2e2;border-color:#fecdd3;color:#991b1b}
      .${ROOT} .tag.not_classified{background:#ecfdf5;border-color:#a7f3d0;color:#065f46}
      .${ROOT} .tag.insufficient_data,.${ROOT} .tag.prov{background:#fffbeb;border-color:#fcd34d;color:#92400e}
      .${ROOT} .cat,.${ROOT} .mod{display:inline-block;margin-left:8px;font-size:10px;color:#64748b}
      .${ROOT} .rs{margin:0 0 6px;font-size:11px;color:#334155}
      .${ROOT} .rk{margin:0 0 4px;font-family:monospace;font-size:10px;color:#1d4ed8}
      .${ROOT} .q{margin:0 0 6px;padding:6px 9px;border-left:3px solid #cbd5e1;background:#f8fafc;font-size:10.5px;color:#334155}
      .${ROOT} .q.inline{display:block;margin-top:4px}
      .${ROOT} .ag{margin:0 0 6px;font-family:monospace;font-size:10px;color:#0f172a}
      .${ROOT} .ct{margin:6px 0}
      .${ROOT} .ct tr.out td{color:#94a3b8;background:#f8fafc}
      .${ROOT} .cd{margin:4px 0 0;font-size:10px;color:#64748b}
      .${ROOT} .wn{margin:4px 0 0;font-size:10px;color:#475569}
      .${ROOT} .wn.caution{color:#b45309}
      .${ROOT} .wn.critical{color:#b91c1c}
      .${ROOT} .wn b{font-family:monospace;font-size:9px;letter-spacing:.05em}
      .${ROOT} .add{margin-top:8px;padding-top:8px;border-top:1px dashed #e2e8f0}
      .${ROOT} .ah{margin:0 0 4px;font-size:10.5px;font-weight:700;color:#334155}
      .${ROOT} .nc .nm{width:32%}
      .${ROOT} .none{font-size:11px;color:#64748b}
      .${ROOT} .sp{margin:0 0 8px;font-size:11px}
      .${ROOT} .fp{font-family:monospace;font-size:9.5px;color:#64748b}
      .${ROOT} .foot{margin-top:18px;border-top:1px solid #eef2f7;padding-top:9px;font-size:9.5px;color:#64748b}
      .${ROOT} .foot p{margin:0 0 6px}
    </style>
    <h1>${esc(m.title)}</h1>
    <p class="meta">${esc(m.computedAt)} · ${esc(m.source)}${m.shareUrl ? ` · ${esc(m.shareUrl)}` : ''}</p>

    <div class="vd">
      <p class="hl">${esc(m.verdict.headline)}</p>
      ${m.verdict.assigned.length ? `<p class="as">${m.verdict.assigned.map(esc).join(' · ')}</p>` : ''}
      ${m.verdict.signalWord ? `<span class="sig ${esc(m.verdict.signalWord)}">${esc(m.verdict.signalWord)}</span>` : ''}
      ${m.verdict.hCodes.length ? `<span class="hc">${m.verdict.hCodes.map(esc).join(' · ')}</span>` : ''}
      ${m.verdict.pictograms.length ? `<div class="pics">${m.verdict.pictograms.map(picto).join('')}</div>` : ''}
      ${m.verdict.badges.map((b) => `<span class="bd">${esc(b)}</span>`).join('')}
    </div>

    <section><h2>What was entered</h2>
      ${kv(m.composition.properties)}
      ${kv(m.composition.totals)}
      <table><thead><tr><th>Ingredient</th><th>Entered</th><th>Used</th><th>Harmonised data applied</th></tr></thead><tbody>${ing}</tbody></table>
    </section>

    ${m.sections.map(sectionHtml).join('')}
    ${supp}
    ${warn}

    <section><h2>Data release and engine</h2>${kv(m.stamp.lines)}${stampNotes}
      <p class="fp">Result fingerprint ${esc(m.fingerprint)} — the same composition on the same release reproduces it.</p>
    </section>

    <div class="foot">
      ${m.disclaimer.map((p) => `<p>${esc(p)}</p>`).join('')}
      <p>${esc(m.method)}</p>
    </div>
  </div>`;
}
