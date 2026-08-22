// src/lib/classifier/types.ts
// Каркас классификатора смесей (design-doc §9 шаг 5): типы входа, снимка данных
// и результата. Один файл — один контракт: и движок, и Pages Function, и остров
// говорят на этих типах.
//
// ⚠⚠⚠ ЧИСТЫЕ ТИПЫ: ни одного импорта из `@supabase/supabase-js`, ни одного
// обращения к базе. Данные приходят снимком (`ClassifierData`), который
// собирает серверный слой (`functions/api/classify.ts`) или скрипт-проверка.
//
// ⛔ ВСЕ СТРОКИ, КОТОРЫЕ МОГУТ УЕХАТЬ В БРАУЗЕР, — ПО-АНГЛИЙСКИ.
// Урок session 68: строковые литералы лежат в бандле и читаются по Ctrl+U
// независимо от того, вызовется ли ветка; проверка «Язык интерфейса» смотрит
// именно на литералы, а не на то, увидит ли их посетитель. Комментарии
// выбрасывает сборщик — они остаются русскими.

import type { Route, InhalForm, Annex6AcutePair, Annex6Ate } from '../ate.ts';

export type { Route, InhalForm, Annex6AcutePair, Annex6Ate };

/* ── 1. Вход ─────────────────────────────────────────────────────────────── */

/** Правовой контур компонента (design-doc §4.1). CAMEO и C&L сюда не входят. */
export type ComponentSource = 'annex6' | 'supplier';

export type PhysicalState = 'solid' | 'liquid' | 'gas';

/** Аудитория этикетки — влияет на P-фразы ниже по конвейеру (pPrecedence). */
export type Audience = 'professional' | 'general_public';

/** Пара «класс + категория» на языке реестра (`hazard_category_mapping`). */
export interface ClassCat {
  classCode: string;
  /** `null` — Annex VI не печатает категорию (Press. Gas Note U, «Expl. ****»). */
  categoryCode: string | null;
  hCode: string | null;
  /** «*» — минимальная классификация (Annex VI 1.2.1). */
  star?: boolean;
  /** Как напечатано в колонке (3) — провенанс строки компонента. */
  raw?: string | null;
}

/** Специальный предел концентрации компонента (`annex6_limits` kind=SCL). */
export interface SclRow {
  /** Как напечатано («Skin Irrit. 2; H315: C ≥ 10 %»). */
  raw: string;
  /** Сокращение Annex VI («Skin Irrit. 2») — язык источника, не реестра. */
  classCat: string | null;
  hCode: string | null;
  limitLow: number | null;
  limitHigh: number | null;
  conditionText: string | null;
  needsReview: boolean;
}

/** M-фактор компонента (`annex6_limits` kind=M). */
export interface MFactorRow {
  raw: string;
  value: number;
  /** `acute` | `chronic` — как разобрано при импорте. */
  scope: string | null;
  needsReview: boolean;
}

/** Экотокс-данные компонента (для A3; в v1 приходят от поставщика). */
export interface EcotoxInput {
  lc50Fish?: number | null;
  ec50Daphnia?: number | null;
  ec50Algae?: number | null;
  noec?: number | null;
  rapidlyDegradable?: boolean | null;
}

/** Ручной ввод ATE поставщиком по путям (см. `Manual` в ate.ts). */
export type ManualAte = Partial<Record<Route, { ate?: number | null; cat?: number | null }>>;

