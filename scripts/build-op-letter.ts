// scripts/build-op-letter.ts
//
// Собирает обращение в Бюро публикаций и ECHA ИЗ ТОГО ЖЕ МОДУЛЯ, из которого
// страницы веществ печатают пометки.
//
//     node --experimental-strip-types scripts/build-op-letter.ts > letter-annex6-errata.md
//     (на машине: node --use-system-ca --import tsx scripts/build-op-letter.ts > …)
//
// ⚠⚠ ПОЧЕМУ НЕ НАПИСАТЬ ПИСЬМО РУКАМИ. Оно повторяет ровно то, что напечатано
// на тридцати живых страницах. Два текста об одном и том же неизбежно
// разойдутся — и разойдутся в худший момент: когда адресат сверит письмо с
// сайтом. Здесь у них один источник, разойтись негде.
//
// ⚠⚠ ЧЕГО ПИСЬМО НЕ ДЕЛАЕТ. Оно НЕ предлагает перевод там, где ячейка несёт имя
// другой записи. Мы вправе сказать «здесь напечатано имя записи Y, а EC и CAS
// той же строки называют Z» — сочинять официальное имя вещества на мальтийском
// или литовском не наше дело, это работа переводческой службы.
// ⭐ Там, где верное чтение языконезависимо — перевёрнутый порог концентрации,
// пропущенная буква, переставленный знак процента, — сказать его можно и нужно:
// ровно так составлен корриджендум 32018R0669R(01), который мы приводим как
// образец.
//
// ⚠ Полнота НЕ утверждается. Список — то, что мы сверили с ОЖ, и не более.

import {
  ERRATA_INDEX_NUMBERS,
  erratumFor,
  erratumLanguages,
  type Erratum,
} from '../src/lib/annex6Errata.ts'

const LANG_NAME: Record<string, string> = {
  BG: 'Bulgarian', CS: 'Czech', DA: 'Danish', DE: 'German', EL: 'Greek',
  ES: 'Spanish', ET: 'Estonian', FI: 'Finnish', FR: 'French', HR: 'Croatian',
  HU: 'Hungarian', IT: 'Italian', LT: 'Lithuanian', LV: 'Latvian',
  MT: 'Maltese', NL: 'Dutch', PL: 'Polish', PT: 'Portuguese', RO: 'Romanian',
  SK: 'Slovak', SL: 'Slovenian', SV: 'Swedish',
}

const ACT_NAME: Record<string, string> = {
  '32018R0669': 'Commission Regulation (EU) 2018/669 of 16 April 2018',
  '32020R1182': 'Commission Delegated Regulation (EU) 2020/1182 of 19 May 2020',
  '32022R0692': 'Commission Delegated Regulation (EU) 2022/692 of 16 February 2022',
}

type Item = { index: string; lang: string; e: Erratum }
const items: Item[] = []
for (const index of ERRATA_INDEX_NUMBERS) {
  for (const lang of erratumLanguages(index)) {
    items.push({ index, lang, e: erratumFor(index, lang)! })
  }
}

// ⚠ Группировка по АКТУ и ЯЗЫКОВОЙ РЕДАКЦИИ — не по нашему удобству, а по тому,
// как устроен corrigendum: он всегда исправляет один акт в одной редакции.
const groups = new Map<string, Item[]>()
for (const it of items) {
  const key = `${it.e.source.act} ${it.lang}`
  groups.set(key, [...(groups.get(key) ?? []), it])
}
const keys = [...groups.keys()].sort((a, b) => {
  const [aa, al] = a.split(' ')
  const [ba, bl] = b.split(' ')
  return aa === ba ? al.localeCompare(bl) : aa.localeCompare(ba)
})

const langs = new Set(items.map((i) => i.lang)).size
const L: string[] = []

L.push('# Errors in the language editions of Annex VI to Regulation (EC) No 1272/2008')
L.push('')
L.push('**To:** Publications Office of the European Union  ')
L.push('**Copy:** European Chemicals Agency (ECHA); European Commission, DG GROW  ')
L.push('**Subject:** Request for corrigenda — Table 3 of Annex VI Part 3 to the CLP Regulation')
L.push('')
L.push('---')
L.push('')
L.push('Dear Sir or Madam,')
L.push('')
L.push('We maintain a public reference site on GHS and CLP classification and labelling. While '
  + 'building a multilingual view of Table 3 of Annex VI Part 3 to Regulation (EC) No 1272/2008, '
  + `we identified **${items.length} entries across ${langs} language editions** in which the `
  + 'published text is contradicted by the rest of the same table row.')
