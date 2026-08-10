// src/lib/complianceHub.ts
// Столпы раздела /compliance/ в одном месте: как называется, что означает,
// каким цветом обозначен.
//
// ⚠⚠ ЗАЧЕМ ФАЙЛ ПОЯВИЛСЯ. До session 60 этот словарь стоял ДВАЖДЫ — в
// `pages/compliance/index.astro` и в `pages/compliance/[pillar]/index.astro`,
// и во втором прямо над ним было написано «Duplicated from compliance/
// index.astro — could be extracted to src/lib/pillarMeta.ts later». Две копии
// одних и тех же описаний неизбежно расходятся: поправишь текст на хабе —
// на странице столпа останется прежний, и заметит это читатель, а не мы.
//
// ⚠⚠⚠ ЦВЕТ ЛЕЖИТ ЗДЕСЬ, А НЕ В КАРТЕ РАЗДЕЛОВ, И ЭТО НЕ ОБХОД ПРАВИЛА.
// `sectionAccent.ts` отвечает на вопрос «КУДА ведёт ссылка», и на него у всех
// семи столпов один ответ: в /compliance/, то есть сиреневый `reg`. Внутри же
// раздела нужен второй уровень различения — «КАКОЙ ИЗ СТОЛПОВ», — и он
// устроен ровно так, как у веток конструктора этикеток: четыре ступени в
// данных самой ветки (`labelMakerHub.ts`, поля `acc/line/soft/ink`), которые
// страница подставляет переменными. Прецедент узаконен в
// `claude/design-system-accents.md`: «на /pick/ акцент берётся ИЗ ВЕТКИ, а не
// из карты — все ссылки ведут в конструктор, и цвет раздела покрасил бы их
// одинаково, то есть не сказал бы ничего».
//
// ⚠ СЕМЕЙСТВА ЦВЕТОВ ОСТАВЛЕНЫ ПРЕЖНИМИ. У старого стиля каждый столп нёс
// свой градиент (`from-slate-900 via-rose-900 to-orange-900` и т. п.).
// Перестройка меняет ЯЗЫК оформления, а не опознавательные знаки разделов:
// постоянный читатель не должен обнаружить, что CLP вдруг стал синим.
//
// ⚠⚠ ЦВЕТ НИКОГДА НЕ ЕДИНСТВЕННЫЙ НОСИТЕЛЬ СМЫСЛА. У каждой карточки столпа
// стоит моно-бейдж с его именем, и текст бейджа приходит ОТСЮДА ЖЕ, что и
// цвет, — разойтись им негде. WCAG 2.2 §1.4.1; сиреневый против синего —
// ровно та пара, что сливается при дейтераномалии.
//
// ⚠ Тексты английские, комментарии русские — как везде в проекте.

export type Pillar = {
  /** Слаг раздела: он же имя папки в `src/content/compliance/`. */
  slug: string;
  /** Короткое имя: `CLP`, `OSHA HCS`. Оно же текст моно-бейджа. */
  label: string;
  /** Полное имя, разворачивающее сокращение. */
  fullName: string;
  /** Одна строка для карточки на хабе. */
  short: string;
  /** Абзац для героя страницы столпа. */
  description: string;
  /** Четыре ступени акцента: полоса · рамка · подложка · читаемый текст. */
  acc: string;
  line: string;
  soft: string;
  ink: string;
  /**
   * Тёмный край градиента героя — значение `--hub-tint`.
   * ⚠ В герое меняется ТОЛЬКО эта переменная: остальное (три слоя, углы,
   * сам градиент) описано в `hub.css` и правке из разметки не подлежит.
   */
  tint: string;
};

/**
 * ⚠ Порядок значим — это порядок карточек на хабе, и он перенесён из
 * `pillarOrder` старого файла БЕЗ ИЗМЕНЕНИЙ. Перестройка меняет оформление;
 * менять заодно и порядок разделов никто не просил.
 */