export interface ComponentInput {
  /** Ключ строки состава — по нему в результате связываются вклады. */
  id: string;
  source: ComponentSource;
  /** Ссылка на строку Annex VI. `indexNumber` — ключ (не CAS: коллизия кадмия, №82). */
  indexNumber?: string | null;
  casPrimary?: string | null;
  ecPrimary?: string | null;
  name: string;
  /** % w/w (газы — % v/v). При диапазоне — нижняя граница. */
  conc: number;
  /** Верхняя граница диапазона; расчёт идёт по ней (worst case, решение §10.3). */
  concMax?: number | null;
  classifications: ClassCat[];
  /** H-коды строки (нужны ate.ts для пути; у поставщика — из его пар). */
  hCodes?: string[] | null;
  euhCodes?: string[] | null;
  scl?: SclRow[];
  mFactors?: MFactorRow[];
  /** Гармонизированные ATE (`annex6_limits` kind=ATE). */
  ate?: Annex6Ate[];
  /** Точные категории Acute Tox. из A0 (`annex6_classification`). */
  acutePairs?: Annex6AcutePair[];
  manualAte?: ManualAte;
  ecotox?: EcotoxInput | null;
  /**
   * Пользователь утверждает: данные есть, острой токсичности нет
   * (вода, сахар — 3.1.3.6.1(b)). Вне формулы И вне ΣC_unknown.
   */
  knownNonhazard?: boolean;
  /** Ноты Annex VI (A–F, 1–7, P…) — показываем, НЕ применяем (design-doc §8). */
  notes?: string[];
}

export interface MixtureProperties {
  physicalState: PhysicalState;
  /** Форма ингаляции для A1; по умолчанию выводится из `physicalState`. */
  inhalForm?: InhalForm | null;
  ph?: number | null;
  /** Есть данные по кислотно-щелочному резерву (3.2.3.1.2). */
  acidAlkaliReserve?: boolean | null;
  viscosityMm2s40c?: number | null;
  separatesIntoLayers?: boolean | null;
  flashPointC?: number | null;
  boilingPointC?: number | null;
}

export interface MixtureInput {
  components: ComponentInput[];
  properties: MixtureProperties;
  audience?: Audience;
  /** Остаток до 100 % объявлен неопасным пользователем (design-doc §4.3). */
  remainderStatedNonhazard?: boolean;
}

/* ── 2. Снимок данных ────────────────────────────────────────────────────── */

/** Строка `clp_generic_limits`, как её отдаёт RPC. */
export interface GenericLimitRow {
  ruleKey: string;
  kind: string;
  classCode: string | null;
  catalogCodes: string[] | null;
  ghsChapter: string | null;
  ingredientCategory: string | null;
  resultCategory: string | null;
  physicalState: string | null;
  operator: string | null;
  limitLow: number | null;
  limitHigh: number | null;
  unit: string | null;
  weightFactor: number | null;
  value: number | null;
  valueUnit: string | null;
  formulaRaw: string | null;
  raw: string;
  sourceRef: string | null;
  sourceSection: string | null;
  marker: string | null;
  note: string | null;
  needsReview: boolean;
}

/** Строка реестра: `hazard_class_catalog ⋈ hazard_category_mapping`. */
export interface RegistryEntry {
  classCode: string;
  className: string | null;
  groupType: string | null;
  euOnly: boolean;
  displayOrder: number;
  ghsChapter: string | null;
  categoryCode: string;
  hCode: string | null;
  pictogramCode: string | null;
  signalWord: string | null;
}

/** Версия данных и движка — печатается в результате, PDF и share-link (§3.3, №103). */
export interface DataRelease {
  releaseKey: string;
  annex6Consolidation: string;
  atp: string;
  engineVersion: string;
  parserVersion: string | null;
  gclMd5: string | null;
  limitsMd5: string | null;
  classificationMd5: string | null;
  releasedAt: string;
  note: string | null;
}

export interface ClassifierData {
  generic: GenericLimitRow[];
  registry: RegistryEntry[];
  release: DataRelease | null;
}

/* ── 3. Результат ────────────────────────────────────────────────────────── */

export type DecisionStatus =
  /** Смесь классифицирована в этот класс/категорию. */
  | 'classified'
  /** Проверено по правилу — порог не достигнут. */
  | 'not_classified'
  /** Данных не хватает; причина обязательна. */
  | 'insufficient_data'
  /** Модуля этой версии нет; текст «not computed in this version» обязателен. */
  | 'not_computed';

