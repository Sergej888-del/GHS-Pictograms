/**
 * Досье находок Annex VI в виде плоских строк — для `/data/annex6-errata.json`
 * и `/data/annex6-errata.csv` (session 87, press-kit №136).
 *
 * ⚠⚠ ИСТОЧНИК ТОТ ЖЕ, ЧТО У СТРАНИЦЫ: `src/data/errata-dossier.json` + модуль
 * `annex6Errata.ts`. Второго списка нет — файл, который скачает журналист или
 * исследователь, обязан совпадать с тем, что напечатано на
 * `/compliance/clp-translation-errors/`, дословно. Сверка на сборке та же, что
 * у страницы: свидетельство из досье ≠ свидетельству из модуля → сборка падает.
 */
import dossier from '../data/errata-dossier.json'
import { ERRATA_COUNT, erratumFor, erratumStatus } from './annex6Errata'

export type ErratumExport = {
  index_number: string
  language: string
  kind: string
  published_name: string
  english_name: string
  ec: string | null
  cas: string | null
  belongs_to_entry: string | null
  note: string
  act: string
  oj_page: number
  citation: string
  status: string
  status_date: string | null
}

export function errataRows(): ErratumExport[] {
  const rows = dossier.map((f) => {
    const e = erratumFor(f.index, f.lang)
    if (!e) throw new Error(`Досье знает ${f.index} · ${f.lang}, а annex6Errata — нет.`)
    if (e.note !== f.note) throw new Error(`Свидетельство разошлось у ${f.index} · ${f.lang}.`)
    const st = erratumStatus(f.index, f.lang)
    return {
      index_number: f.index,
      language: f.lang,
      kind: e.kind,
      published_name: f.publishedName,
      english_name: f.en,
      ec: f.ec || null,
      cas: f.cas || null,
      belongs_to_entry: f.pairIndex || null,
      note: f.note,
      act: f.act,
      oj_page: f.page,
      citation: f.citation,
      status: st.kind === 'corrected' ? 'corrected' : st.kind === 'submitted' ? 'reported' : 'not reported',
      status_date: st.kind === 'submitted' ? st.date : null,
    }
  })
  if (rows.length !== ERRATA_COUNT) throw new Error(`В досье ${rows.length} находок, в модуле ${ERRATA_COUNT}.`)
  return rows.sort((a, b) => a.index_number.localeCompare(b.index_number) || a.language.localeCompare(b.language))
}

