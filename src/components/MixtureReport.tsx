// src/components/MixtureReport.tsx — экранный отчёт классификатора (№118, s84).
//
// ⭐⭐⭐ ЭКРАН — ПЕРВАЯ ПРОЕКЦИЯ `ReportModel`, PDF — вторая (`reportHtml.ts`).
// Здесь нет ни одного решения о содержимом: что печатать, решает `report.ts`.
// Иначе экран и файл разошлись бы, и оба выглядели бы правильными.
//
// ⚠ ДИСКЛЕЙМЕР НА ЭКРАНЕ НЕ ПОВТОРЯЕТСЯ. Он уже стоит на странице ниже, вне
// ветки результата (s81), а PDF уезжает один — поэтому в файле он есть, а
// здесь нет. Текст при этом один и тот же, из модели: второй копии нет.
//
// ⛔⛔ Все строки — по-английски (урок s68).

import type { ReportModel, ReportRuleBlock, ReportSection } from '../lib/classifier/report'

/**
 * Ромб пиктограммы. ⭐ ОДНО ОПРЕДЕЛЕНИЕ НА ДВА МЕСТА: остров импортирует его
 * отсюда, а не держит свою копию (s84). Файлы пиктограмм лежат в базе, а здесь
 * нужен знак «какие символы поедут на этикетку», а не сама этикетка.
 */
export function Picto({ code }: { code: string }) {
  return (
    <svg className="mx-picto" viewBox="0 0 100 100" role="img" aria-label={code}>
      <polygon points="50,3 97,50 50,97 3,50" />
      <text x="50" y="53" textAnchor="middle" dominantBaseline="middle">{code}</text>
    </svg>
  )
}

