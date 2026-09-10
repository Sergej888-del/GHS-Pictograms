/**
 * `/data/annex6-errata.json` — машиночитаемое досье находок в языковых
 * редакциях Annex VI, с состоянием каждой (session 87, press-kit №136).
 *
 * Строки — из `src/lib/annex6ErrataExport.ts` (тот же источник, что у страницы).
 *
 * Лицензия на компиляцию — CC BY 4.0; сами тексты Annex VI — документы ЕС.
 * ⛔ Заголовков кэша здесь нет намеренно — см. p-precedence.json.ts.
 */
import type { APIRoute } from 'astro'
import { ERRATA_COUNT, SUBMISSION, ACKNOWLEDGEMENT } from '../../lib/annex6Errata'
import { errataRows } from '../../lib/annex6ErrataExport'

export const prerender = true

export const GET: APIRoute = () => {
  const body = {
    title: 'Errors in the language editions of Annex VI to Regulation (EC) No 1272/2008 (CLP)',
    source: 'https://ghspictograms.com/compliance/clp-translation-errors/',
    publisher: 'GHS Pictograms (SIA Basis Assets, Riga)',
    contact: 'hello@ghspictograms.com',
    license: 'CC BY 4.0 for this compilation; the quoted texts are EU documents',
    method:
      'Column (2) of Annex VI Table 3 compared across all 23 language editions and against the EC and CAS numbers of the same row; every finding checked against the act as published in the Official Journal. The list is not claimed to be complete.',
    reported: { date: SUBMISSION.date, channel: SUBMISSION.channel },
    acknowledgement: ACKNOWLEDGEMENT,
    count: ERRATA_COUNT,
    findings: errataRows(),
  }
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