export const PILLARS: Pillar[] = [
  {
    slug: 'un-ghs',
    label: 'UN GHS',
    fullName: 'United Nations Globally Harmonized System',
    short: 'International foundation for chemical hazard classification.',
    description:
      'The international foundation for chemical hazard classification and communication. Adopted by 80+ countries, the UN GHS provides the standardized framework for hazard classes, label elements, pictograms, and the 16-section Safety Data Sheet format.',
    // blue
    acc: '#2563eb', line: '#bfdbfe', soft: '#eff6ff', ink: '#1d4ed8', tint: '#1e3a8a',
  },
  {
    slug: 'osha-hcs',
    label: 'OSHA HCS',
    fullName: 'OSHA Hazard Communication Standard',
    short: 'US workplace chemical safety regulation aligning with GHS.',
    description:
      'The US workplace chemical safety regulation aligned with GHS. OSHA HCS at 29 CFR 1910.1200 governs hazard classification, labels, and Safety Data Sheets for hazardous chemicals in American workplaces. Recent updates include the HCS 2024 final rule with phased compliance through 2028.',
    // rose
    acc: '#e11d48', line: '#fecdd3', soft: '#fff1f2', ink: '#9f1239', tint: '#4c0519',
  },
  {
    slug: 'clp',
    label: 'CLP',
    fullName: 'EU Classification, Labelling and Packaging Regulation',
    short: 'EU regulation 1272/2008 implementing GHS for the European market.',
    description:
      'European Regulation 1272/2008 implements GHS for chemicals placed on the EU market. CLP covers hazard classification, labelling, packaging requirements, and Annex VI harmonised classifications. Regular Adaptations to Technical Progress (ATPs) keep the regulation aligned with the latest scientific evidence.',
    // violet
    acc: '#7c3aed', line: '#ddd6fe', soft: '#f5f3ff', ink: '#6d28d9', tint: '#2e1065',
  },
  {
    slug: 'sds',
    label: 'SDS',
    fullName: 'Safety Data Sheets',
    short: '16-section document format communicating chemical hazards.',
    description:
      'The standardized 16-section document format for communicating chemical hazards, safe handling procedures, and regulatory status. SDS authoring is governed by REACH Annex II in the EU (Regulation (EU) 2020/878) and OSHA HCS Appendix D in the US. The format is universal worldwide thanks to UN GHS Annex 4 alignment.',
    // teal
    acc: '#0d9488', line: '#99f6e4', soft: '#f0fdfa', ink: '#0f766e', tint: '#134e4a',
  },
  {
    slug: 'reach',
    label: 'REACH',
    fullName: 'Registration, Evaluation, Authorisation and Restriction of Chemicals',
    short: 'EU regulation for chemical registration, evaluation, authorisation and restriction.',
    description:
      'EU Regulation (EC) No 1907/2006 governing chemical substances on the European market. REACH covers substance registration through ECHA, dossier evaluation, authorisation of Substances of Very High Concern (SVHCs) under Annex XIV, and Annex XVII restrictions on the most hazardous chemicals.',
    // sky
    acc: '#0ea5e9', line: '#bae6fd', soft: '#f0f9ff', ink: '#0284c7', tint: '#0c4a6e',
  },
  {
    slug: 'svhc',
    label: 'SVHC',
    fullName: 'Substances of Very High Concern under REACH',
    short: 'EU REACH SVHC identification, Candidate List, authorisation, and SCIP obligations.',
    description:
      'Article 57 criteria, Candidate List (253 entries), Annex XIV authorisation, SCIP database, supply-chain obligations.',
    // amber
    acc: '#d97706', line: '#fde68a', soft: '#fffbeb', ink: '#92400e', tint: '#451a03',
  },
  {
    slug: 'ehs',
    label: 'EHS',
    fullName: 'Environment, Health & Safety',
    short: 'Chemical incident reporting, risk assessment, and audits — built on SDS and chemical inventory.',
    description:
      'Operational chemical safety for handlers — incident reporting, risk assessment, and audit & inspection, grounded in your SDS, hazard classification, and chemical inventory.',
    // indigo
    acc: '#4f46e5', line: '#c7d2fe', soft: '#eef2ff', ink: '#4338ca', tint: '#312e81',
  },
];

export const PILLAR_BY_SLUG = new Map(PILLARS.map((p) => [p.slug, p]));

/**
 * Переменные акцента для инлайнового `style`.
 *
 * ⚠ Это ровно тот случай, который дизайн-система разрешает держать в разметке:
 * значение ВЫЧИСЛЯЕТСЯ из данных, а не является постоянной величиной. Класс
 * `.acc-<key>` тут не годится — столпов семь, и заводить под них семь классов
 * значило бы поселить палитру ещё и в CSS, третьей редакцией.
 */
export function pillarAccentStyle(p: Pillar): string {
  return `--acc:${p.acc};--acc-line:${p.line};--acc-soft:${p.soft};--acc-ink:${p.ink};--acc-strip:3px`;
}

/** То же плюс тон героя — для страницы самого столпа. */
export function pillarHeroStyle(p: Pillar): string {
  return `${pillarAccentStyle(p)};--hub-tint:${p.tint}`;
}
