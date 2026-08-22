// src/lib/sectionAccent.ts
//
// ОДНА карта «раздел сайта → цвет». Больше её нигде быть не должно.
//
// ⚠⚠ ЦВЕТ РАЗДАЁТСЯ ПО НАЗНАЧЕНИЮ ССЫЛКИ, А НЕ ПО МЕСТУ КАРТОЧКИ НА СТРАНИЦЕ.
// Это единственное, что отличает цвет-навигацию от цвета-украшения. Если восемь
// карточек подряд получат восемь разных оттенков «чтобы было нескучно», выйдет
// хуже двух тонов: пёстро и без смысла. А когда бирюзовый ВСЕГДА означает
// вещества, а сиреневый ВСЕГДА регуляторику, читатель за два экрана выучивает
// карту и дальше узнаёт раздел до того, как прочтёт заголовок.
//
// ⚠ Оттенков семь, а окрашенных мест на сайте втрое больше — совпадения цвета
// НЕИЗБЕЖНЫ. Правило простое: совпадение цвета допустимо только при совпадении
// ТЕМЫ. Два разных раздела одного цвета — ошибка карты, а не мелочь.
//
// ⚠⚠ Внутри раздела Label Maker у веток (`BRANCHES` в labelMakerHub.ts) есть
// СВОЙ набор акцентов — там цвет различает юрисдикции, а не разделы сайта.
// Чтобы читатель не путал эти два набора, они подаются РАЗНОЙ ФОРМОЙ:
//   • ветка (`.hub-card`)      — тонированная подложка целиком + цветной надзаголовок;
//   • внешняя ссылка (`.hub-mini-card`) — полоса 2 px сверху + цветной бейдж.
// Форма несёт «это ветка» или «это уход с раздела», цвет — «куда именно».
//
// Значения цветов — в `src/styles/design-tokens.css` (`--acc-*`), правила
// классов — в `src/styles/hub.css` (`.acc-*`). Здесь только соответствие
// «адрес → ключ»: цвет в TypeScript не должен появиться ни разу.

/** Ключи ровно те, для которых в design-tokens.css есть лестница `--acc-<key>`. */
export type AccentKey = 'subst' | 'class' | 'pict' | 'store' | 'transport' | 'reg' | 'label';

export type AccentSection = {
  key: AccentKey;
  /** Чем этот цвет объясняется человеку — идёт в design-system.md. */
  means: string;
  /**
   * Короткое имя раздела для моно-бейджа на карточке.
   *
   * ⚠⚠ ЭТО НЕ УКРАШЕНИЕ, А ДОСТУПНОСТЬ. Цвет как единственный носитель смысла
   * не работает у примерно каждого двенадцатого мужчины (дейтераномалия), а
   * бирюзовый против сиреневого — как раз та пара, которая сливается. Бейдж
   * повторяет то же сообщение словом, поэтому карта разделов остаётся читаемой
   * без цвета вообще. WCAG 2.2, 1.4.1 «Use of Color».
   */
  badge: string;
  /**
   * Префиксы адресов. ⚠ ПОРЯДОК ВНУТРИ ЭТОГО СПИСКА НЕ ВАЖЕН, а порядок самих
   * разделов в `ACCENT_SECTIONS` — важен: выигрывает первое совпадение, поэтому
   * `/tools/ate-mixture-calculator/` обязан стоять раньше, чем `/tools/`.
   */
  prefixes: string[];
};

/**
 * ⚠⚠ ПОРЯДОК ЗНАЧИМ — сверху вниз, побеждает первое совпадение по префиксу.
 * Частное всегда выше общего: `/tools/chemical-storage-compatibility/` — это
 * хранение, а не «инструменты», и если общий `/tools/` встанет выше, матрица
 * молча покрасится не в свой цвет.
 */
