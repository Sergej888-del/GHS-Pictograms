/**
 * Протокол отбора P-фраз — показ результата `selectPStatements`.
 *
 * ⚠⚠ ОДИН КОМПОНЕНТ НА ДВА МЕСТА: отдельную страницу `/p-statements/selector/`
 * и панель «почему эти шесть» в конструкторе этикетки. Разводить два показа
 * одного результата нельзя — они разойдутся, и человек, сверяя страницу с
 * конструктором, увидит разные объяснения одного и того же отбора.
 *
 * ⚠⚠ ГЛАВНОЕ, ЧТО ЭТОТ КОМПОНЕНТ ОБЯЗАН ПОКАЗАТЬ, — ЭТО НЕ СПИСОК ФРАЗ.
 * Список даёт и `slice(0, 6)`. Здесь показывается ОСНОВАНИЕ каждой строки:
 * правило, ссылка на первоисточник и — там, где основание наше, а не
 * регламента, — прямая об этом оговорка. Инструмент, который выдаёт свой
 * выбор за требование закона, вреднее инструмента, который молчит.
 */
import { useState } from 'react'
import type { PrecedenceResult, PUnit, ProtocolLine, EchaLevel } from '../lib/pPrecedence'

/** Подпись уровня ECHA — словами методички, а не нашими. */
const LEVEL_LABEL: Record<EchaLevel, string> = {
  mandatory: 'Mandatory',
  highly_recommended: 'Highly recommended',
  recommended: 'Recommended',
  optional: 'Optional',
}

const LEVEL_CLASS: Record<EchaLevel, string> = {
  mandatory: 'border-rose-300 bg-rose-50 text-rose-800',
  highly_recommended: 'border-amber-300 bg-amber-50 text-amber-900',
  recommended: 'border-sky-300 bg-sky-50 text-sky-800',
  optional: 'border-slate-300 bg-slate-50 text-slate-600',
}

/**
 * Человеческая расшифровка машинного ключа правила.
 * ⚠ Заголовок группы, а не пересказ строки: сама строка приходит из движка со
 * ссылкой на первоисточник, и подменять её своими словами нельзя.
 */
const RULE_TITLE: Record<ProtocolLine['rule'], string> = {
  'matrix': 'Required by Annex IV',
  'consumer-only': 'General section — consumer products',
  'combo-absorbs': 'Absorbed into a combined statement',
  'no-echa-level': 'No ECHA level',
  'ungraded-here': 'Required by Annex IV, ungraded by ECHA for this class',
  'omit-if': 'Omitted under column 5',
  'duplicate': 'Required by more than one hazard',
  'ladder': 'Superseded by a more urgent statement',
  'sds-only': 'Safety data sheet, not the label',
  'anchor-disposal': 'Pinned to the top',
  'level': 'Ranking',
  'coverage': 'Hazard coverage',
  'limit': 'Did not fit the limit',
  'ambiguous-level': 'Level depends on a condition',
  'ambiguous-class': 'Hazard code reads as more than one class',
  'needs-companion': 'Needs a companion statement',
  'derogation': 'Small-package derogation',
}

/** Заголовки для отброшенных — по вердикту, а не по последнему правилу. */
const VERDICT_TITLE: Record<PUnit['verdict'], string> = {
  'selected': 'On the label',
  'dropped': 'Not on the label',
  'absorbed': 'Printed inside a combined statement',
  'omitted': 'Omitted under Annex IV column 5',
  'sds-only': 'Safety data sheet only',
}