/** Вклад одного компонента в решение (таблица «Why»). */
export interface Contribution {
  componentId: string;
  name: string;
  conc: number;
  /** Значение, которым компонент вошёл в расчёт (ATE, M·C, C). */
  value: number | null;
  /** Порог, с которым сравнивался компонент (SCL/GCL/cut-off). */
  limit?: number | null;
  limitSource?: 'SCL' | 'GCL' | 'CUTOFF' | 'M' | 'ATE' | 'NONE';
  /** Одна строка провенанса («Annex VI ATE 300 mg/kg bw»). */
  provenance: string;
  /** Компонент учтён в расчёте (false — показан, но не считался). */
  counted: boolean;
}

/** Агрегат правила: сумма/значение против порога. */
export interface Aggregate {
  /** Человекочитаемое выражение с числами («(100 − 12.0) / 0.3400 = 258.8 mg/kg bw»). */
  expr: string;
  value: number;
  threshold: number | null;
  operator: string | null;
  unit?: string | null;
}

export type WarningLevel = 'info' | 'caution' | 'critical';

export interface Warning {
  /** Машинный код («UNKNOWN_GT10»); текст — для человека. */
  code: string;
  level: WarningLevel;
  /** ⛔ По-английски: уезжает в браузер. */
  message: string;
  componentId?: string;
  ruleKey?: string;
}

/** Проверенный, но не выигравший порог — для раскрытия «Why». */
export interface Candidate {
  categoryCode: string | null;
  ruleKey: string;
  passed: boolean;
  note?: string;
}

export interface Decision {
  classCode: string;
  categoryCode: string | null;
  status: DecisionStatus;
  /** H-код результата (из реестра). */
  hCode: string | null;
  pictogramCode: string | null;
  signalWord: string | null;
  /** Ключ правила: `clp_generic_limits.rule_key` | `SCL:<index>:<seq>` | `ATE:…`. */
  ruleKey: string | null;
  /** Дословный текст правила из базы. ⛔ Пусто только у `not_computed`. */
  raw: string | null;
  sourceRef: string | null;
  marker: string | null;
  /** Причина — обязательна у `insufficient_data` и `not_computed`. */
  reason: string | null;
  contributions: Contribution[];
  aggregate?: Aggregate | null;
  candidates?: Candidate[];
  warnings: Warning[];
  /** Ключ модуля, выдавшего строку («A1»). */
  module: string;
  /** Результат опирается на коррекцию неизвестных (3.1.3.6.2.3). */
  provisional?: boolean;
}

/** Дополнение к этикетке, не являющееся классификацией (EUH, триггеры SDS). */
export interface Supplemental {
  kind: 'EUH' | 'SDS_TRIGGER' | 'NOTE';
  code: string | null;
  /** ⛔ По-английски. */
  text: string;
  ruleKey: string | null;
  raw: string | null;
  componentIds: string[];
}

/** Пара для конвейера этикетки (`hazard_category_mapping` → precedence → Label Maker). */
export interface LabelPair {
  classCode: string;
  categoryCode: string;
  hCode: string | null;
  pictogramCode: string | null;
  signalWord: string | null;
}

export interface CompositionSummary {
  componentCount: number;
  /** Сумма эффективных концентраций. */
  sumConc: number;
  /** 100 − sumConc; отрицательный — сумма больше 100. */
  remainder: number;
  remainderStatedNonhazard: boolean;
  /** Хотя бы у одного компонента взята верхняя граница диапазона. */
  worstCase: boolean;
}

/**
 * Эхо одного компонента для отчёта. ⭐⭐⭐ РЕШЕНИЕ СЕРГЕЯ (s80): PDF и ссылка
 * «поделиться» обязаны нести ПОЛНЫЙ отчёт для аудита. Отсюда правило каркаса:
 * **отчёт — чистая функция от `ClassifierResult`**, второго обращения к базе
 * при печати нет и быть не может. Значит всё, что печатается, лежит в ответе:
 * что ввели, что из этого взяли в расчёт, чем это обосновано.
 */