function Rule({ rule }: { rule: ReportRuleBlock }) {
  const counted = rule.contributions.filter((c) => c.counted)
  const skipped = rule.contributions.filter((c) => !c.counted)
  return (
    <>
      <p className="mx-why-rule mono">
        <b>{rule.ruleKey}</b>
        {rule.sourceRef && <span> · {rule.sourceRef}</span>}
        {rule.marker && <span> · {rule.marker}</span>}
      </p>
      {rule.raw && <q className="mx-quote">{rule.raw}</q>}
      {rule.aggregate && <p className="mx-formula mono">{rule.aggregate}</p>}

      {rule.contributions.length > 0 && (
        <table className="mx-contrib">
          <thead>
            <tr><th>Ingredient</th><th>C %</th><th>Value</th><th>Limit</th><th>Provenance</th></tr>
          </thead>
          <tbody>
            {[...counted, ...skipped].map((c, i) => (
              <tr key={`${c.name}-${i}`} className={c.counted ? '' : 'out'}>
                <td>{c.name}</td>
                <td className="mono">{c.conc}</td>
                <td className="mono">{c.value}</td>
                <td className="mono">{c.limit}</td>
                <td>{c.provenance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rule.candidates.length > 0 && (
        <div className="mx-cands-checked">
          <p className="mx-lab">Thresholds checked</p>
          <ul>
            {rule.candidates.map((c, i) => <li key={i} className={c.passed ? 'pass' : 'fail'}>{c.text}</li>)}
          </ul>
        </div>
      )}

      {rule.warnings.map((w, i) => (
        <p key={i} className={`mx-warn ${w.level}`}><b className="mono">{w.code}</b> {w.text}</p>
      ))}
    </>
  )
}

function Section({ section }: { section: ReportSection }) {
  return (
    <section className="mx-rep-sec">
      <h3 className="mx-rep-h">{section.title}</h3>
      <p className="mx-rep-lead">{section.lead}</p>

      {!section.lines.length && (
        <p className="mx-note">
          None — every class computed came back with another status. The rows below say which rule decided that.
        </p>
      )}

      {/* ⚠ «not computed» — короткой таблицей: правила у этих строк нет по
          определению, а причина есть, и она весь их смысл. */}
      {section.key === 'not_computed' ? (
        <table className="mx-table quiet">
          <tbody>
            {section.lines.map((l) => (
              <tr key={l.classCode} className="mx-row not_computed">
                <td>
                  <p className="cls">{l.className}</p>
                  <p className="sub">{l.reason}</p>
                </td>
                <td className="mono">module {l.module}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        section.lines.map((l) => (
          <article key={l.classCode} className={`mx-rep-line ${l.status}`}>
            <p className="mx-rep-line-head">
              <b>{l.className}</b>
              <span className={`mx-st ${l.status}`}>{l.statusLabel}</span>
              {l.provisional && <span className="mx-st provisional">Provisional</span>}
              {/* ⚠ У «not classified» категории нет, и прочерк ВНУТРИ СТРОКИ
                  читался бы как тире во фразе, а не как пустая ячейка (s84). */}
              <span className="mx-rep-cat">
                {l.category === '—' && l.hCode === '—'
                  ? `module ${l.module}`
                  : `${l.category}${l.hCode !== '—' ? ` · ${l.hCode}` : ''} · module ${l.module}`}
              </span>
            </p>
            {l.reason && <p className="mx-why-reason">{l.reason}</p>}
            <Rule rule={l.rule} />
            {l.additional.map((a) => (
              <div className="mx-why-extra" key={a.title}>
                <p className="mx-lab">{a.title}</p>
                <Rule rule={a.rule} />
              </div>
            ))}
          </article>
        ))
      )}
    </section>
  )
}

export default function MixtureReport({ model }: { model: ReportModel }) {
  return (
    <div className="mx-rep">
      <div className="mx-rep-top">
        <p className="mx-rep-title">{model.title}</p>
        <p className="mx-rep-meta mono">{model.computedAt} · {model.source}</p>
      </div>

      {/*
        ⭐⭐⭐ ВЕРДИКТ — ПЕРВОЕ, ЧТО ЧИТАЮТ. Дефект s84, найденный Сергеем на
        проде: модель несла его целиком, PDF печатал, а этот файл начинался
        сразу с «What was entered» — то есть отчёт открывался эхом ввода, без
        сигнального слова и без пиктограмм. Сторож теперь сверяет ПОЛЯ МОДЕЛИ с
        текстом обоих отображений (`check:engine`, раздел 9): поле, которое
        никто не печатает, краснеет само.
      */}
      <section className="mx-rep-verdict">
        <div className="v">
          <p className="hl">{model.verdict.headline}</p>
          {model.verdict.assigned.length > 0 && (
            <p className="as">{model.verdict.assigned.join(' · ')}</p>
          )}
          {model.verdict.hCodes.length > 0 && (
            <p className="hc mono">{model.verdict.hCodes.join(' · ')}</p>
          )}
          <div className="bd">
            {model.verdict.badges.map((b) => <span key={b} className="mx-badge amber">{b}</span>)}
          </div>
        </div>
        {(model.verdict.signalWord || model.verdict.pictograms.length > 0) && (
          <div className="lbl">
            {model.verdict.signalWord && (
              <p className={`sig ${model.verdict.signalWord.toLowerCase()}`}>{model.verdict.signalWord}</p>
            )}
            <div className="pics">
              {model.verdict.pictograms.map((p) => <Picto key={p} code={p} />)}
            </div>
          </div>
        )}
      </section>

      <section className="mx-rep-sec">
        <h3 className="mx-rep-h">What was entered</h3>
        <p className="mx-rep-lead">
          The report starts with the input because every line below is a consequence of it — including the
          concentrations actually used, which differ from the ones entered wherever a range was given.
        </p>
        <div className="mx-rep-kv">
          {[...model.composition.properties, ...model.composition.totals].map((x) => (
            <p key={x.label}><span>{x.label}</span><b>{x.value}</b></p>
          ))}
        </div>
        <table className="mx-contrib">
          <thead>
            <tr><th>Ingredient</th><th>Entered</th><th>Used</th><th>Harmonised data applied</th></tr>
          </thead>
          <tbody>
            {model.composition.lines.map((c) => (
              <tr key={c.id}>
                <td>
                  <b>{c.name}</b>
                  <p className="sub mono">{c.identity}</p>
                </td>
                <td className="mono">{c.entered}</td>
                <td className="mono">
                  {c.used}
                  {c.worstCase && <p className="sub">worst case</p>}
                </td>
                <td>
                  {c.classifications.length
                    ? <p className="sub"><b>Annex VI:</b> {c.classifications.join('; ')}</p>
                    : <p className="sub">No harmonised classification in Annex VI.</p>}
                  {/* ⚠ Каждый предел своей строкой: внутри дословного SCL уже
                      есть «;», и склейка через «; » сливала два предела в один. */}
                  {c.scl.map((s, i) => (
                    <p className="sub" key={`scl${i}`}>{i === 0 ? <b>SCL: </b> : null}{s}</p>
                  ))}
                  {c.mFactors.map((m, i) => (
                    <p className="sub" key={`m${i}`}>{i === 0 ? <b>M-factors: </b> : null}{m}</p>
                  ))}
                  {c.ate.length > 0 && <p className="sub"><b>ATE:</b> {c.ate.join(' · ')}</p>}
                  {c.knownNonhazard && (
                    <p className="sub"><b>Declared:</b> data available, not classified for acute toxicity (3.1.3.6.1(b))</p>
                  )}
                  {c.notes.length > 0 && (
                    <p className="sub"><b>Annex VI notes (shown, not applied):</b> {c.notes.join('; ')}</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {model.sections.map((s) => <Section key={s.key} section={s} />)}

      {model.supplemental.length > 0 && (
        <section className="mx-rep-sec">
          <h3 className="mx-rep-h">Supplemental label information</h3>
          {model.supplemental.map((s, i) => (
            <div key={i} className="mx-supp">
              <p>
                {s.text}
                {s.raw && <q className="mx-quote">{s.raw}</q>}
              </p>
              <span className="tag mono">{s.code}</span>
            </div>
          ))}
        </section>
      )}

      {model.warnings.length > 0 && (
        <section className="mx-rep-sec">
          <h3 className="mx-rep-h">Warnings on this calculation</h3>
          {model.warnings.map((w, i) => (
            <p key={i} className={`mx-warn ${w.level}`}><b className="mono">{w.code}</b> {w.text}</p>
          ))}
        </section>
      )}

      <section className="mx-rep-sec">
        <h3 className="mx-rep-h">Data release and engine</h3>
        <div className="mx-rep-kv">
          {model.stamp.lines.map((x) => (
            <p key={x.label}><span>{x.label}</span><b className="mono">{x.value}</b></p>
          ))}
        </div>
        {/* ⚠⚠ Расхождение штампов печатается, а не выбирается молча (№110). */}
        {model.stamp.notes.map((t, i) => <p key={i} className="mx-warn caution">{t}</p>)}
        <p className="mx-rep-fp mono">
          Result fingerprint {model.fingerprint} — the same composition on the same release reproduces it.
        </p>
      </section>
    </div>
  )
}
