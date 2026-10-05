// src/lib/directoryLegal.ts — «Who is responsible for an SDS» на страницах каталога (№148, s92).
//
// ⭐⭐⭐ Каждая цитата ниже прочитана 05.10.2026 ГЛАЗАМИ в первоисточнике (встроенный браузер, не
// пересказчик): консолидированный REACH 11.05.2026 и CLP 01.05.2026 на EUR-Lex / CELLAR, eCFR
// «up to date as of 10/01/2026», Justice Laws Website. Пересказчик (WebFetch) режет цитаты и
// путает числа — поэтому юридический текст сюда попадает только дословно и только так.
//
// ⚠ Решение Сергея (s92): юридическая ответственность — один из главных вопросов, когда SDS
// пишет кто-то другой. Блок говорит ТОЛЬКО то, что стоит в текстах: обязанность лежит на
// поставщике химиката. Ни один из этих текстов не называет того, кто готовит документ по заказу.
// Это не юридическая консультация, и страница так и говорит.
//
// ⚠ Маркеры консолидации (►M3 ◄, ▼M37) из цитат убраны — они не часть нормы.

export interface LegalQuote {
  jurisdiction: 'EU' | 'US' | 'Canada'
  instrument: string
  provision: string
  quote: string
  url: string
  version: string
}

export const LEGAL_CHECKED = '2026-10-05'

export const LEGAL_QUOTES: LegalQuote[] = [
  {
    jurisdiction: 'EU',
    instrument: 'REACH, Regulation (EC) No 1907/2006',
    provision: 'Article 31(1)',
    quote:
      'The supplier of a substance or a mixture shall provide the recipient of the substance or mixture with a safety data sheet compiled in accordance with Annex II',
    url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02006R1907-20260511',
    version: 'consolidated text of 11 May 2026',
  },
  {
    jurisdiction: 'EU',
    instrument: 'REACH, Annex II',
    provision: 'point 0.2.3',
    quote:
      'The safety data sheet shall be prepared by a competent person who shall take into account the specific needs and knowledge of the user audience, as far as they are known. Suppliers of substances and mixtures shall ensure that such competent persons have received appropriate training, including refresher training.',
    url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02006R1907-20260511',
    version: 'consolidated text of 11 May 2026',
  },
  {
    jurisdiction: 'EU',
    instrument: 'CLP, Regulation (EC) No 1272/2008',
    provision: 'Article 4(1)',
    quote:
      'Manufacturers, importers and downstream users shall classify substances or mixtures in accordance with Title II before placing them on the market.',
    url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02008R1272-20260501',
    version: 'consolidated text of 1 May 2026',
  },
  {
    jurisdiction: 'US',
    instrument: 'OSHA Hazard Communication Standard, 29 CFR 1910.1200',
    provision: 'paragraph (g)(1)',
    quote:
      'Chemical manufacturers and importers shall obtain or develop a safety data sheet for each hazardous chemical they produce or import.',
    url: 'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-Z/section-1910.1200',
    version: 'eCFR, up to date as of 1 October 2026',
  },
  {
    jurisdiction: 'US',
    instrument: 'OSHA Hazard Communication Standard, 29 CFR 1910.1200',
    provision: 'paragraph (g)(5)',
    quote:
      'The chemical manufacturer, importer or employer preparing the safety data sheet shall ensure that the information provided accurately reflects the scientific evidence used in making the hazard classification.',
    url: 'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-Z/section-1910.1200',
    version: 'eCFR, up to date as of 1 October 2026',
  },
  {
    jurisdiction: 'Canada',
    instrument: 'Hazardous Products Act',
    provision: 'section 13(1)(a)',
    quote:
      'no supplier shall sell a hazardous product that is intended for use, handling or storage in a work place in Canada unless (a) the supplier has in their possession a safety data sheet for the hazardous product that meets the requirements set out in the regulations made under subsection 15(1)',
    url: 'https://laws-lois.justice.gc.ca/eng/acts/H-3/section-13.html',
    version: 'Justice Laws Website, consolidated Act',
  },
]

/** Абзац под цитатами. Только то, что из них следует, — и оговорка. */
export const LEGAL_SUMMARY =
  'In each of these texts the duty sits with the supplier of the chemical — the manufacturer, importer or downstream user who places it on the market. None of them names the software vendor or the consultant who prepares the document on the supplier’s behalf. That is why every card in this directory quotes what the vendor itself says it is, and is not, responsible for.'

export const LEGAL_DISCLAIMER = 'This is a reading of the cited texts, not legal advice.'