L.push('')
L.push('We are writing because these entries are not editorial detail. Under Article 18(2) the '
  + 'name given in Annex VI is the name a supplier puts on the label and in the safety data '
  + 'sheet. Where the name cell of an entry carries the name of a different substance, a '
  + 'supplier following the Regulation in their own language labels a product with the wrong '
  + 'substance name.')
L.push('')
L.push('## How the entries were verified')
L.push('')
L.push('Each entry was checked against the amending act **as published in the Official Journal**, '
  + 'not against the consolidated text on EUR-Lex, and the page of the Official Journal is given '
  + 'for every one of them.')
L.push('')
L.push('The evidence for each entry is internal to the row, which is why no comparison with '
  + 'other language editions is required to see the problem:')
L.push('')
L.push('- for a wrong name, the EC and CAS numbers printed in the same row identify a different '
  + 'substance than the name;')
L.push('- for a wrong qualifier, both halves of a paired entry print the same concentration '
  + 'qualifier although their classifications differ. In entry 007-004-00-1 of the Bulgarian '
  + 'edition the contradiction is visible within the single row: the entry is marked '
  + '"[C ≤ 70 %]", while the specific concentration limits in the same row read '
  + '"Ox. Liq. 2; H272: C ≥ 99 %" and "Ox. Liq. 3; H272: 70 % ≤ C < 99 %".')
L.push('')
L.push('## Precedent')
L.push('')
L.push('A corrigendum of exactly this kind has already been issued for one of these acts. The '
  + 'Corrigendum to Commission Regulation (EU) 2018/669 (OJ L 233, 10.9.2019, p. 26) corrects '
  + 'the French edition at page 42, entry 015-011-00-6, column (2), replacing '
  + '"acide phosphonique à …" with "acide phosphorique à … %".')
L.push('')
L.push('The Polish edition of the same entry, on the same page of the same act, still prints '
  + '"kwas ortofosorowy" and appears in the list below.')
L.push('')
L.push('## What we are asking for')
L.push('')
L.push('We ask that the entries below be examined with a view to issuing corrigenda to the '
  + 'language editions concerned.')
L.push('')
L.push('Where the correct reading does not depend on the language — a transposed per cent sign, '
  + 'a missing letter, a concentration qualifier that belongs to the paired entry — we state it. '
  + 'Where the name cell carries the name of another entry, we deliberately do **not** propose '
  + 'wording: we report what is printed and what the row’s own identifiers say, and leave the '
  + 'correct designation to the translation services.')
L.push('')
L.push('This list is what we have verified against the Official Journal. We do not claim it is '
  + 'exhaustive.')
L.push('')
L.push('---')
L.push('')
L.push('## The entries')

for (const key of keys) {
  const [act, lang] = key.split(' ')
  const list = groups.get(key)!.sort((a, b) => a.e.source.page - b.e.source.page)
  L.push('')
  L.push(`### ${LANG_NAME[lang] ?? lang} edition — ${list.length} ${list.length === 1 ? 'entry' : 'entries'}`)
  L.push('')
  L.push(`${ACT_NAME[act] ?? act}, ${list[0].e.source.oj}:`)
  L.push('')
  for (const { index, e } of list) {
    L.push(`- **Page ${e.source.page}, entry ${index}, column (2).** ${e.note}`)
  }
}

L.push('')
L.push('---')
L.push('')
L.push('## Availability of the underlying material')
L.push('')
L.push('For every entry above we can supply the quoted cell as published, the EC and CAS numbers '
  + 'of the same row, the corresponding text of the English edition, and the page of the '
  + 'Official Journal, in machine-readable form.')
L.push('')
L.push('Each entry is also published on our site beside the name it concerns, with the same '
  + 'citation, so that a reader who consults the name can see the discrepancy and check it at '
  + 'source. The names themselves are reproduced exactly as published: we flag, we do not '
  + 'rewrite.')
L.push('')
L.push('We would be glad to answer any question and to provide the material in whatever form is '
  + 'most useful to you.')
L.push('')
L.push('Yours faithfully,')
L.push('')
L.push('')
L.push('_(name, position)_  ')
L.push('ghspictograms.com')
L.push('')
L.push('---')
L.push('')
L.push('_Sources: the acts named above and consolidated text CELEX 02008R1272, retrieved from '
  + 'EUR-Lex and the CELLAR repository. Reuse of EUR-Lex documents under Commission Decision '
  + '2011/833/EU._')

console.log(L.join('\n'))