function LevelBadge({ unit }: { unit: PUnit }) {
  if (!unit.level) {
    return (
      <span className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        no ECHA level
      </span>
    )
  }
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${LEVEL_CLASS[unit.level]}`}>
      {LEVEL_LABEL[unit.level]}
      {/* ⚠ Условный уровень ОБЯЗАН быть виден. `level` в этом случае — верхняя
          граница, и показать её без оговорки значит завысить важность фразы. */}
      {unit.levelConditional ? ' ·  conditional' : ''}
    </span>
  )
}

function Reasons({ lines }: { lines: ProtocolLine[] }) {
  return (
    <ul className="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
      {lines.map((r, i) => (
        <li key={i} className="text-[12px] leading-relaxed text-slate-600">
          <span className="mr-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {RULE_TITLE[r.rule] ?? r.rule}
          </span>
          {r.text}
          {r.citation && (
            <span className="mt-0.5 block text-[11px] italic text-slate-400">{r.citation}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function UnitRow({ unit, index, open, onToggle }: {
  unit: PUnit; index?: number; open: boolean; onToggle: () => void
}) {
  const on = unit.verdict === 'selected'
  return (
    <li className={`rounded-lg border px-3 py-2.5 ${on ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50/60'}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {typeof index === 'number' && (
          <span className="text-[11px] font-semibold text-slate-400">{index + 1}.</span>
        )}
        <code className={`font-mono text-sm font-semibold ${on ? 'text-[#062A78]' : 'text-slate-500'}`}>
          {unit.code}
        </code>
        <LevelBadge unit={unit} />
        <span className="text-[11px] uppercase tracking-wide text-slate-400">{unit.type}</span>
        {unit.hazards.length > 0 && (
          <span className="text-[11px] text-slate-400">
            covers {unit.hazards.length} hazard{unit.hazards.length === 1 ? '' : 's'}
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="ml-auto cursor-pointer rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:border-[#062A78] hover:text-[#062A78]"
          aria-expanded={open}
        >
          {open ? 'Hide reasoning' : 'Why'}
        </button>
      </div>

      {unit.text && <p className="mt-1 text-[13px] leading-relaxed text-slate-700">{unit.text}</p>}

      {/* ⚠⚠ УСЛОВИЯ КОЛОНКИ 5 И УСЛОВИЯ ECHA ПОКАЗЫВАЮТСЯ ПОРОЗНЬ И ПОДПИСАНЫ
          ПОРОЗНЬ. Первое — текст регламента и основание СНЯТЬ фразу, второе —
          методичка и основание ПОНИЗИТЬ уровень. Смешать их в одну кучу значит
          сослаться на регламент там, где говорит методичка. */}
      {unit.conditions.length > 0 && (
        <p className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-relaxed text-amber-900">
          <b>Annex IV, column 5 — conditions for use:</b> {unit.conditions.join(' · ')}
        </p>
      )}
      {unit.echaConditions.length > 0 && (
        <p className="mt-1.5 rounded border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] leading-relaxed text-sky-900">
          <b>ECHA guidance condition:</b> {unit.echaConditions.join(' · ')}
        </p>
      )}

      {open && <Reasons lines={unit.reasons} />}
    </li>
  )
}

export type PStatementProtocolProps = {
  result: PrecedenceResult
  /** Показать ли отброшенные. На панели конструктора — свёрнуто. */
  showDropped?: boolean
  /** Заголовок над выбранными; на странице свой, в конструкторе свой. */
  heading?: string
}