export interface ReportComponent {
  id: string;
  name: string;
  source: ComponentSource;
  indexNumber: string | null;
  casPrimary: string | null;
  ecPrimary: string | null;
  /** Что ввёл человек (при диапазоне — обе границы). */
  concEntered: { min: number; max: number | null };
  /** Что пошло в расчёт (при диапазоне — верх, worst case). */
  concUsed: number;
  worstCase: boolean;
  classifications: ClassCat[];
  scl: SclRow[];
  mFactors: MFactorRow[];
  ate: Annex6Ate[];
  knownNonhazard: boolean;
  notes: string[];
}

/** Полное эхо входа — печатается в отчёте до результата. */
export interface ReportInput {
  components: ReportComponent[];
  properties: MixtureProperties;
  audience: Audience;
  remainderStatedNonhazard: boolean;
}

export interface ClassifierResult {
  engineVersion: string;
  release: DataRelease | null;
  /**
   * ISO-8601. ⚠ Ставит серверный слой: движок детерминирован и времени не знает
   * (иначе один и тот же состав давал бы разные ответы, и кэш по составу лгал бы).
   */
  computedAt: string | null;
  /** Эхо входа для отчёта — см. `ReportComponent`. */
  input: ReportInput;
  audience: Audience;
  physicalState: PhysicalState;
  inhalForm: InhalForm;
  composition: CompositionSummary;
  /** Строки по классам: сначала посчитанные, потом `not_computed` (порядок реестра). */
  decisions: Decision[];
  supplemental: Supplemental[];
  warnings: Warning[];
  labelPairs: LabelPair[];
  /** Модули, отработавшие в этом прогоне. */
  modules: { key: string; title: string; implemented: boolean; classes: string[] }[];
}

/* ── 4. Модуль ───────────────────────────────────────────────────────────── */

/** Компонент после нормализации: концентрация уже эффективная (worst case). */
export interface NormalizedComponent {
  input: ComponentInput;
  id: string;
  name: string;
  /** Эффективная концентрация: `concMax ?? conc`. */
  conc: number;
  concMin: number;
  concMax: number | null;
  worstCase: boolean;
  classifications: ClassCat[];
  hCodes: string[];
}

export interface NormalizedInput {
  components: NormalizedComponent[];
  properties: MixtureProperties;
  physicalState: PhysicalState;
  inhalForm: InhalForm;
  audience: Audience;
  composition: CompositionSummary;
}

export interface ModuleOutput {
  decisions: Decision[];
  supplemental?: Supplemental[];
  warnings?: Warning[];
}

/**
 * Указатели по снимку. Строит движок ОДИН раз за прогон и передаёт модулям —
 * иначе каждый модуль перестраивал бы их сам (115 + 121 строка × число модулей).
 */
export interface ModuleContext {
  rules: RuleLookup;
  registry: RegistryLookup;
}

/** Узкий контракт указателя правил — реализация в `data.ts`. */
export interface RuleLookup {
  get(ruleKey: string): GenericLimitRow | null;
  has(ruleKey: string): boolean;
  ofKind(kind: string): GenericLimitRow[];
  ofClass(classCode: string): GenericLimitRow[];
  keys(): string[];
}

/** Узкий контракт указателя реестра — реализация в `data.ts`. */
export interface RegistryLookup {
  classes(): string[];
  hasClass(classCode: string): boolean;
  categories(classCode: string): RegistryEntry[];
  entry(classCode: string, categoryCode: string | null): RegistryEntry | null;
  className(classCode: string): string;
  displayOrder(classCode: string): number;
}

export interface ClassifierModule {
  /** «A1», «A2» … — как в design-doc §5.4. */
  key: string;
  /** ⛔ По-английски: уезжает в браузер. */
  title: string;
  /** Классы реестра, за которые модуль отвечает. Пересечения запрещены. */
  classes: string[];
  /** false — заглушка: движок сам выдаёт `not_computed` по её классам. */
  implemented: boolean;
  run(input: NormalizedInput, data: ClassifierData, ctx: ModuleContext): ModuleOutput;
}
