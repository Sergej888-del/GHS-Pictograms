// src/lib/labelMakerHub.ts
// Содержание раздела /ghs-label-maker/ — хаб конструктора этикеток и его ветки.
//
// ⚠⚠ ПОЧЕМУ РАЗДЕЛ, А НЕ ОДНА СТРАНИЦА. Диагноз session 42: `/label-constructor/`
// не привлекал трафик, потому что для поиска был пуст — заголовок, абзац и
// React-остров. У конкурента (Tellus EHS) на той же странице разбор шести
// элементов этикетки, пять шагов, раздел про печать и FAQ. Инструмент один и тот
// же, а ранжируется страница, у которой есть что читать.
//
// ⚠⚠ КАЖДАЯ ВЕТКА НЕСЁТ САМ ИНСТРУМЕНТ, а не ссылку на него. Мы переезжаем сюда
// со старого адреса 301-м, и человек, который два года ходил строить этикетку,
// обязан попасть на страницу, где она строится, а не на статью о ней.
//
// ⚠ ФАКТЫ ЗДЕСЬ НЕ СОЧИНЯЮТСЯ. Всё, что похоже на норму, взято из
// claude/label-maker-regulatory-facts.md, где каждая строка проверена по
// первоисточнику, а непроверенное помечено. Три вещи, на которых легко соврать:
//   1. У OSHA и WHMIS числовых минимумов размера НЕТ ВООБЩЕ. Писать «minimum
//      label size for OSHA» — выдумывать норму за регулятора.
//   2. P-фразы лежат в Annex IV, а не в Annex III. В Annex III — H и EUH.
//   3. Параграфа 1910.1200(f)(13) не существует: малая тара целиком в (f)(12).
//
// ⚠ Тексты — на английском: сайт англоязычный. Комментарии по-русски, как везде.

import type { JurisdictionKey, LabelPurpose } from './jurisdictions';

export const HUB_BASE = '/ghs-label-maker/';
export const SITE = 'https://ghspictograms.com';

export type Faq = { q: string; a: string };

/** Блок прозы: подзаголовок, абзацы, список, ссылка на норму. */
export type Block = {
  h3?: string;
  p?: string[];
  list?: string[];
  /** Точная ссылка на параграф — печатается мелким моноширинным. */
  cite?: string;
  /** Врезка-предупреждение вместо обычного абзаца. */
  warn?: string;
};

export type Section = {
  eyebrow: string;
  h2: string;
  lead?: string;
  blocks: Block[];
};

export type Branch = {
  slug: string;
  jurisdiction: JurisdictionKey;
  purpose: LabelPurpose;
  /** Как ветка называется в карточке на хабе. */
  cardTitle: string;
  cardDesc: string;
  badge: string;
  /** Цвет карточки: акцент, рамка, заливка, текст значка. */
  acc: string;
  line: string;
  soft: string;
  ink: string;
  h1: string;
  title: string;
  description: string;
  heroEyebrow: string;
  heroSub: string;
  chips: string[];
  /** Живой инфоповод наверху страницы (срок, изменение правила). */
  alert?: { label: string; text: string };
  sections: Section[];
  faq: Faq[];
  sources: { label: string; url: string }[];
};

// ──────────────────────────────────────────────────────────────────────────────
// Пять шагов. Общие для хаба и для всех веток — инструмент везде один.
// ──────────────────────────────────────────────────────────────────────────────