export const ACCENT_SECTIONS: AccentSection[] = [
  {
    key: 'label',
    badge: 'Label maker',
    means: 'the label maker — the flagship, and the one action the site asks for',
    prefixes: ['/ghs-label-maker/'],
  },
  {
    key: 'class',
    badge: 'Classification',
    means: 'classification: hazard classes, H- and P-statements, mixture classification',
    prefixes: [
      '/hazard-classes/',
      '/h-statements/',
      '/p-statements/',
      '/tools/clp-mixture-classifier/',
      '/tools/ate-mixture-calculator/',
      '/tools/ghs-calculator',
    ],
  },
  {
    key: 'store',
    badge: 'Storage',
    means: 'storage and incompatibility — what must not stand next to what',
    prefixes: ['/storage-compatibility/', '/tools/chemical-storage-compatibility/'],
  },
  {
    key: 'subst',
    badge: 'Substances',
    means: 'substances and their reports — the harmonised data behind a label',
    prefixes: ['/substances/', '/sds/', '/sds-sections/'],
  },
  {
    key: 'pict',
    badge: 'Pictograms',
    means: 'pictograms — the nine marks and the selector that picks them',
    prefixes: ['/pictograms/', '/pictogram-selector/'],
  },
  {
    key: 'transport',
    badge: 'Transport',
    means: 'transport — UN numbers, ADR, 49 CFR',
    prefixes: ['/un/', '/transport/', '/adr/'],
  },
  {
    key: 'reg',
    badge: 'Compliance',
    means: 'regulatory guides — CLP, REACH, HazCom, SVHC in long form',
    prefixes: ['/compliance/'],
  },
];

/**
 * Ключ акцента для адреса, или `null` — если раздела в карте нет.
 *
 * ⚠ `null` — законный ответ, а не пропуск. Индексы и служебные страницы
 * (`/tools/`, `/blog/`, `/faq/`, `/privacy/`) темы не имеют, и красить их
 * означало бы придумать им тему. Нейтральная карточка тут честнее цветной.
 *
 * ⚠ Адрес может нести запрос и якорь (`/ghs-label-maker/?jur=clp#build`) —
 * их надо отрезать до сравнения, иначе совпадение по префиксу сработает,
 * а по точному равенству нет, и разница вылезет только на части ссылок.
 */
export function accentKeyFor(href: string | null | undefined): AccentKey | null {
  if (!href) return null;
  const path = String(href).split('#')[0].split('?')[0];
  if (!path.startsWith('/')) return null; // внешние ссылки темы сайта не имеют
  for (const s of ACCENT_SECTIONS) {
    if (s.prefixes.some((p) => path === p || path.startsWith(p))) return s.key;
  }
  return null;
}

/**
 * Класс для разметки: `'acc-subst'` и т. п., либо `''`.
 *
 * ⚠⚠ Возвращается КЛАСС, а не набор `--acc:#…` в атрибуте `style`. Инлайновые
 * переменные с литералами — ровно то, из-за чего в labelMakerHub.ts лежало
 * двадцать четыре шестнадцатеричных литерала: сменить оттенок раздела
 * означало найти их все. С классом оттенок меняется в одном файле токенов.
 */
export function accentClass(href: string | null | undefined): string {
  const key = accentKeyFor(href);
  return key ? `acc-${key}` : '';
}

/** `'hub-mini-card acc-subst'` — чтобы в разметке не склеивать строки руками. */
export function withAccent(base: string, href: string | null | undefined): string {
  const a = accentClass(href);
  return a ? `${base} ${a}` : base;
}

/** Карта по ключу — чтобы бейдж и объяснение брались оттуда же, откуда цвет. */
export const ACCENT_BY_KEY = new Map(ACCENT_SECTIONS.map((s) => [s.key, s]));

/**
 * Имя раздела назначения для моно-бейджа, или `null`.
 *
 * ⚠ Пусто — законно: раздела в карте нет, значит и говорить нечего. Придумать
 * бейдж «Other» означало бы завести восьмой раздел, которого не существует.
 */
export function accentBadge(href: string | null | undefined): string | null {
  const key = accentKeyFor(href);
  return key ? (ACCENT_BY_KEY.get(key)?.badge ?? null) : null;
}