export default function PStatementProtocol({
  result, showDropped = true, heading = 'Selected for the label',
}: PStatementProtocolProps) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [droppedOpen, setDroppedOpen] = useState(false)
  const toggle = (code: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })

  const dropped = result.units.filter((u) => !result.selected.includes(u))
  const byVerdict = new Map<PUnit['verdict'], PUnit[]>()
  for (const u of dropped) {
    const list = byVerdict.get(u.verdict) ?? []
    list.push(u)
    byVerdict.set(u.verdict, list)
  }

  return (
    <div className="space-y-4">

      {/* ── Что за классификация разобрана ──────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Hazard classes read from the classification
        </p>
        <p className="mt-1 text-[13px] text-slate-700">
          {result.pairs.length
            ? result.pairs.map((p) => `${p.classCode} ${p.categoryCode}`.trim()).join(' · ')
            : 'none'}
        </p>
      </div>

      {/* ── Лимит: чем именно он задан ──────────────────────────────────── */}
      <p className="rounded-lg border border-[#062A78]/25 bg-blue-50 px-3 py-2 text-[12px] leading-relaxed text-[#062A78]">
        <b>Limit: {result.limit}.</b> {result.limitReason}
      </p>

      {/* ── ⚠⚠ ОГОВОРКИ ВЫШЕ СПИСКА, А НЕ ПОД НИМ. Это то, что движок о своём
             ответе не знает; прятать это под список — прятать сомнение под
             результат. ─────────────────────────────────────────────────── */}
      {result.notes.length > 0 && (
        <ul className="space-y-1.5">
          {result.notes.map((n, i) => (
            <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
              {n}
            </li>
          ))}
        </ul>
      )}

      {/* ── Выбранные ───────────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
          {heading} ({result.selected.length})
        </p>
        <ul className="space-y-2">
          {result.selected.map((u, i) => (
            <UnitRow key={u.code} unit={u} index={i} open={open.has(u.code)} onToggle={() => toggle(u.code)} />
          ))}
        </ul>
        {result.selected.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
            Nothing selected — the classification produced no precautionary statements.
          </p>
        )}
      </div>

      {/* ── Послабления по объёму тары ──────────────────────────────────── */}
      {result.derogations.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
            Small-package derogations that apply ({result.derogations.length})
          </p>
          <ul className="space-y-1.5">
            {result.derogations.map((d, i) => (
              <li key={i} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] leading-relaxed text-emerald-900">
                {d.text}
                <span className="mt-0.5 block text-[11px] italic text-emerald-700">{d.citation}</span>
                <span className="mt-0.5 block text-[11px] text-emerald-700">
                  Classes: {d.classes.map((c) => `${c.classCode} ${c.categoryCode}`.trim()).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Диф с чужим SDS ─────────────────────────────────────────────── */}
      {result.diff && (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            Against the codes you pasted
          </p>
          <dl className="mt-1.5 space-y-1 text-[12px]">
            <div><dt className="inline font-medium text-slate-500">Both agree: </dt>
              <dd className="inline font-mono text-slate-700">{result.diff.both.join(', ') || '—'}</dd></div>
            <div><dt className="inline font-medium text-slate-500">Only ours: </dt>
              <dd className="inline font-mono text-emerald-700">{result.diff.onlyOurs.join(', ') || '—'}</dd></div>
            <div><dt className="inline font-medium text-slate-500">Only yours: </dt>
              <dd className="inline font-mono text-rose-700">{result.diff.onlyTheirs.join(', ') || '—'}</dd></div>
          </dl>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
            A difference is not an error on either side. CLP sets no selection procedure, so two
            defensible methods can land on different sets — that is exactly why every line here
            carries its reason.
          </p>
        </div>
      )}

      {/* ── Отброшенные ─────────────────────────────────────────────────── */}
      {showDropped && dropped.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setDroppedOpen((v) => !v)}
            className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 hover:border-[#062A78]"
            aria-expanded={droppedOpen}
          >
            <span>Not on the label ({dropped.length}) — and why</span>
            <span className="text-slate-400">{droppedOpen ? '−' : '+'}</span>
          </button>
          {droppedOpen && (
            <div className="mt-2 space-y-4">
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
                These statements are not discarded. ECHA’s instruction is to carry them into the
                relevant headings of the safety data sheet — the label is the short form, the SDS
                is the full one.
              </p>
              {[...byVerdict.entries()].map(([verdict, list]) => (
                <div key={verdict}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {VERDICT_TITLE[verdict] ?? verdict} ({list.length})
                  </p>
                  <ul className="space-y-2">
                    {list.map((u) => (
                      <UnitRow key={u.code} unit={u} open={open.has(u.code)} onToggle={() => toggle(u.code)} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