export const STEPS: { n: string; h: string; p: string }[] = [
  {
    n: '01',
    h: 'Pick the substance, or set the classification yourself',
    p: 'Search 4,178 substances that carry a harmonised classification under CLP Annex VI — pictograms, signal word and hazard statements are filled in from the regulation itself. Labelling your own mixture instead? Switch to manual mode and set them from your safety data sheet: mixtures have no harmonised classification and never will.',
  },
  {
    n: '02',
    h: 'Choose the jurisdiction',
    p: 'OSHA HCS, EU CLP, WHMIS or GB CLP. The choice is not cosmetic: it changes which elements are mandatory, whether a minimum size exists at all, which languages the label must carry, and what may be dropped on a small container.',
  },
  {
    n: '03',
    h: 'Size the label to the container',
    p: 'Enter the container volume and the tool returns the size tier. Under EU and GB CLP that tier is law — Annex I, Table 1.3. Under OSHA and WHMIS no numeric minimum exists, so the same table is offered as guidance and labelled as guidance, never as a requirement.',
  },
  {
    n: '04',
    h: 'Pick a real label format',
    p: 'Presets are the sizes labels are actually sold in — 4 × 2 in, 4 × 6 in, A4, 210 × 148 mm — with the Avery, OnlineLabels and HERMA codes that share each geometry. Geometry is what is stored, not vendor part numbers, so a preset does not go stale when a catalogue is renumbered.',
  },
  {
    n: '05',
    h: 'Export vector PDF, SVG, or a full print sheet',
    p: 'Text in the PDF is native vector, not a screenshot — it stays sharp at any size and remains selectable. Pictograms are the official UN artwork. The sheet option lays the same label out N-up on Letter, Legal, A4 or A3 so a pack of blank labels goes through the printer in one pass.',
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Анатомия этикетки. ⚠ Состав элементов у юрисдикций разный — это НЕ универсальные
// «шесть элементов GHS», а состав OSHA (f)(1), который совпадает с CLP Art. 17.
// ──────────────────────────────────────────────────────────────────────────────

export const ANATOMY: { n: string; h: string; p: string; cite: string }[] = [
  {
    n: '1',
    h: 'Product identifier',
    p: 'The name or number that ties the container to its safety data sheet. The only element every jurisdiction requires on every label, including the 3 ml vial where everything else may be dropped.',
    cite: '29 CFR 1910.1200(f)(1)(i) · CLP Art. 18',
  },
  {
    n: '2',
    h: 'Signal word',
    p: '“Danger” or “Warning” — one or the other, never both on the same label. Where a Danger-level hazard is present, the Warning-level signal word for a lesser hazard is not shown.',
    cite: '29 CFR 1910.1200(f)(1)(ii) · CLP Art. 20',
  },
  {
    n: '3',
    h: 'Hazard statements',
    p: 'The H-phrases. Their wording is fixed by the regulation and is not paraphrased. ⚠ The OSHA and CLP sets are not identical — see the note below.',
    cite: '29 CFR 1910.1200 App. C · CLP Annex III',
  },
  {
    n: '4',
    h: 'Pictograms',
    p: 'A black symbol on a white field inside a red diamond set on its point. The red frame must be wide enough to be clearly visible; under CLP each pictogram must also cover at least one fifteenth of the minimum label area and never less than 1 cm².',
    cite: '29 CFR 1910.1200 App. C.2.3.1 · CLP Annex I §1.2.1',
  },
  {
    n: '5',
    h: 'Precautionary statements',
    p: 'The P-phrases: prevention, response, storage, disposal. Six is the customary practical maximum on a label, and picking which six is a judgement about how the product is actually used — not a rule.',
    cite: 'CLP Annex IV · 29 CFR 1910.1200 App. C.4',
  },
  {
    n: '6',
    h: 'Supplier identification',
    p: 'Name, address and telephone number of the responsible party. ⚠ Under the 2024 OSHA rule this must be a US address and a US telephone number; for the GB market it must be a GB address.',
    cite: '29 CFR 1910.1200(f)(1)(vi) · CLP Art. 17(1)(a)',
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Ветки раздела.
// ──────────────────────────────────────────────────────────────────────────────

export const BRANCHES: Branch[] = [
  // ── США ───────────────────────────────────────────────────────────────────
  {
    slug: 'osha',
    jurisdiction: 'osha',
    purpose: 'supplier',
    cardTitle: 'OSHA HazCom labels',
    cardDesc:
      'United States, 29 CFR 1910.1200. Six required elements, a US address and phone number, and the 20 November 2026 employer deadline.',
    badge: 'United States',
    acc: '#1d4ed8', line: '#bfdbfe', soft: '#eff6ff', ink: '#1d4ed8',
    h1: 'OSHA GHS label maker',
    title: 'OSHA GHS Label Maker — 29 CFR 1910.1200 HazCom Labels',
    description:
      'Free OSHA HazCom label maker for 29 CFR 1910.1200: the six required elements, a US supplier address, small-container relief and the 20 November 2026 deadline.',
    heroEyebrow: 'United States · 29 CFR 1910.1200',
    heroSub:
      'Build a shipped-container label that carries the six elements OSHA requires, on a label size that matches the pack of blank labels you already own. The 2024 revision aligned HazCom with GHS Revision 7 and changed what the supplier block must say.',
    chips: ['6 required elements', 'No size minimum exists', 'Deadline 20 Nov 2026', 'Avery GHS stock'],
    alert: {
      label: 'Next deadline',
      text:
        '20 November 2026 — employers must update workplace labelling and training for hazardous chemicals that are substances. The dates were extended in January 2026 (91 FR 1695): manufacturers had 19 May 2026 for substances; mixtures follow on 19 November 2027 for manufacturers and 19 May 2028 for employers.',
    },
    sections: [
      {
        eyebrow: '01 · What the label must carry',
        h2: 'The six elements of a shipped-container label',
        lead:
          'Paragraph (f)(1) lists them, and all six belong on the container that leaves your site. Nothing here is optional for a hazardous chemical being shipped.',
        blocks: [
          {
            list: [
              'Product identifier',
              'Signal word — “Danger” or “Warning”',
              'Hazard statement(s)',
              'Pictogram(s)',
              'Precautionary statement(s)',
              'Name, US address and US telephone number of the chemical manufacturer, importer or other responsible party',
            ],
            cite: '29 CFR 1910.1200(f)(1)',
          },
          {
            h3: 'Three of them must be grouped together',
            p: [
              'Signal word, hazard statements and pictograms are required to be “located together on the label”. A layout that puts the pictograms in one corner and the hazard statements in the opposite one satisfies the words and fails the intent — a reader should see one hazard block, not three scattered items.',
              'The label this tool draws boxes those three elements inside a single frame, so the grouping is visible rather than merely technically present. The same requirement exists in Canada (HPR s. 3.3) and in the EU (CLP Art. 32(1)).',
            ],
            cite: '29 CFR 1910.1200(f)(3)',
          },
        ],
      },
      {
        eyebrow: '02 · Size',
        h2: 'OSHA sets no minimum label size — and no minimum pictogram size',
        lead:
          'This surprises people, and a good deal of published advice gets it wrong. There is no number to comply with.',
        blocks: [
          {
            warn:
              'There is no inch, no millimetre and no point size anywhere in 29 CFR 1910.1200. The phrase “of sufficient size” that circulates on vendor sites comes from the UN GHS Purple Book, which is a recommendation, not the US standard.',
          },
          {
            p: [
              'The single dimensional requirement in the whole standard is qualitative: a pictogram is a square set at a point with a black hazard symbol on a white background and “a red frame sufficiently wide to be clearly visible”. OSHA’s letter of interpretation of 20 December 2012 confirms the test is functional — can it be read — rather than measured.',
              'So this tool will never tell you an OSHA label is “below the minimum”: saying so would be inventing a rule on the regulator’s behalf. What it does instead is check legibility, and offer the EU CLP size table as guidance clearly marked as guidance — because it is the only container-volume-to-label-size table that exists anywhere in law, and a person labelling a 200-litre drum still needs a starting point.',
            ],
            cite: '29 CFR 1910.1200 Appendix C, C.2.3.1',
          },
        ],
      },
      {
        eyebrow: '03 · Small containers',
        h2: 'What may be dropped below 100 ml and below 3 ml',
        lead:
          'Paragraph (f)(12) — and it is (f)(12) throughout. There is no (f)(13); the whole small-package regime lives in one paragraph.',
        blocks: [
          {
            h3: 'The gate comes first',
            p: [
              'None of the relief below applies until you can show that a pull-out label, a fold-back label or a tag bearing the full information is not feasible. Small is not by itself a qualification.',
            ],
            cite: '29 CFR 1910.1200(f)(12)(i)',
          },
          {
            h3: '100 ml or less',
            p: [
              'Hazard statements and precautionary statements may be omitted. Product identifier, pictograms, signal word and the manufacturer’s name and telephone number stay — and the label must state that the full label information appears on the immediate outer package.',
            ],
            cite: '29 CFR 1910.1200(f)(12)(ii)',
          },
          {
            h3: '3 ml or less',
            p: [
              'The product identifier alone, and only where any label would interfere with the normal use of the container. This is the vial-and-ampoule case.',
            ],
            cite: '29 CFR 1910.1200(f)(12)(iii)',
          },
          {
            h3: 'The outer package does the work',
            p: [
              'Whatever the inner container drops, the immediate outer package must carry the full (f)(1) label plus a statement that the small containers are stored inside it when not in use.',
            ],
            cite: '29 CFR 1910.1200(f)(12)(iv)',
          },
        ],
      },
      {
        eyebrow: '04 · Language',
        h2: 'English is required; other languages may be added',
        blocks: [
          {
            p: [
              'The label is “prominently displayed, and in English (other languages may also be included if appropriate)”. For workplace containers, (f)(10) allows a second language as long as the information is presented in English as well. No requirement exists about the relative size of the second language.',
              'A bilingual English–Spanish label is common on US sites and entirely compliant. The tool can print a second language beside the English one; the English text is never reduced or replaced.',
            ],
            cite: '29 CFR 1910.1200(f)(2), (f)(10)',
          },
        ],
      },
      {
        eyebrow: '05 · Statement texts',
        h2: 'OSHA hazard statements are not the CLP ones',
        blocks: [
          {
            warn:
              'The two sets differ in composition, not only in spelling. H320 “Causes eye irritation” exists in OSHA Appendix C and not in CLP; H316 exists in CLP and not in OSHA. OSHA writes “vapors”, CLP writes “vapours”. EUH statements are a CLP construct and have no place on a US label at all.',
          },
          {
            p: [
              'Aquatic hazard statements are another difference worth knowing: H400, H410 and H411 are mandatory label elements under CLP, while under HazCom the environmental hazard classes are non-mandatory.',
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: 'What is the minimum label size for OSHA?',
        a: 'There is none. 29 CFR 1910.1200 contains no numeric size requirement for the label or for the pictogram — only the requirement that the red pictogram frame be wide enough to be clearly visible, and the general requirement that the label be legible. Sources that quote a minimum are usually citing the UN GHS Purple Book or the EU CLP table, neither of which is the US standard.',
      },
      {
        q: 'Do I need a US address on the label?',
        a: 'Yes, for a shipped container. The 2024 revision of the standard requires the name, US address and US telephone number of the chemical manufacturer, importer or other responsible party. A foreign address alone is not sufficient.',
      },
      {
        q: 'What changes on 20 November 2026?',
        a: 'That is the date by which employers must update workplace labelling and worker training for hazardous chemicals that are substances. It was moved from 20 July 2026 by the January 2026 extension published at 91 FR 1695. Manufacturer compliance for substances was 19 May 2026; mixtures follow on 19 November 2027 (manufacturers) and 19 May 2028 (employers).',
      },
      {
        q: 'Do secondary containers need pictograms?',
        a: 'Not necessarily. Paragraph (f)(6) gives employers a choice: either the elements of (f)(1)(i) through (v), or the product identifier together with words, pictures, symbols or a combination of them that convey at least general information about the hazards. Words alone can satisfy the second option.',
      },
      {
        q: 'Does a container I fill and use myself need a label?',
        a: 'No. Paragraph (f)(8) exempts a portable container into which a hazardous chemical is transferred from a labelled container, where it is intended only for the immediate use of the employee who performs the transfer. Leave it on the bench overnight and the exemption is gone.',
      },
      {
        q: 'Which GHS revision does HazCom follow?',
        a: 'The 2024 final rule (89 FR 44144) aligned the standard with GHS Revision 7, with selected provisions drawn from Revision 8.',
      },
      {
        q: 'Can I print these labels on ordinary paper?',
        a: 'For a shipped container, no. Chemical labels need a material that survives the chemical itself, and for marine shipment BS 5609 certified stock. Avery UltraDuty and OnlineLabels chemical-resistant ranges are the usual laser-printable choices. Ordinary paper labels are reasonable for a secondary container that stays indoors on a shelf.',
      },
    ],
    sources: [
      { label: '29 CFR 1910.1200 on eCFR', url: 'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/section-1910.1200' },
      { label: 'Appendix C — allocation of label elements', url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1200AppC' },
      { label: '2024 final rule, 89 FR 44144', url: 'https://www.federalregister.gov/documents/2024/05/20/2024-08568/hazard-communication-standard' },
      { label: 'January 2026 date extension, 91 FR 1695', url: 'https://www.federalregister.gov/documents/2026/01/15/2026-00653/hazard-communication-standard' },
    ],
  },

  // ── Европейский союз ──────────────────────────────────────────────────────
  {
    slug: 'clp-eu',
    jurisdiction: 'clp',
    purpose: 'supplier',
    cardTitle: 'EU CLP labels',
    cardDesc:
      'Regulation (EC) No 1272/2008. The Annex I Table 1.3 size tiers, the UFI, EUH statements, and the language of the market you sell into.',
    badge: 'European Union',
    acc: '#0d9488', line: '#99f6e4', soft: '#f0fdfa', ink: '#0f766e',
    h1: 'EU CLP label maker',
    title: 'CLP Label Maker — EU Regulation 1272/2008 Label Generator',
    description:
      'Free CLP label generator for the EU market: Annex I Table 1.3 size tiers by container volume, the pictogram area rule, UFI and EUH statements, vector PDF.',
    heroEyebrow: 'European Union · Regulation (EC) No 1272/2008',
    heroSub:
      'CLP is the only regime in the world that puts actual numbers on a label: minimum dimensions by container volume, and a minimum share of the label area for each pictogram. Enter the volume and the tool applies both rules and shows which one is binding.',
    chips: ['Table 1.3 size tiers', 'Pictogram ≥ 1/15 of area', 'UFI supported', '24 official languages'],
    sections: [
      {
        eyebrow: '01 · Size',
        h2: 'Annex I, Table 1.3 — the only legally binding size table',
        lead:
          'Four tiers by container capacity. Both the label and the pictogram have a floor, and both must be met.',
        blocks: [
          {
            list: [
              '≤ 3 L — label at least 52 × 74 mm where possible; pictogram at least 10 × 10 mm, and 16 × 16 mm where possible',
              '> 3 L to ≤ 50 L — label at least 74 × 105 mm; pictogram at least 23 × 23 mm',
              '> 50 L to ≤ 500 L — label at least 105 × 148 mm; pictogram at least 32 × 32 mm',
              '> 500 L — label at least 148 × 210 mm; pictogram at least 46 × 46 mm',
            ],
            cite: 'CLP Annex I, Table 1.3',
          },
          {
            h3: 'A second rule sits on top of the table',
            p: [
              'Annex I §1.2.1 requires each pictogram to cover at least one fifteenth of the minimum label area, and in no case less than 1 cm². This is a separate constraint, not a restatement of the table: on an unusually wide, short label the table can be satisfied while the area rule is not.',
              'The tool checks both and tells you which one is doing the work — a distinction that matters when you are arguing with a printer about why the diamond cannot be shrunk.',
            ],
            cite: 'CLP Annex I §1.2.1',
          },
        ],
      },
      {
        eyebrow: '02 · Language',
        h2: 'The language of the country you place the product on the market in',
        blocks: [
          {
            p: [
              'Article 17(2) requires the label to be in the official language or languages of the Member State where the substance or mixture is placed on the market, unless that Member State provides otherwise. More than one language is permitted, provided the same information appears in all of them.',
              'In practice this is what drives multilingual labels across Europe: a product sold in Belgium needs Dutch and French; in Finland, Finnish and Swedish. The hazard and precautionary statements are not translated freely — the official wording for all 24 EU languages is fixed in Annex III (hazard statements and EUH statements) and Annex IV (precautionary statements).',
            ],
            cite: 'CLP Art. 17(2)',
          },
        ],
      },
      {
        eyebrow: '03 · What else the label carries',
        h2: 'UFI, EUH statements and supplemental information',
        blocks: [
          {
            h3: 'UFI',
            p: [
              'The Unique Formula Identifier is required on the label of a mixture classified for health or physical hazards, under Annex VIII. It is a 16-character code generated from your VAT number and a formulation number and submitted with the poison centre notification.',
            ],
            cite: 'CLP Annex VIII',
          },
          {
            h3: 'EUH statements',
            p: [
              'EUH phrases are a European addition with no counterpart in the UN system and no counterpart in OSHA HazCom. EUH208 (“Contains … May produce an allergic reaction”) and EUH210 (“Safety data sheet available on request”) are the ones most often missed, because they attach to mixtures that are otherwise not classified at all.',
            ],
            cite: 'CLP Annex II',
          },
          {
            h3: 'Grouping',
            p: [
              'Article 32(1) requires the hazard pictograms, signal word, hazard statements and precautionary statements to be located together on the label. The layout this tool produces frames them as one block.',
            ],
            cite: 'CLP Art. 32(1)',
          },
        ],
      },
      {
        eyebrow: '04 · What is changing',
        h2: 'Regulation (EU) 2024/2865 adds formatting rules',
        blocks: [
          {
            p: [
              'The 2024 amendment introduces something CLP never had: minimum font sizes, minimum line spacing and character spacing, explicit rules for fold-out labels, and a framework for digital labelling through new Articles 34a and 34b. Application dates were subsequently adjusted by Regulation (EU) 2025/2439.',
            ],
          },
          {
            warn:
              'The application dates for these provisions are the one thing on this page we have not been able to verify to our own standard — EUR-Lex returned errors on the annexes during our last check. Read Article 2 of Regulation (EU) 2024/2865 as amended by 2025/2439 before you plan a label change around a date.',
          },
          {
            p: [
              'Great Britain has not adopted the 2024 amendment. A label built for both markets will diverge from here on; the GB branch of this tool covers what differs today.',
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: 'What size must a CLP label be?',
        a: 'It depends on the capacity of the package, not on the amount of text. Annex I Table 1.3 sets four tiers: 52 × 74 mm up to 3 litres, 74 × 105 mm above 3 and up to 50 litres, 105 × 148 mm above 50 and up to 500 litres, and 148 × 210 mm above 500 litres. Each tier also sets a minimum pictogram side.',
      },
      {
        q: 'How big must the pictogram be?',
        a: 'Two rules apply at once. The tier in Table 1.3 sets a minimum side — 10 mm (16 mm where possible) for packages up to 3 litres, rising to 46 mm above 500 litres. Separately, Annex I §1.2.1 requires each pictogram to cover at least one fifteenth of the minimum label area and never less than 1 cm². Whichever is larger governs.',
      },
      {
        q: 'Does a small package get relief under CLP?',
        a: 'CLP handles small packaging through Article 29 and Annex I §1.5, which allow label elements to be omitted where the package is such that it is impossible to meet the requirements — a different mechanism from the fixed volume thresholds used by OSHA and WHMIS. This tool does not currently apply the Article 29 derogations automatically; it sizes and lays out the full label and shows you when the content will not fit.',
      },
      {
        q: 'Do I need a UFI on the label?',
        a: 'On a mixture classified for health or physical hazards placed on the EU market, yes — Annex VIII. Substances do not carry a UFI. Great Britain revoked Annex VIII with effect from 1 January 2024, so a GB label does not need one; Northern Ireland follows EU CLP and does.',
      },
      {
        q: 'Which languages must appear on the label?',
        a: 'Those of the Member State where the product is placed on the market. Multiple languages are allowed if all carry the same information. The official wording of hazard statements is in CLP Annex III and of precautionary statements in Annex IV, in all 24 EU languages — they are not translated at your discretion.',
      },
      {
        q: 'Is EUH208 required if my mixture is not classified?',
        a: 'It can be. EUH208 applies to a mixture that is not classified as a skin sensitiser but contains a sensitising substance above the concentration in Annex II §2.8 — one of the more common reasons an otherwise unclassified product still needs a label element.',
      },
    ],
    sources: [
      { label: 'CLP (EC) 1272/2008 — consolidated text', url: 'https://eur-lex.europa.eu/eli/reg/2008/1272/' },
      { label: 'ECHA — labelling and packaging guidance', url: 'https://echa.europa.eu/regulations/clp/labelling' },
    ],
  },

  // ── Канада ────────────────────────────────────────────────────────────────
  {
    slug: 'whmis-canada',
    jurisdiction: 'whmis',
    purpose: 'supplier',
    cardTitle: 'WHMIS labels (Canada)',
    cardDesc:
      'Hazardous Products Regulations SOR/2015-17. English and French are both mandatory — a unilingual Canadian supplier label is not lawful.',
    badge: 'Canada',
    acc: '#dc2626', line: '#fecaca', soft: '#fef2f2', ink: '#b91c1c',
    h1: 'WHMIS label maker',
    title: 'WHMIS Label Maker — Canada Bilingual Supplier Labels (HPR)',
    description:
      'Free WHMIS label maker for Canada: bilingual English and French supplier labels under the Hazardous Products Regulations, small-container relief, workplace labels.',
    heroEyebrow: 'Canada · Hazardous Products Regulations SOR/2015-17',
    heroSub:
      'Canada is the jurisdiction where language is not a convenience feature. A supplier label must carry every information element in both English and French — either as one bilingual label or as two unilingual halves that together form one label.',
    chips: ['EN + FR mandatory', 'No size minimum exists', 'GHS Rev. 7', 'Initial supplier identifier'],
    alert: {
      label: 'Bilingual is a validity condition',
      text:
        'HPR s. 6.2 lives in Part 6, not in Part 3 with the rest of the label rules — which is exactly why it gets missed. It states that the information elements on a safety data sheet and on a label must be in both official languages of Canada.',
    },
    sections: [
      {
        eyebrow: '01 · What the label must carry',
        h2: 'The supplier label under s. 3(1)',
        blocks: [
          {
            list: [
              'Product identifier',
              'Initial supplier identifier',
              'Pictogram, signal word, hazard statement and precautionary statement determined under the GHS Annex 3 allocation',
              'Any element required by Schedule 5 for the classes concerned',
              'Where applicable, the statement about the proportion of ingredients of unknown acute toxicity',
            ],
            cite: 'HPR s. 3(1)',
          },
          {
            h3: 'Initial supplier identifier is not the same as “supplier”',
            p: [
              'It means the Canadian manufacturer or importer that first placed the product on the Canadian market — the party a downstream user can trace the classification back to. A distributor’s own name does not replace it.',
            ],
          },
        ],
      },
      {
        eyebrow: '02 · Language',
        h2: 'Both official languages, on one label or two halves of one label',
        blocks: [
          {
            p: [
              'Section 6.2 permits either “a single bilingual label” or “a group of information elements in two unilingual parts that constitute one bilingual label”. Both are lawful; the second is what you see on drums where the English block occupies the left half and the French block the right.',
              'This tool prints the second language beside the first, with both sets of hazard and precautionary statements in their official wording. The French texts come from the CLP annexes, which is where the authoritative French phrasing of the GHS statements is published.',
            ],
            cite: 'HPR s. 6.2',
          },
        ],
      },
      {
        eyebrow: '03 · Size',
        h2: 'No minimum size — and the regulation says so explicitly',
        blocks: [
          {
            p: [
              'Section 3.1 requires the pictogram to be an exact reproduction of the prescribed symbol “except with respect to size”. There is no table, no floor and no target. What the regulation does require is legibility (s. 3.4) and durability (s. 3.5) — the label must stay readable and stay attached under the conditions the product is used in.',
              'As in the OSHA branch, this tool will not report a Canadian label as undersized, because there is nothing to be undersized against. The EU tier table is offered as guidance, marked as guidance.',
            ],
            cite: 'HPR s. 3.1, s. 3.4, s. 3.5',
          },
          {
            h3: 'The hatched border is history',
            p: [
              'The diagonal hatched frame belonged to WHMIS 1988. The current regulation prescribes a black symbol on a white background inside a red diamond — with one exception: Biohazardous Infectious Materials uses a black symbol inside a black circle. Whether a voluntary hatched border is permitted is not addressed either way in the HPR.',
            ],
          },
        ],
      },
      {
        eyebrow: '04 · Small containers and workplace labels',
        h2: 'Relief below 100 ml, and what changes at 3 ml',
        blocks: [
          {
            h3: '100 ml or less',
            p: [
              'Hazard statements and precautionary statements may be omitted. Pictogram, signal word, both identifiers and — this is the part that catches people — bilingualism all remain.',
            ],
            cite: 'HPR s. 5.4(1)',
          },
          {
            h3: '3 ml or less',
            p: [
              'The requirement that the label be permanently attached is lifted: a removable or fold-back label is acceptable.',
            ],
            cite: 'HPR s. 5.4(2)',
          },
          {
            h3: 'Workplace labels are not HPR at all',
            p: [
              'They fall under occupational health and safety law, federally the Canada Occupational Health and Safety Regulations s. 10.41: product identifier, hazard information, and a statement that a safety data sheet is available in the workplace. Pictograms and verbatim H and P statements are not required. Note that the bilingual requirement of HPR s. 6.2 addresses supplier labels and safety data sheets — the COHSR workplace-label provision does not itself impose one.',
            ],
            cite: 'COHSR s. 10.41',
          },
        ],
      },
    ],
    faq: [
      {
        q: 'Does a WHMIS label have to be bilingual?',
        a: 'A supplier label, yes. HPR s. 6.2 requires the information elements on both the label and the safety data sheet to appear in both official languages of Canada. It may be one bilingual label, or two unilingual parts that together constitute one bilingual label. A unilingual English supplier label is not compliant.',
      },
      {
        q: 'What is the minimum WHMIS label size?',
        a: 'There is none. Section 3.1 expressly excludes size from the requirement that the pictogram be an exact reproduction of the prescribed symbol. The operative requirements are legibility (s. 3.4) and durability (s. 3.5).',
      },
      {
        q: 'Is the hatched WHMIS border still required?',
        a: 'No. The diagonal hatched frame was a WHMIS 1988 feature. Current WHMIS prescribes a black symbol on a white background within a red diamond, with Biohazardous Infectious Materials as the exception (black symbol, black circle). The HPR neither requires nor forbids a voluntary hatched border.',
      },
      {
        q: 'Which GHS revision does WHMIS follow?',
        a: 'GHS Revision 7 as the base (s. 1), with specific Revision 8 elements for the Chemicals Under Pressure class added by SOR/2022-272. That amendment’s transition period ran to roughly 15 December 2025, so the current regime applies in full.',
      },
      {
        q: 'Do workplace labels need to be bilingual in Canada?',
        a: 'The HPR bilingual requirement in s. 6.2 addresses supplier labels and safety data sheets. Workplace labels are governed by occupational health and safety legislation instead — federally COHSR s. 10.41, which does not itself impose a bilingual requirement. Provincial rules and, in Quebec, language legislation may apply, so check the jurisdiction the site sits in.',
      },
      {
        q: 'Can I use the same label in Canada and the United States?',
        a: 'Often yes, if it carries both languages and satisfies both supplier-identification rules — a US address and telephone number for HazCom, and a Canadian initial supplier identifier for the HPR. Watch the statement texts: the two systems do not use an identical set of hazard statements.',
      },
    ],
    sources: [
      { label: 'Hazardous Products Regulations SOR/2015-17', url: 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-2015-17/' },
      { label: 'HPR s. 6.2 — bilingual requirement', url: 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-2015-17/section-6.2.html' },
    ],
  },

  // ── Великобритания ────────────────────────────────────────────────────────
  {
    slug: 'gb-clp-uk',
    jurisdiction: 'gbclp',
    purpose: 'supplier',
    cardTitle: 'GB CLP labels (UK)',
    cardDesc:
      'Great Britain’s assimilated CLP. Same size table as the EU, English required, GB supplier address, and no UFI since Annex VIII was revoked.',
    badge: 'Great Britain',
    acc: '#7c3aed', line: '#ddd6fe', soft: '#f5f3ff', ink: '#6d28d9',
    h1: 'GB CLP label maker',
    title: 'GB CLP Label Maker — UK Chemical Label Generator',
    description:
      'Free GB CLP label maker for Great Britain: the CLP size tiers, the English-language rule, a GB supplier address, no UFI since Annex VIII was revoked, and NI.',
    heroEyebrow: 'Great Britain · assimilated Regulation (EC) No 1272/2008',
    heroSub:
      'GB CLP still reads almost exactly like EU CLP — the size table is word for word identical. The differences are in who your address must belong to, what you no longer need, and a gap that is going to widen.',
    chips: ['Same Table 1.3', 'English required', 'No UFI since 2024', 'NI follows EU CLP'],
    sections: [
      {
        eyebrow: '01 · What is the same',
        h2: 'The size table is identical to the EU one',
        blocks: [
          {
            p: [
              'We checked the GB text on legislation.gov.uk against the EU version: Annex I Table 1.3 is reproduced word for word, including the “where possible” qualification on the 16 × 16 mm pictogram for packages up to 3 litres. The label elements, the signal words and the grouping requirement in Article 32(1) also carry over unchanged.',
            ],
            cite: 'Assimilated CLP, Annex I, Table 1.3',
          },
        ],
      },
      {
        eyebrow: '02 · What is different',
        h2: 'Address, language and the UFI',
        blocks: [
          {
            h3: 'The supplier address must be in GB',
            p: [
              'There is no sentence saying so in as many words. It follows from Article 2: an importer and a distributor are defined as established within Great Britain, or in Northern Ireland for qualifying Northern Ireland goods. An EU supplier address on a product placed on the GB market does not discharge the obligation.',
            ],
            cite: 'GB CLP Art. 2',
          },
          {
            h3: 'English, expressly',
            p: [
              'Article 17(2) in the GB version reads: “The label shall be written in English.” Other languages may be added provided all of them carry the same information — the same permissive structure as the EU rule, but with English rather than the language of the market.',
            ],
            cite: 'GB CLP Art. 17(2)',
          },
          {
            h3: 'No UFI',
            p: [
              'Annex VIII was revoked in Great Britain with effect from 1 January 2024 under the Retained EU Law (Revocation and Reform) Act 2023. Notification to the National Poisons Information Service is voluntary. A GB label does not carry a UFI.',
            ],
          },
          {
            h3: 'Northern Ireland is not GB',
            p: [
              'Under the Windsor Framework, Northern Ireland continues to apply EU CLP — including the UFI and the EU language rules. A single label intended for the whole of the United Kingdom has to satisfy both regimes at once.',
            ],
          },
        ],
      },
      {
        eyebrow: '03 · Divergence',
        h2: 'The gap that is going to widen',
        blocks: [
          {
            p: [
              'The EU adopted Regulation (EU) 2024/2865, which for the first time puts minimum font sizes, line and character spacing, fold-out label rules and a digital labelling framework into CLP. Great Britain has not adopted it.',
              'From the point at which those provisions apply, a label that satisfies EU CLP will carry formatting constraints that GB CLP does not impose, and one artwork for both markets stops being straightforward. Anyone maintaining a dual-market label should plan for two artworks rather than one.',
            ],
          },
          {
            warn:
              'The application dates in Regulation (EU) 2024/2865 as amended by Regulation (EU) 2025/2439 are not verified to our standard — check Article 2 of the amending regulation directly before planning around them.',
          },
        ],
      },
    ],
    faq: [
      {
        q: 'Is GB CLP the same as EU CLP?',
        a: 'For labelling geometry, effectively yes — Annex I Table 1.3 is word-for-word identical, as are the label elements and the grouping rule. The differences are the English-language requirement in Article 17(2), the need for a GB supplier address, the revocation of Annex VIII (no UFI), and the fact that Great Britain has not adopted Regulation (EU) 2024/2865.',
      },
      {
        q: 'Do I need a UFI on a GB label?',
        a: 'No. Annex VIII was revoked in Great Britain with effect from 1 January 2024. Notification to the National Poisons Information Service is voluntary. Northern Ireland is different: it follows EU CLP and the UFI is required there.',
      },
      {
        q: 'Can I use my EU supplier address on a GB label?',
        a: 'Not on its own. Importer and distributor are defined in Article 2 as established in Great Britain (or Northern Ireland for qualifying Northern Ireland goods), so a GB-market label needs a GB address for the responsible party.',
      },
      {
        q: 'What about Northern Ireland?',
        a: 'Northern Ireland applies EU CLP under the Windsor Framework. Practically that means the EU language rules and the UFI apply there, so a UK-wide label has to satisfy both GB CLP and EU CLP simultaneously.',
      },
      {
        q: 'Does a GB label have to be in English only?',
        a: 'It has to be in English. Additional languages are allowed provided all of them carry the same information.',
      },
    ],
    sources: [
      { label: 'Assimilated CLP on legislation.gov.uk', url: 'https://www.legislation.gov.uk/eur/2008/1272/' },
      { label: 'HSE — classification and labelling', url: 'https://www.hse.gov.uk/chemical-classification/legal/clp-regulation.htm' },
    ],
  },

  // ── Вторичная тара ────────────────────────────────────────────────────────
  {
    slug: 'secondary-container',
    jurisdiction: 'osha',
    purpose: 'workplace',
    cardTitle: 'Secondary container labels',
    cardDesc:
      'The spray bottle, the beaker, the decanted jerrycan. Fewer elements than a shipped label — and one case that needs no label at all.',
    badge: 'Workplace',
    acc: '#f97316', line: '#fed7aa', soft: '#fff7ed', ink: '#ea580c',
    h1: 'Secondary container label maker',
    title: 'Secondary Container Label Maker — Workplace GHS Labels',
    description:
      'Free secondary container label maker: what OSHA 1910.1200(f)(6) actually requires, when pictograms may be left off, and the immediate-use exemption in (f)(8).',
    heroEyebrow: 'Workplace containers · 29 CFR 1910.1200(f)(6)',
    heroSub:
      'A secondary container is one you fill yourself from a labelled drum: the spray bottle, the wash bottle, the decanted pail. The rules are looser than for a shipped container, and most people over-comply because nobody ever told them what the standard actually says.',
    chips: ['Fewer required elements', 'Pictograms optional', 'Immediate-use exemption', 'Print 10 to a sheet'],
    sections: [
      {
        eyebrow: '01 · United States',
        h2: 'Paragraph (f)(6) gives you a choice of two',
        blocks: [
          {
            h3: 'Option one',
            p: [
              'The elements of (f)(1)(i) through (v) — product identifier, signal word, hazard statements, pictograms and precautionary statements. Note what is missing: (f)(1)(vi), the supplier name, address and telephone number, is not on the list. A workplace container does not need your own company address on it.',
            ],
            cite: '29 CFR 1910.1200(f)(6)(i)',
          },
          {
            h3: 'Option two',
            p: [
              'The product identifier together with “words, pictures, symbols, or combination thereof” that provide at least general information about the hazards, which in combination with the other information immediately available to employees under the hazard communication programme, provides the specific information about physical and health hazards.',
              'Read plainly: words alone can be enough. “Acetone — flammable, keep away from ignition sources” on a wash bottle, with the SDS accessible and training done, satisfies option two. Pictograms are not mandatory on a secondary container.',
            ],
            cite: '29 CFR 1910.1200(f)(6)(ii)',
          },
          {
            h3: 'And one container that needs nothing',
            p: [
              'Paragraph (f)(8) exempts a portable container into which a hazardous chemical is transferred from a labelled container, intended only for the immediate use of the employee who performs the transfer. “Immediate use” is the whole of it: the same shift, the same person, the container emptied or the contents returned. Set it down and walk away and you are back under (f)(6).',
            ],
            cite: '29 CFR 1910.1200(f)(8)',
          },
        ],
      },
      {
        eyebrow: '02 · Canada',
        h2: 'The workplace label is not a WHMIS supplier label',
        blocks: [
          {
            p: [
              'Workplace labels sit outside the Hazardous Products Regulations entirely — they belong to occupational health and safety law. Federally, COHSR s. 10.41 asks for three things: the product identifier, hazard information about the product, and a statement that a safety data sheet is available in the workplace.',
              'Pictograms and verbatim hazard and precautionary statements are not required. The bilingual obligation in HPR s. 6.2 is directed at supplier labels and safety data sheets; provincial OHS rules and, in Quebec, language legislation may impose their own requirements on workplace labels.',
            ],
            cite: 'COHSR s. 10.41',
          },
        ],
      },
      {
        eyebrow: '03 · Europe',
        h2: 'CLP does not reach the decanting bench',
        blocks: [
          {
            p: [
              'CLP governs placing a substance or mixture on the market. Transferring a product from a drum into a beaker inside your own plant is not placing it on the market, so CLP does not apply to that container. What applies is Directive 98/24/EC on chemical agents at work and the national occupational safety law implementing it, which requires that workers be able to identify the contents and the hazards.',
              'The practical result is much the same as in the US: identifier plus hazard information, with local rules deciding the detail.',
            ],
          },
        ],
      },
      {
        eyebrow: '04 · Practical',
        h2: 'Printing a batch of them',
        blocks: [
          {
            p: [
              'Secondary container labels are the case where the print sheet earns its keep: one artwork, ten to a Letter sheet on 4 × 2 in stock, or twelve on 2 × 2 in for small bottles. Ordinary paper labels are defensible here in a way they are not on a shipped drum — the container stays indoors, and the label is replaced when the bottle is refilled.',
              'Set the label purpose to “workplace” in the tool and the mandatory-element list changes to match: the supplier block drops out, and the compliance panel stops asking for an address you do not need.',
            ],
          },
        ],
      },
    ],
    faq: [
      {
        q: 'Do secondary containers need GHS pictograms?',
        a: 'Not under OSHA. Paragraph (f)(6) gives a choice, and the second option requires only the product identifier plus words, pictures, symbols or a combination that convey general hazard information. Words alone can satisfy it. Many employers use pictograms anyway for consistency with the shipped containers, which is reasonable but not required.',
      },
      {
        q: 'When does a container need no label at all?',
        a: 'When it is a portable container into which a hazardous chemical is transferred from a labelled container, and it is intended only for the immediate use of the employee who performs the transfer — 29 CFR 1910.1200(f)(8). If it is stored, shared with another worker, or kept past the shift, the exemption no longer applies.',
      },
      {
        q: 'Does a secondary container label need my company address?',
        a: 'No. The supplier identification element (f)(1)(vi) is not among the elements (f)(6)(i) carries over. It is required on shipped containers, not on containers used inside your own workplace.',
      },
      {
        q: 'Can I write the label by hand?',
        a: 'Nothing in the standard requires printing. The requirements are that the label be legible, in English, and prominently displayed. A printed label is easier to keep legible over time and easier to reproduce consistently, which is why most sites print them.',
      },
      {
        q: 'What about a pipe or a stationary process vessel?',
        a: 'Paragraph (f)(7) allows employers to substitute signs, placards, process sheets, batch tickets, operating procedures or other written materials for labels on stationary process containers, provided they identify the containers and convey the same information. Piping is not covered by the labelling requirements of the standard at all.',
      },
    ],
    sources: [
      { label: '29 CFR 1910.1200 on eCFR', url: 'https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/section-1910.1200' },
      { label: 'Canada Occupational Health and Safety Regulations', url: 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-86-304/' },
    ],
  },

  // ── Транспорт ─────────────────────────────────────────────────────────────
  {
    slug: 'transport',
    jurisdiction: 'clp',
    purpose: 'supplier',
    cardTitle: 'Transport vs GHS labels',
    cardDesc:
      'The diamond on the outer packaging is a different system with different artwork. When the two meet, one of them gives way.',
    badge: 'Transport',
    acc: '#0ea5e9', line: '#bae6fd', soft: '#f0f9ff', ink: '#0284c7',
    h1: 'GHS labels and transport labels',
    title: 'GHS Label vs Transport Label — When Each One Applies',
    description:
      'How a GHS supply label differs from an ADR or DOT transport label, when CLP Article 33 lets you drop a duplicated pictogram, and where to find UN number data.',
    heroEyebrow: 'Supply label · transport label',
    heroSub:
      'Two label systems, two sets of artwork, two legal bases. They look similar enough that people assume one replaces the other — and then ship a drum carrying the wrong diamond.',
    chips: ['Different artwork', 'CLP Art. 33', '2,347 UN numbers', 'Orange plate data'],
    sections: [
      {
        eyebrow: '01 · The difference',
        h2: 'Two systems that happen to both use diamonds',
        blocks: [
          {
            p: [
              'The GHS supply label tells the person who opens the container what the chemical does to them: hazard class, signal word, hazard statements, precautions. Its diamond is red-bordered, white-filled, with a black symbol.',
              'The transport label tells everyone handling the package in transit what it does in an accident: class, division, UN number, packing group. Its diamond is coloured by class — orange for explosives, red for flammable liquids, green for non-flammable gases — with the class number in the bottom corner. It comes from ADR in Europe and from 49 CFR in the United States, not from CLP or HazCom.',
              'They are not alternatives. A drum of acetone going to a customer needs both: the CLP or HazCom label because it is a chemical being supplied, and the class 3 transport label because it is being carried on a road.',
            ],
          },
        ],
      },
      {
        eyebrow: '02 · Where they overlap',
        h2: 'Article 33 — when one diamond can be dropped',
        blocks: [
          {
            p: [
              'CLP Article 33 deals with the case where a package carries both. Where an outer packaging carries a transport label for a given hazard, the CLP pictogram for the same hazard need not be shown on that outer packaging. Where the inner packaging is labelled under CLP and the outer packaging under transport rules, the CLP label on the inner packaging still has to be visible or the outer packaging has to carry it too.',
              'This is a relief from duplication, not permission to replace the supply label with a transport label. The hazard statements, signal word and precautionary statements are unaffected.',
            ],
            cite: 'CLP Art. 33',
          },
        ],
      },
      {
        eyebrow: '03 · Getting the transport data',
        h2: 'UN number, class and packing group',
        blocks: [
          {
            p: [
              'This site holds every UN number in Table A of ADR 2025 — 2,347 of them — with the proper shipping name, class and packing group. 389 have a full page carrying the United States entry from the 49 CFR 172.101 Hazardous Materials Table beside the ADR one, never merged into a single row, because the same number can carry a different packing group and entirely different special provisions in each system.',
              'Those pages also generate the orange plate, and list the CLP label elements of the substances that ship under the number — which is where the two systems meet on one screen.',
            ],
          },
        ],
      },
      {
        eyebrow: '04 · What this tool does not do',
        h2: 'It does not draw transport labels',
        blocks: [
          {
            warn:
              'The constructor on this page builds supply labels — CLP, HazCom, WHMIS, GB CLP. It does not produce ADR or DOT hazard labels, placards or orange plates. Use the UN number pages for the transport side.',
          },
        ],
      },
    ],
    faq: [
      {
        q: 'Is a GHS label the same as a transport label?',
        a: 'No. The GHS supply label comes from CLP, HazCom or WHMIS and describes the hazard to the person using the chemical. The transport label comes from ADR or 49 CFR and describes the hazard in transit. The artwork differs: GHS pictograms are red-bordered diamonds on white, transport labels are coloured by class and carry the class number.',
      },
      {
        q: 'Do I need both on a drum?',
        a: 'Usually yes. A hazardous chemical being shipped is both a supplied product and a dangerous good. CLP Article 33 removes the duplication only for the pictogram of the same hazard on the outer packaging, not for the rest of the supply label.',
      },
      {
        q: 'Which one goes on the outer box?',
        a: 'The transport label. Under CLP Article 33, if the outer packaging carries a transport label for a hazard, the CLP pictogram for that same hazard need not be repeated there. If the inner packaging carries the CLP label and it is not visible through the outer packaging, the outer packaging must carry it as well.',
      },
      {
        q: 'Where do I find the UN number for my substance?',
        a: 'Use the UN number reference on this site. It carries every entry in Table A of ADR 2025 with proper shipping name, class and packing group, and 389 of them have a full page that also shows the US 49 CFR 172.101 entry.',
      },
    ],
    sources: [
      { label: 'CLP (EC) 1272/2008 — consolidated text', url: 'https://eur-lex.europa.eu/eli/reg/2008/1272/' },
      { label: '49 CFR 172.101 Hazardous Materials Table', url: 'https://www.ecfr.gov/current/title-49/subtitle-B/chapter-I/subchapter-C/part-172/subpart-B/section-172.101' },
    ],
  },
];

export const BRANCH_BY_SLUG = new Map(BRANCHES.map((b) => [b.slug, b]));

/** Ветки-юрисдикции — они образуют первый ряд карточек на хабе. */
export const JURISDICTION_BRANCHES = BRANCHES.filter((b) => b.purpose === 'supplier' && b.slug !== 'transport');
/** Ветки по назначению этикетки. */
export const PURPOSE_BRANCHES = BRANCHES.filter((b) => b.purpose !== 'supplier' || b.slug === 'transport');

// ──────────────────────────────────────────────────────────────────────────────
// FAQ хаба. ⚠ Не повторяет вопросы веток: здесь то, что спрашивают ДО выбора
// юрисдикции, там — то, что спрашивают внутри неё.
// ──────────────────────────────────────────────────────────────────────────────

export const HUB_FAQ: Faq[] = [
  {
    q: 'Is this GHS label maker free?',
    a: 'Yes, entirely, with no account and no installation. The label is built in your browser; nothing you type is uploaded to build it. Export is vector PDF, SVG or a multi-up print sheet.',
  },
  {
    q: 'Which jurisdictions does it cover?',
    a: 'Four: OSHA HazCom (29 CFR 1910.1200) for the United States, EU CLP (Regulation (EC) No 1272/2008), WHMIS (Hazardous Products Regulations SOR/2015-17) for Canada, and GB CLP for Great Britain. The choice changes the mandatory elements, the size rules, the language requirements and the small-container relief.',
  },
  {
    q: 'Where does the classification data come from?',
    a: 'From CLP Annex VI — the harmonised classification and labelling list, 4,178 substances. That is the legally binding classification in the EU, and it is the same underlying GHS building blocks used elsewhere. For a mixture there is no harmonised classification and never will be: yours comes from your own safety data sheet, and manual mode is where you enter it.',
  },
  {
    q: 'Can I label my own mixture or formulated product?',
    a: 'Yes — switch to manual mode. You choose the pictograms, the signal word, and from the full lists of 108 hazard statements and 117 precautionary statements. Nothing is truncated: the earlier version of this tool showed only the first twelve P statements, which made it look as though the database held twelve.',
  },
  {
    q: 'What size should my label be?',
    a: 'It depends on the jurisdiction, and the honest answer is that only the EU and Great Britain set numbers. CLP Annex I Table 1.3 ties minimum label and pictogram dimensions to container capacity. OSHA and WHMIS set no numeric minimum at all — only legibility. The tool applies the real rule where one exists and offers the CLP table as guidance where none does, labelled as guidance.',
  },
  {
    q: 'Is the PDF print-ready?',
    a: 'Yes. Text is native vector, not a rasterised screenshot, so it stays sharp at any size and remains selectable and searchable. Pictograms are the official UN artwork, rasterised at 600 dpi. The SVG export carries width and height in millimetres, so it opens at the correct physical size in a design application.',
  },
  {
    q: 'Can I print several labels on one sheet?',
    a: 'Yes. Choose a sheet format — Letter, Legal, A4 or A3 — and the tool lays the same label out N-up at the pitch of the stock, so a pack of blank labels goes through the printer in a single pass.',
  },
  {
    q: 'What label stock should I buy?',
    a: 'For a shipped chemical container, a chemical-resistant film rather than paper — Avery UltraDuty or the OnlineLabels chemical-resistant range for laser printing, and BS 5609 certified stock if the package will travel by sea. For secondary containers that stay indoors, ordinary paper labels are acceptable. The tool’s presets store geometry rather than part numbers, so a single 4 × 2 in preset covers Avery 60505, 60525 and 5163, Presta 94207 and OnlineLabels OL3540 and OL125 at once.',
  },
  {
    q: 'Can I put my company logo on the label?',
    a: 'Yes. Upload it once and it is remembered in your browser for the next label, along with your supplier details. Neither is sent anywhere.',
  },
  {
    q: 'Does the tool guarantee compliance?',
    a: 'No, and no tool can. It applies the rules of the jurisdiction you select and shows you which requirement each element satisfies, with the citation. The supplier remains responsible for the classification and for the label. Only the official text of each regulation is authoritative.',
  },
];

/** JSON-LD FAQPage из любого списка вопросов. */
export function faqJsonLd(faq: Faq[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

/** JSON-LD хлебных крошек. */
export function breadcrumbJsonLd(trail: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: `${SITE}${t.path}`,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Перекрёстные ссылки на остальной сайт.
//
// ⚠ Требование Сергея к хабу: «ссылки на другие инструменты и хабы». Держим их
// ОДНИМ списком здесь, а не россыпью по разметке, — иначе на восьми страницах
// раздела они разъедутся, и половина адресов однажды протухнет незамеченной.
// ──────────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────────
// Шаблоны размеров — /ghs-label-maker/templates/<slug>/
//
// ⚠⚠ СТРАНИЦА НЕ У КАЖДОГО ФОРМАТА. В `labelStock.ts` двадцать пять геометрий;
// двадцать пять отдельных страниц были бы тонкими, а тонкие страницы платит весь
// домен, а не только они сами — то же решение принято на `/un/`, где из 2 347
// номеров собственный адрес получили 389. Здесь шесть: те, которые действительно
// ищут по имени.
//
// ⚠ Слаг — от размера, а не от `id` из labelStock и не от кода вендора. `us-4x2`
// человеку ничего не говорит, а «Avery 5163» устареет вместе с артикулом. Коды
// вендоров живут в тексте и в title, где их и ищут.
// ──────────────────────────────────────────────────────────────────────────────

export type LabelTemplate = {
  slug: string;
  /** `id` записи в LABEL_STOCK_ALL. */
  stockId: string;
  h1: string;
  title: string;
  description: string;
  /** Один-два абзаца о том, на что этот формат клеят и где он подводит. */
  intro: string[];
  faq: Faq[];
};

export const TEMPLATES: LabelTemplate[] = [
  {
    slug: '4x2-inch',
    stockId: 'us-4x2',
    h1: '4 × 2 inch GHS label template',
    title: '4 x 2 GHS Label Template — Avery 5163, 60505, OnlineLabels OL3540',
    description:
      'Free 4 × 2 inch GHS label template, 10 per Letter sheet — fits Avery 60505, 60525 and 5163, Presta 94207 and OnlineLabels OL3540. Build and print online.',
    intro: [
      'The most common chemical label size in the United States and the one most packs of blank GHS labels come in: ten to a Letter sheet, 101.6 × 50.8 mm. It suits jerrycans, one-gallon bottles, and above all secondary containers — the spray bottle and the wash bottle that get relabelled every time they are refilled.',
      'Where it runs out of room is a full supplier label with four pictograms and six precautionary statements. At that point the type has to shrink below comfortable reading size, and the answer is a larger format rather than a smaller font — try 5 × 3½ in or 4 × 4 in.',
    ],
    faq: [
      {
        q: 'Which Avery product is 4 × 2 inches?',
        a: 'Avery 60505 and 60525 in the UltraDuty chemical-resistant range, and Avery 5163 in the standard white shipping-label range. Avery prints the size as “2 x 4” because it lists height before width. Presta 94207 and OnlineLabels OL3540 and OL125 share the same geometry.',
      },
      {
        q: 'How many 4 × 2 labels fit on a sheet?',
        a: 'Ten, in two columns of five, on a US Letter sheet. The tool lays the label out at that pitch automatically when you choose the sheet export.',
      },
      {
        q: 'Is 4 × 2 in big enough for a CLP label?',
        a: 'For a package up to 3 litres, yes on area: CLP Annex I Table 1.3 asks for at least 52 × 74 mm, and 101.6 × 50.8 mm is larger in area though shorter on one side. Above 3 litres the tier requires at least 74 × 105 mm and this format no longer qualifies.',
      },
    ],
  },
  {
    slug: '4x6-inch',
    stockId: 'us-4x6',
    h1: '4 × 6 inch GHS label template',
    title: '4 x 6 GHS Label Template — Drum & IBC Labels, Thermal Roll',
    description:
      'Free 4 × 6 inch GHS drum label template — the thermal-transfer standard for 55-gallon drums and IBCs. Build it online and export print-ready vector PDF.',
    intro: [
      'The default size for drums and IBCs, and the standard face size for thermal-transfer roll printers — 101.6 × 152.4 mm. If a site prints its own chemical labels on a Zebra or similar, this is almost certainly the roll it is loaded with.',
      'It is also the smallest format that comfortably holds a full CLP supplier label with four pictograms, six precautionary statements and a bilingual second column. Above 500 litres CLP requires at least 148 × 210 mm, so an IBC crosses out of this size.',
    ],
    faq: [
      {
        q: 'Is 4 × 6 a standard drum label size?',
        a: 'Yes. It is the usual face size for 55-gallon drum labels and the standard thermal-transfer roll width, sold both as rolls and as sheets. On a Legal sheet it comes four to a page.',
      },
      {
        q: 'Does 4 × 6 satisfy CLP for a 200-litre drum?',
        a: 'Yes. A 200-litre drum falls in the 50–500 litre tier, which requires a label of at least 105 × 148 mm; 4 × 6 in is 101.6 × 152.4 mm, which exceeds that tier on area and on the long side. Check the pictogram side too — that tier requires 32 mm.',
      },
    ],
  },
  {
    slug: '4x4-inch',
    stockId: 'us-4x4',
    h1: '4 × 4 inch GHS label template',
    title: '4 x 4 GHS Label Template — Avery 60504 Drum Labels',
    description:
      'Free 4 × 4 inch square GHS label template, 4 per Letter sheet, matching Avery 60504 and 60524 and OnlineLabels OL3539. Build and export a print-ready vector PDF.',
    intro: [
      'A square 101.6 × 101.6 mm label, four to a Letter sheet. Avery sells it in the UltraDuty range specifically for 55-gallon drums, where the square shape wraps the curve better than a long rectangle.',
      'The square proportion changes how the label is laid out: the tool measures both a pictogram rail down the side and a stacked arrangement and keeps whichever comes out shorter, because the shorter layout leaves more height for type. On a square that is usually the stack.',
    ],
    faq: [
      {
        q: 'Which Avery product is 4 × 4 inches?',
        a: 'Avery 60504 (laser, UltraDuty chemical-resistant) and Avery 60524 (inkjet), plus OnlineLabels OL3539. Four to a US Letter sheet.',
      },
      {
        q: 'Why does a square label lay out differently?',
        a: 'Because the layout is chosen by measuring, not by a proportion rule. Both arrangements are built and the shorter one wins, since a shorter layout leaves more height for the text. On a wide label that is usually a pictogram rail down the left; on a square it is usually a stack.',
      },
    ],
  },
  {
    slug: 'letter-full-sheet',
    stockId: 'us-8.5x11',
    h1: 'Full-sheet GHS label template (8½ × 11 in)',
    title: 'Full Sheet GHS Label Template — Avery 60501 8.5 x 11',
    description:
      'Free full-sheet 8½ × 11 inch GHS label template matching Avery 60501, 60507 and 60521 and OnlineLabels OL3536 — for drums, totes and pails. Print-ready vector PDF.',
    intro: [
      'One label per Letter sheet, 215.9 × 279.4 mm. Used on drums, totes and pails where the label has to carry a full supplier block, a long precautionary list and often a second language as well.',
      'A full sheet is also the size where a naive layout goes wrong most visibly. On this format the tool caps the pictogram against the type size rather than against the label width — otherwise a 66 mm diamond ends up next to 4 mm text with the content left as a strip down the middle.',
    ],
    faq: [
      {
        q: 'Which Avery product is a full 8½ × 11 sheet?',
        a: 'Avery 60501 and 60507 in the UltraDuty laser range, Avery 60521 for inkjet, and OnlineLabels OL3536. All are one label per Letter sheet.',
      },
      {
        q: 'Is a full sheet needed for an IBC?',
        a: 'Under CLP, a container above 500 litres requires a label of at least 148 × 210 mm and a pictogram of at least 46 mm. A full Letter sheet exceeds both. OSHA and WHMIS set no numeric minimum, so the answer there is whatever remains legible at the distance the label is read from.',
      },
    ],
  },
  {
    slug: '2x2-inch',
    stockId: 'us-2x2',
    h1: '2 × 2 inch GHS label template',
    title: '2 x 2 GHS Label Template — Avery 60506 Small Container Labels',
    description:
      'Free 2 × 2 inch GHS label template, 12 per Letter sheet, matching Avery 60506 and 60526 and OnlineLabels OL3541 — for small bottles and lab containers.',
    intro: [
      'A 50.8 × 50.8 mm square, twelve to a Letter sheet. This is the small-container size: lab bottles, sample jars, and secondary containers on a bench where a 4 × 2 in label would wrap past the curve.',
      'At this size a full supplier label stops fitting, and that is often the correct answer rather than a problem. Both OSHA and WHMIS allow hazard and precautionary statements to be dropped below 100 ml, provided the conditions are met — the OSHA branch and the WHMIS branch of this section set out exactly what stays.',
    ],
    faq: [
      {
        q: 'Which Avery product is 2 × 2 inches?',
        a: 'Avery 60506 (laser, UltraDuty) and 60526 (inkjet), plus OnlineLabels OL3541. Twelve to a US Letter sheet.',
      },
      {
        q: 'What if the full label does not fit on a small bottle?',
        a: 'Check whether the small-container relief applies before shrinking the type. Under OSHA (f)(12)(ii) a container of 100 ml or less may omit hazard and precautionary statements — but only where a pull-out or fold-back label or a tag is not feasible, and the label must say the full information is on the outer package. WHMIS s. 5.4(1) is similar but keeps the bilingual requirement.',
      },
    ],
  },
  {
    slug: 'a5-210x148-mm',
    stockId: 'eu-210x148',
    h1: 'A5 landscape GHS label template (210 × 148 mm)',
    title: 'A5 GHS Label Template — 210 x 148 mm CLP Drum Labels',
    description:
      'Free A5 landscape 210 × 148 mm GHS label template, 2 per A4 sheet, matching HERMA 58102 — sized above the CLP Annex I tier for containers over 500 litres.',
    intro: [
      'Two to an A4 sheet, 210 × 148 mm. This is the European drum and IBC format, and HERMA sells it in a range built specifically for hazardous substances with BS 5609 certification for sea transport.',
      'It is the smallest common European format that satisfies the top CLP tier: above 500 litres Annex I Table 1.3 requires at least 148 × 210 mm, which is exactly this rectangle turned on its side, with a pictogram of at least 46 mm.',
    ],
    faq: [
      {
        q: 'What label size does CLP require for an IBC?',
        a: 'For a package above 500 litres, at least 148 × 210 mm with pictograms of at least 46 × 46 mm — CLP Annex I Table 1.3. A 210 × 148 mm A5 landscape label meets it exactly.',
      },
      {
        q: 'Is A5 label stock chemical-resistant?',
        a: 'It depends on the product, not the size. HERMA 58102 in the hazardous-substances range is a chemical-resistant film with BS 5609 certification; a plain A5 paper label is not suitable for a shipped chemical container.',
      },
    ],
  },
];

export const TEMPLATE_BY_SLUG = new Map(TEMPLATES.map((t) => [t.slug, t]));
/** Обратный указатель: по `id` формата — его страница, если она есть. */
export const TEMPLATE_BY_STOCK = new Map(TEMPLATES.map((t) => [t.stockId, t]));

/**
 * ВСЕ адреса раздела, какие есть. Один список на три надобности:
 *   — `check:dist` сверяет им ссылки в собранных страницах;
 *   — страница подбора отдаёт его острову, чтобы тот знал, куда можно вернуть
 *     человека, а куда нельзя;
 *   — `normalizeLabelMakerBase` им же отбивает подделанный `?from=`.
 *
 * ⚠⚠ ДО SESSION 60 ЭТОТ СПИСОК СОБИРАЛСЯ ВНУТРИ `check-dist.ts`. Пока он нужен
 * был одной проверке, это было терпимо; как только по нему стало решаться, куда
 * уводить человека, вторая рукописная редакция превратилась бы в дыру: ветку
 * добавили бы в `BRANCHES`, а в список — забыли, и возврат с неё молча уезжал
 * бы на корень. Тот же довод, что у `LM_PARAM` в `labelMakerLink.ts`.
 */
export const LABEL_MAKER_PATHS: readonly string[] = [
  HUB_BASE,
  ...BRANCHES.map((b) => `${HUB_BASE}${b.slug}/`),
  `${HUB_BASE}templates/`,
  ...TEMPLATES.map((t) => `${HUB_BASE}templates/${t.slug}/`),
  `${HUB_BASE}pick/`,
];

export type CrossLink = { href: string; title: string; desc: string; kind: 'tool' | 'hub' };

export const CROSS_LINKS: CrossLink[] = [
  {
    // ⭐⭐ Инструмент отбора P-фраз стоит ПЕРВЫМ среди tool-карточек: из всего
    // списка он единственный отвечает на вопрос, который возникает ВНУТРИ
    // конструктора и который конструктор раньше решал как `slice(0, 6)`.
    href: '/p-statements/selector/',
    title: 'Which P-statements do you need?',
    desc: 'Give it a classification and it selects the precautionary statements for the label — through Annex IV, ECHA’s importance scale and Article 28 — then shows the rule and the source behind every statement it keeps and every one it drops.',
    kind: 'tool',
  },
  {
    href: '/pictogram-selector/',
    title: 'GHS Pictogram Selector',
    desc: 'Pick hazard classes and categories and get the correct pictograms, signal word and hazard statements for UN GHS, EU CLP, GB CLP and OSHA — with the CLP Article 26 precedence rules applied and explained.',
    kind: 'tool',
  },
  {
    // ⭐⭐ Классификатор стоит ПЕРЕД ATE-калькулятором (s82): у человека с
    // рецептурой и без классификации первый вопрос — «во что попадает вся
    // смесь», а не «какова её острая токсичность». ATE остаётся отдельной
    // карточкой, потому что там один класс разобран глубже: каждая строка
    // Cᵢ/ATEᵢ, обе формы ингаляции рядом и свой PDF.
    href: '/tools/clp-mixture-classifier/',
    title: 'CLP Mixture Classifier',
    desc: 'You have a composition and no classification: this applies the concentration limits of Annex I to the whole mixture and returns the hazard classes for SDS Section 2, each line quoting the rule it rests on — and naming the classes it did not compute instead of leaving them blank. Start here.',
    kind: 'tool',
  },
  {
    href: '/tools/ate-mixture-calculator/',
    title: 'ATE Mixture Calculator',
    desc: 'One class in depth: acute toxicity by the additivity formula across oral, dermal and inhalation routes, the 10% unknown rule, every Cᵢ/ATEᵢ line shown, and the resulting category, H statement and pictogram. The same engine the classifier uses as its acute-toxicity module.',
    kind: 'tool',
  },
  {
    href: '/tools/chemical-storage-compatibility/',
    title: 'Storage Compatibility',
    desc: 'What must not be stored next to what — segregation verdicts by hazard class, with ADR transport data and predicted reaction gases.',
    kind: 'tool',
  },
  {
    href: '/un/',
    title: 'UN Number Reference',
    desc: 'Every UN number in Table A of ADR 2025 with proper shipping name, class and packing group; 389 with a full page carrying the US 49 CFR 172.101 entry beside the ADR one.',
    kind: 'tool',
  },
  {
    href: '/substances/',
    title: 'Substance database',
    desc: '4,178 substances with harmonised CLP Annex VI classification — the source the label maker fills itself from.',
    kind: 'hub',
  },
  {
    href: '/h-statements/',
    title: 'Hazard statements (H)',
    desc: 'All 108 H and EUH statements with their official wording, the hazard classes that trigger them, and the substances that carry them.',
    kind: 'hub',
  },
  {
    href: '/p-statements/',
    title: 'Precautionary statements (P)',
    desc: 'All 117 P statements by category — prevention, response, storage, disposal — with the conditions of use that decide which ones belong on your label, and a selector that works the choice out from a classification.',
    kind: 'hub',
  },
  {
    href: '/pictograms/',
    title: 'GHS pictograms',
    desc: 'The nine pictograms, what each one covers, the official SVG artwork, and a classification calculator on every one of them.',
    kind: 'hub',
  },
  {
    href: '/hazard-classes/',
    title: 'Hazard classes',
    desc: 'The physical, health and environmental classes and their categories — the layer above the statements, and where classification actually starts.',
    kind: 'hub',
  },
  {
    href: '/sds/',
    title: 'Safety data sheets',
    desc: 'Full 16-section reference sheets per substance, including section 2 (hazards identification) — the section a label is built from.',
    kind: 'hub',
  },
  {
    href: '/compliance/',
    title: 'Compliance guides',
    desc: 'CLP, REACH, OSHA HazCom, UN GHS and SDS management explained in long form, with the regulatory history behind each.',
    kind: 'hub',
  },
  {
    href: '/tools/',
    title: 'All free GHS tools',
    desc: 'Fourteen tools in one place: the calculators, the selector, the matrix and this label maker.',
    kind: 'hub',
  },
];
