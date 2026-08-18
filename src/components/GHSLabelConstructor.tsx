import { useState, useEffect, useRef, useMemo, type ChangeEvent, type DragEvent } from 'react'
import {
  layoutLabel, renderSvg, downloadLabelSvg, downloadLabelPdf, downloadLabelSheetPdf,
  type LabelInput,
} from '../lib/labelEngine'
import {
  JURISDICTIONS, JURISDICTION_ORDER, sizeTierForLitres, recommendedTierForLitres, smallPackageRuleFor,
  labelSizeVerdict, workplaceOptionFor,
  type JurisdictionKey, type LabelPurpose, type SizeTier,
} from '../lib/jurisdictions'
// ⭐⭐ Отбор шести фраз. До session 65 здесь стоял `pStatements.slice(0, 6)`.
import { usePPrecedence, type FitProbe } from '../lib/usePPrecedence'
// ⭐⭐ Замер влезаемости настоящим `layoutLabel` — session 70.
import { measureFitCapacity, type FitProbeContext } from '../lib/labelFitProbe'
import PStatementProtocol from './PStatementProtocol'
import type { Audience } from '../lib/pPrecedence'
import {
  stockFor, stockMm, stockSizeLabel, inchLabel, SHEET_MM, SHEET_NAME, MM_PER_INCH,
  LABEL_STOCK_ALL,
  type LabelStockItem,
} from '../lib/labelStock'
import type { NameVariant } from '../lib/labelProductName'
import { casShapeOk, ecShapeOk } from '../lib/substanceIdentifiers'
import {
  EU_LANGUAGES, LANGUAGE_BY_CODE, suggestedLanguages, fetchTranslations, EURLEX_ATTRIBUTION,
  SIGNAL_CODE, signalWordFor,
  PRIMARY_LANGUAGES, PRIMARY_LANGUAGE_EXCLUDED, PRIMARY_LANGUAGE_EXCLUDED_REASON,
  suggestedPrimaryLanguages,
  type TranslationMap,
} from '../lib/labelLanguages'
import {
  fetchLocalisedNames, formChoices, nameForLabel, printedNameSuffix, identityHints,
  unreliableReason,
  type LocalisedNames,
} from '../lib/labelNameForms'
import {
  marketsFor, secondLanguageIsEqual, suggestedPairFor, MARKET_BY_CODE,
} from '../lib/labelMarkets'
import {
  renderStatement, rolesForCodes, roleIsRequired, ROLE_OBLIGATION,
  type PlaceholderRole, type PlaceholderValues,
} from '../lib/statementPlaceholders'
import {
  renderPStatement, pSlotCount, pSlotKinds, hasPSlots, hasPBracket, inferSlotDefault,
} from '../lib/pStatementSlots'
import { supabase } from '../lib/supabase'
import NewsletterOptIn from './NewsletterOptIn'

interface Pictogram { code: string; name_en: string; svg_content: string | null }
interface HStatement { code: string; text_en: string }
/** ⚠ `text_en` — официальный текст со знаками пропусков; `text_plain` — наш
 *  прежний, заполненный за поставщика: он идёт предзаполнением поля, не печатью. */
interface PStatement { code: string; text_en: string; text_plain?: string | null }

interface Props {
  displayName: string
  /**
   * CAS, подставляемый в поле по умолчанию.
   *
   * ⚠⚠ СЮДА ПРИХОДИТ УЖЕ РАЗОБРАННОЕ ЗНАЧЕНИЕ, а не колонка базы. У групповых
   * записей Annex VI в колонке лежит склейка номеров всех форм, обрезанная по
   * длине поля («71-41-0[1]584-02-1[2»), и она печаталась на этикетке как есть.
   * Разбор — в `labelProductName.ts`, вызов — в `LabelConstructorLoader`.
   */
  casNumber: string
  /** EC, подставляемый по умолчанию. Разобран там же и по тому же правилу. */
  ecNumber?: string | null
  /**
   * Чем отличается запись базы — сырой CAS из колонки. Только для сброса
   * состояния, имени файла и метрик; на этикетку не идёт.
   *
   * ⚠ Нужен отдельно от `casNumber`, потому что тот теперь бывает пустым: у
   * 159 записей склейку печатать нельзя, и завязывать сброс P-фраз на пустую
   * строку значит не сбрасывать их вовсе при переходе между такими веществами.
   */
  entryKey?: string
  signalWord?: string | null
  pictograms: Pictogram[]
  hStatements: HStatement[]
  pStatements: PStatement[]
  /** Юрисдикция, с которой открывается инструмент (задаётся страницей раздела). */
  initialJurisdiction?: JurisdictionKey
  /** Вид этикетки, с которого открывается инструмент. */
  initialPurpose?: LabelPurpose
  /**
   * Какие P-фразы отмечены изначально. Для вещества из базы это первые шесть из
   * его собственного набора; в ручном режиме сюда приходит пустой массив —
   * там список общий, все 117, и первые шесть означали бы случайный выбор.
   */
  initialSelectedP?: string[]
  /**
   * Варианты имени из записи Annex VI. У групповых записей их пять и больше, и
   * человек должен выбрать ту форму, которую он на самом деле фасует.
   *
   * ⚠⚠ ЭТО ЗАПАСНОЙ ПУТЬ, А НЕ ОСНОВНОЙ. Он разбирает колонки `substances`, где
   * групповая запись до сих пор лежит одной строкой. Основной путь — таблица
   * `substance_name_translations` по `indexNumber` ниже: она разобрана на формы
   * и примечания и есть на 23 языках. Пропом пользуемся, только когда строки
   * переводов нет (3 записи из 4 178) или запись не пришла с индексным номером.
   */
  nameVariants?: NameVariant[]
  /**
   * Индексный номер Annex VI — ключ к именам на всех 23 языках.
   *
   * ⚠ Без него панель выбора основного языка работает, но имя остаётся тем, что
   * пришло из `substances`, то есть английским. Пустое значение — законное
   * состояние: в ручном режиме вещества нет вовсе.
   */
  indexNumber?: string | null
  /**
   * Формат наклейки, на котором открывается инструмент — `id` из `labelStock.ts`.
   * Задаётся страницами `/ghs-label-maker/templates/<slug>/`: там в заголовке
   * обещан конкретный размер, и открываться на размере по умолчанию нельзя.
   *
   * ⚠ Неизвестный `id` молча игнорируется и остаётся размер по умолчанию:
   * страница шаблона в этом случае просто не выполнит обещание, а вот падение
   * острова унесло бы весь конструктор.
   */
  initialStockId?: string
  /**
   * Второй язык этикетки, с которым открывается инструмент — код из
   * `labelLanguages.ts`. Приходит из адреса (`?lang=de`), чтобы ссылка вида
   * «немецкая этикетка на это вещество» открывала именно её.
   *
   * ⚠ Неизвестный код молча игнорируется: второй язык — не обязательный
   * элемент нигде, кроме Канады, и падать из-за опечатки в адресе нельзя.
   */
  initialSecondLang?: string
}

/** Формат по `id` плюс его габариты в мм. `null`, если такого формата нет. */
function stockById(id: string | undefined): { stock: LabelStockItem; mm: { w: number; h: number } } | null {
  if (!id) return null
  const stock = LABEL_STOCK_ALL.find((s) => s.id === id)
  return stock ? { stock, mm: stockMm(stock) } : null
}

const STORAGE_KEY = 'ghs_supplier_data'
const LOGO_STORAGE_KEY = 'ghs_logo_data'
const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#062A78]'
const labelClass = 'block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide'

/**
 * Подписи полей для заполняемых пропусков H-фраз.
 *
 * ⚠ Подсказка — ПРИМЕР из самого регламента, а не выдумка: `H372 (blood)`,
 * `H373 (liver)`, `H371 (nervous system; oral, inhalation)` стоят в Annex VI.
 * Человек, увидевший пример из первоисточника, вводит то, что там ожидается.
 */
const PH_LABEL: Record<PlaceholderRole, string> = {
  organs: 'Organs affected',
  effect: 'Specific effect',
  route: 'Route of exposure',
  sensitiser: 'Sensitising substance',
}
const PH_HINT: Record<PlaceholderRole, string> = {
  organs: 'liver, kidneys',
  effect: 'may damage the unborn child',
  route: 'inhalation',
  sensitiser: 'D-limonene',
}

/** Быстрые объёмы тары. Второе число — литры, ими выбирается ярус CLP. */
const CAPACITY_PRESETS = [
  { label: '100 mL', ml: 100 },
  { label: '500 mL', ml: 500 },
  { label: '5 L', ml: 5_000 },
  { label: '20 L', ml: 20_000 },
  { label: '200 L', ml: 200_000 },
  { label: '1000 L', ml: 1_000_000 },
]

export default function GHSLabelConstructor({
  displayName, casNumber, ecNumber, entryKey, signalWord,
  pictograms, hStatements, pStatements,
  initialJurisdiction = 'osha', initialPurpose = 'supplier', initialSelectedP, nameVariants,
  initialStockId, initialSecondLang, indexNumber,
}: Props) {
  // Чем отличается запись: сырой CAS колонки, если он передан. Идёт в имя
  // файла и в метрики — там нужна ссылка на запись базы, а не то, что человек
  // напечатал на бумаге. ⚠ На этикетку это значение не попадает никогда.
  const entryCas = entryKey ?? casNumber

  const [jurisdictionKey, setJurisdictionKey] = useState<JurisdictionKey>(initialJurisdiction)
  const [purpose, setPurpose] = useState<LabelPurpose>(initialPurpose)
  const j = JURISDICTIONS[jurisdictionKey]

  /**
   * ⭐⭐ ВЫБРАННЫЙ НАБОР ЦЕХОВОЙ ЭТИКЕТКИ. §1910.1200(f)(6) даёт ВЫБОР ИЗ ДВУХ,
   * и до session 68 инструмент делал его за человека.
   *
   * ⚠⚠ КЛЮЧ ХРАНИТСЯ, А НЕ НОМЕР. Юрисдикцию можно переключить в любой момент,
   * и `workplaceOptions[1]` у OSHA и у CLP — это разные вещи (у CLP второго нет
   * вовсе). Номер пережил бы смену и молча выбрал чужой набор; неизвестный ключ
   * `workplaceOptionFor` честно сворачивает в первый — законный — набор.
   */
  const [workplaceOption, setWorkplaceOption] = useState<string>(j.workplaceOptions[0].key)
  const wpOption = workplaceOptionFor(j, workplaceOption)

  // Формат, заданный страницей шаблона. Считается один раз: дальше человек
  // меняет размер сам, и пересчёт затирал бы его выбор на каждой перерисовке.
  const preset = useMemo(() => stockById(initialStockId), [initialStockId])

  // ⚠ У формата есть РОДНАЯ единица, и она важнее юрисдикции. Страница шаблона
  // «210 × 148 mm» в режиме OSHA открылась бы в дюймах и показала «8-9/32 × 5-13/16»
  // — числа, которых нет ни в одном каталоге и которые человек не сопоставит со
  // своей пачкой наклеек.
  const [unit, setUnit] = useState<'mm' | 'in'>(preset?.stock.unit ?? JURISDICTIONS[initialJurisdiction].unit)
  const [capacityMl, setCapacityMl] = useState<number>(500)
  const [sizeW, setSizeW] = useState<number>(preset?.mm.w ?? 101.6) // мм, по умолчанию Avery 4 × 2 in
  const [sizeH, setSizeH] = useState<number>(preset?.mm.h ?? 50.8)
  const [stockId, setStockId] = useState<string | null>(preset?.stock.id ?? 'us-4x2')

  const [supplierName, setSupplierName] = useState('')
  const [supplierAddress, setSupplierAddress] = useState('')
  const [supplierPhone, setSupplierPhone] = useState('')
  // ⚠⚠ Имя, CAS и EC на этикетке РЕДАКТИРУЕМЫЕ. У групповых записей Annex VI
  // одна ячейка хранит все формы сразу — и имена, и номера, — а импорт ещё и
  // режет её по длине. Разбор идёт до компонента (`labelProductName.ts`),
  // сюда приходит либо годное значение, либо пустая строка.
  const [productName, setProductName] = useState(displayName)
  const [casOnLabel, setCasOnLabel] = useState(casNumber)
  const [ecOnLabel, setEcOnLabel] = useState(ecNumber ?? '')
  const [nominalQty, setNominalQty] = useState('')
  const [ufiCode, setUfiCode] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [pFormat, setPFormat] = useState<'codes' | 'combined'>('codes')
  /**
   * ⛔⛔ ЗДЕСЬ СТОЯЛО `pStatements.slice(0, 6)` — И ЭТО БЫЛ САМЫЙ КРУПНЫЙ ДЕФЕКТ
   * ИНСТРУМЕНТА (закрыт в session 65).
   *
   * Первые шесть кодов списка, отсортированного по номеру. Ни статьи 28, ни
   * уровней важности ECHA, ни колонки 5 Annex IV. Пара `P304+P340` при этом
   * рвалась пополам, и на этикетку печаталась половина фразы, которой в CLP не
   * существует. Отбор делает `pPrecedence.ts` — девять проходов и протокол на
   * каждую фразу.
   *
   * ⚠⚠ ПУСТО НА СТАРТЕ, А НЕ «ПОКА ПЕРВЫЕ ШЕСТЬ». Снимок данных грузится
   * асинхронно, и заполнить набор до его прихода можно только неверно.
   * Показать шесть неверных фраз и молча заменить их через полсекунды хуже, чем
   * показать пустое поле: первый вариант человек успевает принять за ответ.
   * ⚠ `initialSelectedP` (коды из адреса) — исключение: их назвал человек.
   */
  const [selectedP, setSelectedP] = useState<string[]>(() => initialSelectedP ?? [])
  /**
   * ⚠⚠ Человек тронул набор руками — движок больше НЕ ПЕРЕЗАПИСЫВАЕТ его.
   * Иначе смена аудитории или объёма тары стирала бы ручную правку, и это
   * читалось бы как «инструмент не слушается».
   */
  const pTouched = useRef(Boolean(initialSelectedP?.length))
  /**
   * Кому поставляется товар.
   *
   * ⚠⚠ НЕ КОСМЕТИКА И НЕ СИНОНИМ `purpose`. От аудитории зависят три разные
   * вещи: закреп ст. 28(2) (у населения фраза про утилизацию обязательна),
   * появление раздела Annex IV «Consumer products» (`P101`–`P103`) и колонка
   * уровней ECHA — у населения и у профессионала они РАЗНЫЕ. `purpose`
   * (supplier / workplace / small) отвечает на другой вопрос — какие элементы
   * вообще обязаны быть на этикетке.
   */
  const [audience, setAudience] = useState<Audience>('professional')
  /** Показывать ли протокол отбора под списком фраз. */
  const [protocolOpen, setProtocolOpen] = useState(false)
  /**
   * ⭐ Ручная поправка кегля — доля от подобранного движком. 1 = авто.
   *
   * ⚠⚠ ИМЕННО ДОЛЯ, А НЕ МИЛЛИМЕТРЫ. Одно и то же число миллиметров на
   * 40 × 25 мм и на 210 × 297 мм означает совершенно разные этикетки, и
   * ползунок в миллиметрах пришлось бы перенастраивать при каждой смене
   * заготовки. Доля переносится между размерами без пересчёта.
   *
   * ⚠ Границы держит движок (`MIN_BODY_MM`, потолок от ширины), а не это поле:
   * проверка в интерфейсе — удобство, проверка в движке — гарантия.
   */
  const [bodyScale, setBodyScale] = useState(1)
  const [showAllP, setShowAllP] = useState(false)
  const [pQuery, setPQuery] = useState('')

  // ── ОСНОВНОЙ язык этикетки ────────────────────────────────────────────────
  /**
   * ⚠⚠ ОСНОВНОЙ ЯЗЫК — ЭТО НЕ «ПЕРЕВОД ЭТИКЕТКИ», А ВЫБОР РЕДАКЦИИ ТЕКСТА.
   *
   * Каждый элемент, который тут меняется, напечатан в самом регламенте на всех
   * официальных языках: H- и EUH-фразы в Annex III, P-фразы в Annex IV, имя
   * вещества в Annex VI Part 3, сигнальное слово в таблицах Annex I. Мы их
   * ДОСТАЁМ, а не переводим — ни здесь, ни где-либо ещё в этом файле.
   *
   * ⚠ Английский по умолчанию потому, что он единственный годится всем четырём
   * юрисдикциям: OSHA и WHMIS написаны про английский текст, у GB CLP язык тоже
   * английский, а в ЕС английский законен везде, где рынок его принимает.
   */
  const [primaryLang, setPrimaryLang] = useState<string>('EN')
  const [primaryTexts, setPrimaryTexts] = useState<TranslationMap>({})
  const [primaryLoading, setPrimaryLoading] = useState(false)
  const [primaryError, setPrimaryError] = useState('')
  /** Имена вещества на основном языке — из `substance_name_translations`. */
  const [names, setNames] = useState<LocalisedNames | null>(null)
  const [namesError, setNamesError] = useState('')
  /** Официальное имя вещества на втором языке этикетки. CLP ст. 17(2). */
  const [secondName, setSecondName] = useState<string | null>(null)
  /**
   * Что в поле имени поставили МЫ, а не человек.
   *
   * ⚠⚠ Нужно, чтобы смена языка не затирала набранное вручную. Сравнивать с
   * `displayName` нельзя: он приходит из `substances` и на немецкий не меняется.
   */
  const autoNameRef = useRef<string>(displayName)
  /** Текущее имя, доступное из колбэка загрузки без пересоздания эффекта. */
  const productNameRef = useRef<string>(displayName)

  // ── Второй язык этикетки ──────────────────────────────────────────────────
  // ⚠⚠ Для Канады это не удобство: HPR s. 6.2 требует ОБА официальных языка, и
  // одноязычная этикетка поставщика там незаконна. `checkCompliance` в движке
  // это уже проверяет — здесь появляется то, чем требование выполняется.
  // ⚠ Код из адреса проверяется по перечню ДО того, как попасть в состояние:
  // `fetchTranslations` с чужим кодом вернул бы пустоту молча, и человек решил
  // бы, что официального перевода нет вовсе.
  const [secondLang, setSecondLang] = useState<string | null>(
    initialSecondLang && LANGUAGE_BY_CODE.has(initialSecondLang) ? initialSecondLang : null,
  )
  /**
   * Рынок внутри юрисдикции — нужен ТОЛЬКО там, где официальных языков больше
   * одного (Бельгия, Люксембург, Финляндия, Ирландия, Мальта).
   *
   * ⚠ У Канады рынка не спрашиваем: WHMIS сам по себе двуязычен
   * (`requiredLanguages = ['en','fr']`), и уточнять там нечего.
   */
  const [market, setMarket] = useState<string | null>(null)
  const [secondTexts, setSecondTexts] = useState<TranslationMap>({})
  const [secondLoading, setSecondLoading] = useState(false)
  const [secondError, setSecondError] = useState('')

  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [logo, setLogo] = useState<{ dataUrl: string; aspect: number } | null>(null)
  const [logoName, setLogoName] = useState('')
  const [logoError, setLogoError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [sheetNote, setSheetNote] = useState('')
  /** Сбой генерации PDF — виден человеку, а не только в консоли. */
  const [downloadError, setDownloadError] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ⚠ Набор P-фраз пересобирается при смене вещества: иначе от прошлого вещества
  // остаются коды, которых у нового нет, и на этикетку не попадает ничего.
  // ⚠⚠ Смена вещества СНИМАЕТ отметку «тронуто руками»: набор, собранный под
  // прошлое вещество, к новому отношения не имеет, и держать его как «выбор
  // человека» значит подсунуть чужие фразы под новую классификацию.
  useEffect(() => {
    pTouched.current = Boolean(initialSelectedP?.length)
    setSelectedP(initialSelectedP ?? [])
  }, [entryCas, pStatements.length])

  /**
   * Заполняемые пропуски H-фраз: что назвал поставщик.
   *
   * ⚠⚠ ДВА НАБОРА ЗНАЧЕНИЙ, А НЕ ОДИН, И ЭТО НЕ ИЗБЫТОЧНОСТЬ. Значение —
   * это текст, который печатается: «liver, kidneys» по-английски и
   * «Leber, Nieren» по-немецки. Одно поле на два языка напечатало бы английские
   * органы внутри немецкой строки — тот же дефект, что непечатаемая скобка,
   * только незаметнее. Переводить введённое поставщиком мы не можем: мы не
   * переводим ни фразы регламента, ни тем более чужой текст.
   */
  const [phValues, setPhValues] = useState<PlaceholderValues>({})
  const [phValuesSecond, setPhValuesSecond] = useState<PlaceholderValues>({})

  // ⚠ Смена вещества обнуляет введённое: органы, названные для анилина, на
  // этикетке следующего вещества были бы прямой ложью.
  useEffect(() => { setPhValues({}); setPhValuesSecond({}) }, [entryCas])

  /**
   * Заполняемые пропуски P-фраз: по массиву значений на код, отдельно на язык.
   *
   * ⚠ Индекс слота считается ВНУТРИ ТЕКСТА КОНКРЕТНОГО ЯЗЫКА, а не общий на все.
   * У P413 по-английски четыре слота, по-итальянски три (итальянская редакция не
   * даёт варианта в °F) — и это правильно. Сопоставлять слоты между языками не
   * нужно вовсе: значение поставщик вводит для каждого языка своё.
   */
  const [pValues, setPValues] = useState<Record<string, string[]>>({})
  const [pValuesSecond, setPValuesSecond] = useState<Record<string, string[]>>({})
  /** Включён ли необязательный кусок в квадратных скобках. ⚠ По умолчанию нет. */
  const [pBrackets, setPBrackets] = useState<Record<string, boolean>>({})
  /** Колонка 5 Annex IV — что регламент велит вписать. Ключ — код фразы. */
  const [pConditions, setPConditions] = useState<Record<string, string>>({})

  /**
   * ⭐⭐ ПРЕДЗАПОЛНЕНИЕ ИЗ НАШЕГО ПРЕЖНЕГО ТЕКСТА.
   *
   * Сочинённое никуда не девается, но перестаёт быть невидимым утверждением на
   * таре и становится предложением, которое поставщик видит и принимает.
   * ⚠ Достаётся только там, где мы и правда подставляли: «hands», «water»,
   * «local regulations». Где мы пересказывали («not exceeding the specified
   * temperature»), совпадения нет и поле остаётся пустым — так и надо.
   */
  /**
   * ⚠⚠ ПРЕДЗАПОЛНЕНИЕ РАБОТАЕТ ТОЛЬКО ПРИ АНГЛИЙСКОМ ОСНОВНОМ ЯЗЫКЕ.
   *
   * `text_plain` — НАШ прежний сочинённый текст, и он существует ровно на одном
   * языке. Подставить «water» или «hands» в поле, значение которого печатается
   * внутри НЕМЕЦКОЙ P-фразы, значит положить английские слова на немецкую
   * этикетку — и притом молча: заполненное поле выглядит как заполненное.
   * Немецких вариантов у нас нет, выдумывать их мы не будем, поэтому при
   * неанглийском основном языке поля остаются пустыми.
   */
  useEffect(() => {
    const next: Record<string, string[]> = {}
    if (primaryLang === 'EN') {
      for (const p of pStatements) {
        if (!hasPSlots(p.code)) continue
        const d = inferSlotDefault(p.text_en, p.text_plain, p.code, 'EN')
        if (d) next[p.code] = [d]
      }
    }
    setPValues(next)
    setPValuesSecond({})
    setPBrackets({})
  }, [entryCas, pStatements.length, primaryLang])

  // Колонка 5 грузится один раз на набор кодов и только если пропуски вообще есть.
  useEffect(() => {
    const codes = pStatements.map((p) => p.code).filter((c) => hasPSlots(c) || hasPBracket(c))
    if (codes.length === 0) { setPConditions({}); return }
    let cancelled = false
    supabase.from('p_statement_conditions').select('code, conditions').in('code', codes)
      .then(({ data, error }) => {
        if (cancelled || error) return
        const map: Record<string, string> = {}
        for (const r of (data ?? []) as { code: string; conditions: string }[]) map[r.code] = r.conditions
        setPConditions(map)
      })
    return () => { cancelled = true }
  }, [pStatements.map((p) => p.code).join(',')])

  /**
   * Официальные тексты фраз на ОСНОВНОМ языке.
   *
   * ⚠ Для английского запроса нет: `text_en` уже пришёл пропом из
   * `h_statements`/`p_statements` и является той же официальной редакцией.
   * Второй поход в базу за тем же самым только замедлил бы первый кадр.
   */
  useEffect(() => {
    if (primaryLang === 'EN') { setPrimaryTexts({}); setPrimaryError(''); return }
    let cancelled = false
    const codes = [
      ...hStatements.map((h) => h.code), ...pStatements.map((x) => x.code),
      SIGNAL_CODE.danger, SIGNAL_CODE.warning,
    ]
    setPrimaryLoading(true)
    setPrimaryError('')
    fetchTranslations(primaryLang, codes)
      .then((map) => { if (!cancelled) setPrimaryTexts(map) })
      // ⚠⚠ Здесь ошибка ХУЖЕ, чем у второго языка. Там пустая карта означала
      // «второго блока не будет»; здесь — что ОСНОВНОЙ блок молча уедет на
      // английском, а человек выбрал немецкий и уверен, что получил немецкий.
      .catch((e: Error) => { if (!cancelled) { setPrimaryTexts({}); setPrimaryError(e.message) } })
      .finally(() => { if (!cancelled) setPrimaryLoading(false) })
    return () => { cancelled = true }
  }, [primaryLang, entryCas, hStatements.length, pStatements.length])

  /**
   * Имена вещества на основном языке.
   *
   * ⚠⚠ ЗАПРОС ИДЁТ И ДЛЯ АНГЛИЙСКОГО. `substances.display_name_short` и
   * `substance_name_translations` расходятся у 2 074 записей из 4 178, и почти
   * всюду вторая лучше: в первой групповая запись до сих пор лежит одной
   * строкой («isopentyl formate [1] pentyl formate [2]»), а иногда и обрезана
   * по длине колонки. Английский тут не исключение и исключением быть не должен.
   */
  useEffect(() => {
    if (!indexNumber) { setNames(null); setNamesError(''); return }
    let cancelled = false
    setNamesError('')
    fetchLocalisedNames(indexNumber, primaryLang)
      .then((n) => {
        if (cancelled) return
        setNames(n)
        /**
         * ⚠⚠ ИМЯ ПЕРЕКЛЮЧАЕТСЯ НА ЯЗЫК — НО ТОЛЬКО ЕСЛИ ЕГО НЕ ПРАВИЛ ЧЕЛОВЕК.
         *
         * Выбрал немецкий — в поле должно встать «Salpetersäure», иначе выбор
         * языка на имени не сказывается вовсе и панель лжёт. Но человек мог уже
         * вписать своё торговое название, и затирать его сменой языка нельзя.
         * Отличаем по `autoNameRef`: там лежит ровно то, что подставили МЫ.
         *
         * ⚠ CAS и EC при смене языка НЕ ТРОГАЕМ: номера от языка не зависят, а
         * человек мог ввести номер той партии, которую фасует.
         */
        const first = n ? formChoices(n, nameVariants ?? [])[0] : undefined
        if (!first) return
        const cur = productNameRef.current
        if (cur.trim() && cur !== autoNameRef.current) return
        /**
         * ⚠⚠ ОБЕ МЕТКИ ПЕРЕСТАВЛЯЮТСЯ ВМЕСТЕ. Пока `productNameRef` здесь не
         * трогали, он оставался с прежним именем, а `autoNameRef` уезжал на
         * новое — и при СЛЕДУЮЩЕЙ смене языка условие выше читало расхождение
         * двух наших же меток как «человек вписал своё название» и выходило.
         * Имя замирало на том языке, который загрузился первым (обычно
         * английский), и дальше не менялось никогда, хотя фразы менялись
         * исправно. Переводы имён при этом лежат в базе на все 4 178 веществ
         * и 23 языка — то есть дефект был в одной строке, а не в данных.
         */
        autoNameRef.current = first.name
        productNameRef.current = first.name
        setProductName(first.name)
      })
      .catch((e: Error) => { if (!cancelled) { setNames(null); setNamesError(e.message) } })
    return () => { cancelled = true }
  }, [indexNumber, primaryLang])

  // Официальные тексты фраз на втором языке. Грузятся по выбору языка и при
  // смене вещества — набор кодов у нового вещества другой.
  useEffect(() => {
    if (!secondLang) { setSecondTexts({}); setSecondError(''); return }
    let cancelled = false
    // ⭐ Сигнальные слова запрашиваются вместе с фразами: они лежат в той же
    // таблице (annex = 'I'), и отдельный запрос был бы вторым походом в базу
    // ради двух строк.
    const codes = [
      ...hStatements.map((h) => h.code), ...pStatements.map((x) => x.code),
      SIGNAL_CODE.danger, SIGNAL_CODE.warning,
    ]
    setSecondLoading(true)
    setSecondError('')
    fetchTranslations(secondLang, codes)
      .then((map) => { if (!cancelled) setSecondTexts(map) })
      // ⚠ Ошибку показываем, а не проглатываем: пустая карта переводов и
      // закрытый доступ к таблице выглядят на этикетке одинаково — одной
      // английской строкой, — и без этого сообщения различить их нельзя.
      .catch((e: Error) => { if (!cancelled) { setSecondTexts({}); setSecondError(e.message) } })
      .finally(() => { if (!cancelled) setSecondLoading(false) })
    return () => { cancelled = true }
  }, [secondLang, entryCas, hStatements.length, pStatements.length])

  /**
   * Имя вещества на ВТОРОМ языке.
   *
   * ⚠⚠ Это обязательный элемент, а не украшение. CLP ст. 17(1)(c) относит
   * идентификатор продукта к элементам этикетки, а ст. 17(2) разрешает лишние
   * языки «при условии, что во всех использованных языках приведены одни и те
   * же сведения». До session 62 второй блок нёс слово и фразы, но не имя — и
   * двуязычная этикетка называла вещество только на одном языке.
   *
   * ⚠ Правкой поля ввода это НЕ управляется, в отличие от основного имени:
   * там человек вправе поставить своё торговое название, здесь же печатается
   * официальное имя по Annex VI на втором языке. Своего поля у него нет — и
   * пока не надо: выдуманного второго имени быть не должно.
   */
  useEffect(() => {
    if (!indexNumber || !secondLang) { setSecondName(null); return }
    let cancelled = false
    fetchLocalisedNames(indexNumber, secondLang)
      .then((n) => {
        if (cancelled) return
        const first = n ? formChoices(n, nameVariants ?? [])[0] : undefined
        setSecondName(first?.name ?? null)
      })
      // ⚠ Молча: отсутствие перевода имени — не повод рушить этикетку, а
      // движок просто не напечатает вторую строку. Ошибка второго языка уже
      // показывается по фразам, второе сообщение о том же было бы шумом.
      .catch(() => { if (!cancelled) setSecondName(null) })
    return () => { cancelled = true }
  }, [indexNumber, secondLang])

  // Смена вещества переустанавливает имя, CAS и EC: иначе на новой этикетке
  // остаётся имя предыдущего вещества.
  //
  // ⚠⚠ EC СЮДА НЕ ВХОДИЛ, и это был отдельный дефект: у нового вещества EC
  // приходил новым пропом, а состояния под него не было вовсе — номер шёл на
  // этикетку прямо из пропа, минуя и сброс, и разбор.
  useEffect(() => {
    setProductName(displayName)
    // ⚠ Метка «это подставили мы» переставляется вместе с именем: иначе имя
    // нового вещества считалось бы набранным вручную и смена языка его не
    // трогала бы — на немецкой этикетке осталось бы английское имя.
    autoNameRef.current = displayName
    productNameRef.current = displayName
    setCasOnLabel(casNumber)
    setEcOnLabel(ecNumber ?? '')
  }, [displayName, casNumber, ecNumber])

  // Смена юрисдикции переключает единицы и набор пресетов, но НЕ трогает уже
  // выбранный физический размер: человек выбирал его под свою пачку наклеек.
  //
  // ⚠⚠ ПЕРВЫЙ ПРОГОН ПРОПУСКАЕТСЯ, КОГДА РАЗМЕР ЗАДАН СТРАНИЦЕЙ. Эффект с
  // зависимостью [jurisdictionKey] срабатывает и на монтировании, и без этого
  // предохранителя он затирал единицу формата сразу после первого кадра:
  // страница «210 × 148 mm» в режиме OSHA моргала миллиметрами и уезжала в
  // дюймы. Ловится это только глазами — ни типы, ни числа тут ничего не видят.
  const unitPinned = useRef(Boolean(preset))
  useEffect(() => {
    if (unitPinned.current) { unitPinned.current = false; return }
    setUnit(j.unit)
  }, [jurisdictionKey])

  const track = (event: string, params: Record<string, unknown> = {}) => {
    if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
      (window as any).gtag('event', event, params)
    }
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        if (data.supplierName) setSupplierName(data.supplierName)
        if (data.supplierAddress) setSupplierAddress(data.supplierAddress)
        if (data.supplierPhone) setSupplierPhone(data.supplierPhone)
      }
    } catch {}
    try {
      const saved = localStorage.getItem(LOGO_STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        if (data && typeof data.dataUrl === 'string' && typeof data.aspect === 'number') {
          setLogo({ dataUrl: data.dataUrl, aspect: data.aspect })
          if (typeof data.name === 'string') setLogoName(data.name)
        }
      }
    } catch {}
    track('label_editor_open', { cas: entryCas })
  }, [])

  const saveToStorage = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ supplierName, supplierAddress, supplierPhone }))
    } catch {}
  }

  // ── Размеры ───────────────────────────────────────────────────────────────
  const litres = capacityMl / 1000
  /** Юридический минимум — только там, где он есть (ЕС, Великобритания). */
  const tier = sizeTierForLitres(j, litres)
  /** Ориентир по объёму — есть всегда, в том числе для США и Канады. */
  const recTier = recommendedTierForLitres(litres)
  const smallRule = smallPackageRuleFor(j, capacityMl)

  /**
   * Помещается ли формат под ярус — с учётом ОБЕИХ ориентаций. Наклейка
   * 4 × 2 in под ярус 52 × 74 мм не подходит как есть, но подходит повёрнутой,
   * и отбрасывать её было бы неправдой.
   *
   * ⚠ Считает `labelSizeVerdict` — тот же, что печатает вердикт под превью.
   * Держать здесь ВТОРУЮ реализацию того же сравнения нельзя: до session 65 их
   * было четыре, и один формат получал у них разные ответы.
   */
  const fitsTierStrict = (m: { w: number; h: number }, t: SizeTier) =>
    labelSizeVerdict(t, m.w, m.h).meetsSides

  /**
   * ⚠⚠ ЭТО НАША ОЦЕНКА, А НЕ НОРМА, И ПОДПИСЫВАТЬ ЕЁ СООТВЕТСТВИЕМ НЕЛЬЗЯ.
   * В Table 1.3 про площадь ЭТИКЕТКИ нет ни слова: площадь появляется только в
   * §1.2.1.3 и только у пиктограммы. Прикидка нужна там, где закон размеров не
   * устанавливает вовсе (OSHA, WHMIS) — иначе на пол-литровую бутылку
   * подбиралась бы наклейка 4 × 4 in, потому что привычная 4 × 2 in не проходит
   * по одной стороне яруса CLP, хотя площади в ней в полтора раза больше.
   * Вторая проверка отсекает длинные узкие ленты: короткая сторона не может
   * быть меньше 70 % короткой стороны яруса.
   */
  const fitsTierByArea = (m: { w: number; h: number }, t: { labelMinW: number; labelMinH: number }) =>
    m.w * m.h >= t.labelMinW * t.labelMinH * 0.95
    && Math.min(m.w, m.h) >= Math.min(t.labelMinW, t.labelMinH) * 0.7

  /** Годность по правилам текущей юрисдикции: закон строже рекомендации. */
  const fitsTier = (m: { w: number; h: number }, t: SizeTier) =>
    tier ? fitsTierStrict(m, t) : fitsTierByArea(m, t)

  const stocks = useMemo(() => {
    const list = stockFor(j.region)
    // ⚠⚠ ФОРМАТЫ ПРЯЧУТСЯ ТОЛЬКО ТАМ, ГДЕ ЯРУС ОБЯЗАТЕЛЕН (session 65).
    // Прежняя строка `if (tier) return list.filter(…)` прятала их у ВСЕХ
    // ярусов таблицы — в том числе у ≤ 3 л, где таблица говорит «If possible».
    // Из-за этого в режиме CLP на пол-литровую бутылку не показывалась ни одна
    // наклейка 4 × 2 in, самая ходовая химическая заготовка, — хотя незаконной
    // она не является. Прячем только настоящий запрет (> 3 л).
    if (tier?.labelSidesBinding) return list.filter((s) => fitsTierStrict(stockMm(s), tier))
    const against = tier ?? recTier
    return [...list].sort((a, b) => {
      const fa = fitsTier(stockMm(a), against) ? 0 : 1
      const fb = fitsTier(stockMm(b), against) ? 0 : 1
      if (fa !== fb) return fa - fb
      if (a.chemical !== b.chemical) return a.chemical ? -1 : 1
      const ma = stockMm(a), mb = stockMm(b)
      return ma.w * ma.h - mb.w * mb.h
    })
  }, [j.region, tier?.key, recTier.key])

  const pickStock = (s: LabelStockItem) => {
    const m = stockMm(s)
    setSizeW(m.w); setSizeH(m.h); setStockId(s.id); setSheetNote('')
  }
  const pickClpMinimum = () => {
    if (!tier) return
    setSizeW(tier.labelMinW); setSizeH(tier.labelMinH); setStockId(null); setSheetNote('')
  }
  const rotate = () => {
    setSizeW(sizeH); setSizeH(sizeW); setStockId(null); setSheetNote('')
  }

  /**
   * ⚠⚠ Смена объёма тары ПЕРЕВЫБИРАЕТ размер этикетки.
   *
   * Раньше объём влиял только на подсказку, и в режиме OSHA — где размерных норм
   * нет вовсе — переключение «500 мл → 200 л» не меняло на экране ничего. Это
   * читается как сломанная кнопка, хотя формально всё верно. Теперь объём
   * подбирает наименьшую подходящую наклейку: под канистру — канистровую, под
   * бочку — бочковую.
   */
  const applyCapacity = (ml: number) => {
    setCapacityMl(ml)
    const rec = recommendedTierForLitres(ml / 1000)
    // ⚠ По сторонам подбираем только там, где ярус ОБЯЗАТЕЛЕН. У ≤ 3 л таблица
    // говорит «If possible» — там прикидка по площади честнее: она не
    // отбрасывает ходовую 4 × 2 in ради размера, которого закон не требует.
    const ok = tier?.labelSidesBinding ? fitsTierStrict : fitsTierByArea
    const candidates = stockFor(j.region)
      .filter((st) => st.chemical && st.sheet !== 'roll' && ok(stockMm(st), rec))
      .sort((a, b) => {
        const ma = stockMm(a), mb = stockMm(b)
        return ma.w * ma.h - mb.w * mb.h
      })
    const best = candidates[0]
    const bestArea = best ? stockMm(best).w * stockMm(best).h : Infinity
    // ⚠ Сам ярусный размер — тоже кандидат, и часто лучший. В европейском списке
    // химстойкие наклейки начинаются с 210 × 148 мм, и без этой строки на
    // пол-литровую бутылку подбиралась бы этикетка с половину листа A4.
    if (best && bestArea <= rec.labelMinW * rec.labelMinH * 1.6) {
      const m = stockMm(best)
      // ⚠ Переворачиваем формат ТОЛЬКО там, где ярус обязателен по закону и
      // как есть не проходит. Где это лишь рекомендация — оставляем ориентацию
      // каталога: Avery 60505 продаётся как 4 × 2 in, и разворачивать её в
      // 2 × 4 значит спорить с пачкой, которая лежит у человека на столе.
      const asIs = tier?.labelSidesBinding ? (m.w >= rec.labelMinW - 0.5 && m.h >= rec.labelMinH - 0.5) : true
      setSizeW(asIs ? m.w : m.h)
      setSizeH(asIs ? m.h : m.w)
      setStockId(best.id)
    } else {
      setSizeW(rec.labelMinW); setSizeH(rec.labelMinH); setStockId(null)
    }
    setSheetNote('')
  }

  const toUnit = (mm: number) => (unit === 'in' ? Math.round((mm / MM_PER_INCH) * 1000) / 1000 : Math.round(mm * 10) / 10)
  const fromUnit = (v: number) => (unit === 'in' ? v * MM_PER_INCH : v)
  const fmt = (mm: number) => (unit === 'in' ? inchLabel(mm / MM_PER_INCH) : String(Math.round(mm * 10) / 10))

  const selectedStock = stockId ? stocks.find((s) => s.id === stockId) ?? null : null

  // ── Сборка этикетки ───────────────────────────────────────────────────────
  const shownP = pStatements.filter((p) => selectedP.includes(p.code))
  // Отмеченные всегда наверху списка: иначе выбранная фраза уезжает вниз, и
  // человек не видит, что именно он уже набрал.
  const visibleP = (() => {
    const q = pQuery.trim().toLowerCase()
    const matched = q
      ? pStatements.filter((p) => (p.code + ' ' + p.text_en).toLowerCase().includes(q))
      : pStatements
    const chosen = matched.filter((p) => selectedP.includes(p.code))
    const rest = matched.filter((p) => !selectedP.includes(p.code))
    const tail = q || showAllP ? rest : rest.slice(0, Math.max(0, 12 - chosen.length))
    return [...chosen, ...tail]
  })()
  const notes: string[] = []
  if (purpose === 'small' && smallRule?.keep.includes('outerPackageNote')) {
    notes.push('Full label information is provided on the immediate outer package.')
  }
  if (purpose === 'workplace' && wpOption.elements.includes('sdsAvailableNote')) {
    notes.push('A safety data sheet for this product is available in the workplace.')
  }

  // ── Второй язык на этикетке ───────────────────────────────────────────────
  // ⚠⚠ Во второй блок попадают ТОЛЬКО фразы с официальным текстом. Кода нет в
  // `statement_translations` — строка остаётся одной английской, и панель ниже
  // называет такие фразы поимённо. Подставить машинный перевод или склеить его
  // из базовой фразы нельзя: у текста на этикетке есть установленная редакция.
  //
  // ⚠ Сигнальное слово во втором блоке — `null`. Его официальные переводы лежат
  // в Annex I, а не в Annex III/IV, и у нас их пока нет. См. labelLanguages.ts.
  /**
   * ⚠⚠ ФРАЗЫ ПРОХОДЯТ ЧЕРЕЗ `renderStatement` ПЕРЕД ПЕЧАТЬЮ — ВСЕГДА, ОБА БЛОКА.
   *
   * До этого английский блок брал зачищенный `text_plain`, а второй язык —
   * полный официальный текст, и на живой этикетке анилина немецкая строка
   * печатала «<Expositionsweg angeben, sofern schlüssig belegt ist…>» дословно.
   * Угловые скобки — указание поставщику, а не текст на этикетку.
   *
   * ⚠ Роль слота, а не его номер: в венгерском H372 пропуск пути воздействия
   * идёт ПЕРВЫМ, а органов — вторым, наоборот к остальным 23 языкам.
   */
  /**
   * ⚠⚠ ОФИЦИАЛЬНЫЙ ТЕКСТ ФРАЗЫ НА ОСНОВНОМ ЯЗЫКЕ, С ОТКАТОМ НА АНГЛИЙСКИЙ.
   *
   * Откат — не запасной вариант «на всякий случай», а единственный законный
   * ответ там, где официального текста НЕ СУЩЕСТВУЕТ: у кодов, которых нет в
   * CLP вовсе (изъятые прежними ATP и принятые UN GHS, но не ЕС), языковые
   * версии не печатают ничего ни на одном языке.
   *
   * ⚠⚠ ЗДЕСЬ ПРИМЕРОМ СТОЯЛИ СУФФИКСНЫЕ ФОРМЫ — И ЭТО БЫЛО НЕВЕРНО. H350i,
   * H360F, H361f и остальные шесть регламент публикует отдельными строками, в
   * Annex VI Part 1 §1.1.2.1.2. Session 53 залила все девять на 23 языках, и
   * откат на английский у них больше не срабатывает.
   * ⚠⚠ Правило же остаётся: склеить перевод суффиксной формы из перевода
   * базовой — значит сочинить юридический текст, и делать этого нельзя.
   *
   * ⚠ Молчать про откат нельзя: панель ниже называет такие коды поимённо.
   * Одноязычная этикетка, где одна строка вдруг по-английски, выглядит как
   * недоделка, а является требованием.
   */
  const primaryText = (code: string, fallback: string): string =>
    (primaryLang === 'EN' ? fallback : primaryTexts[code]) ?? fallback

  /** Коды, у которых официального текста на основном языке нет. */
  /**
   * Имя основного языка для подписей полей.
   *
   * ⚠⚠ ПОДПИСЬ БЫЛА ЗАШИТА СЛОВОМ «English». Пока основной язык был всегда
   * английским, это было верно; с выбором языка подпись «Organs affected ·
   * English» встала бы над полем, значение которого печатается в НЕМЕЦКОМ
   * блоке. Человек ввёл бы «liver, kidneys» туда, где нужно «Leber, Nieren».
   */
  const primaryLangName = LANGUAGE_BY_CODE.get(primaryLang)?.name ?? primaryLang

  const primaryMissing = primaryLang === 'EN'
    ? []
    : [...hStatements, ...shownP].filter((x) => !primaryTexts[x.code]).map((x) => x.code)

  const renderedH = hStatements.map(
    (h) => renderStatement(primaryText(h.code, h.text_en), h.code, primaryLang, phValues))
  const renderedSecondH = hStatements
    .filter((h) => secondTexts[h.code])
    .map((h) => renderStatement(secondTexts[h.code], h.code, secondLang ?? 'EN', phValuesSecond))

  /**
   * Какие поля ввода вообще показывать — по кодам этой этикетки.
   * ⚠ Язык значим: в венгерском H372 пропуск пути воздействия идёт ПЕРВЫМ, а
   * органов вторым — наоборот к остальным 23 языкам.
   */
  const phRoles = rolesForCodes(hStatements.map((h) => h.code), primaryLang)

  /**
   * Что панель соответствия говорит про незаполненное.
   *
   * ⭐ Зачищенный английский текст молча терял требование регламента: «Causes
   * damage to organs» вместо «Causes damage to organs <or state all organs
   * affected, if known>». Этикетка выглядела полной, а обязанность поставщика с
   * неё исчезала. Панель возвращает её на место — словами про обязанность, а не
   * про наше действие.
   */
  const phIssues = phRoles
    .filter((role) => !String(phValues[role] ?? '').trim())
    .map((role) => ({
      level: (roleIsRequired(role) ? 'error' : 'warning') as 'error' | 'warning',
      text: ROLE_OBLIGATION[role],
      citation: 'CLP Annex III',
    }))
  // ⚠ Второй язык проверяется ОТДЕЛЬНО: заполнить английское поле и забыть
  // немецкое — самый вероятный способ ошибиться, и молча это выглядит нормально.
  if (secondLang && phRoles.some((r) => String(phValues[r] ?? '').trim())) {
    const missing = phRoles.filter(
      (r) => String(phValues[r] ?? '').trim() && !String(phValuesSecond[r] ?? '').trim(),
    )
    if (missing.length > 0) {
      phIssues.push({
        level: 'warning',
        text: `Named in English but not in ${LANGUAGE_BY_CODE.get(secondLang)?.name ?? secondLang}: `
          + `${missing.join(', ')}. Both language blocks must say the same thing.`,
        citation: 'CLP Art. 17(2)',
      })
    }
  }

  /**
   * ⚠⚠ P-ФРАЗЫ ТОЖЕ ПРОХОДЯТ ЧЕРЕЗ ОТРИСОВКУ, И ОБА БЛОКА.
   *
   * Знак пропуска здесь не скобка, а многоточие — поэтому проверки на `<` и `>`
   * его не ловили. Задето 3 221 вещество из 4 178 (77 %), вдвое больше, чем
   * H-фразами. ⚠ Опущение тут чаще ПОЛОМКА, а не законный вариант: у H-фраз
   * пропуск был обстоятельством, у P-фраз — дополнением при глаголе или
   * предлоге («Keep wetted with.», «Use to extinguish.»). Поэтому фраза с
   * незаполненным обязательным пропуском НЕ ПЕЧАТАЕТСЯ.
   */
  const renderedP = shownP.map((p) => renderPStatement(
    primaryText(p.code, p.text_en), p.code, primaryLang,
    pValues[p.code] ?? [], pBrackets[p.code] ?? false))
  const renderedSecondP = shownP
    .filter((x) => secondTexts[x.code])
    .map((p) => renderPStatement(
      secondTexts[p.code], p.code, secondLang ?? 'EN',
      pValuesSecond[p.code] ?? [], pBrackets[p.code] ?? false))

  /** Коды на этикетке, у которых есть что заполнить или что включить. */
  const pFillable = shownP.filter((p) => hasPSlots(p.code) || hasPBracket(p.code))

  const pIssues = renderedP
    .map((r, i) => ({ r, code: shownP[i].code }))
    .filter((x) => x.r.missing.length > 0)
    .map((x) => ({
      level: 'error' as const,
      text: `${x.code} is not printed: ${pConditions[x.code]
        ?? 'CLP Annex IV requires the supplier to complete this statement'}`,
      citation: 'CLP Annex IV, column (5)',
    }))

  const secondH = hStatements.filter((h) => secondTexts[h.code])
  const secondP = shownP.filter((x) => secondTexts[x.code])
  const missingSecond = secondLang
    ? [...hStatements, ...shownP].filter((x) => !secondTexts[x.code]).map((x) => x.code)
    : []
  /**
   * ⭐ Сигнальное слово второго языка. Уровень берётся из классификации, а не из
   * английского слова: `signalLevel` — то же поле, по которому движок красит
   * рамку.
   * ⚠ `null` — законный ответ: у ирландского сигнального слова нет источника
   * вовсе (консолидированного CLP на ирландском не существует), и тогда второй
   * блок печатается без слова, как было до session 48.
   */
  const signalLevel: 'danger' | 'warning' | null =
    signalWord ? (/danger/i.test(signalWord) ? 'danger' : 'warning') : null
  const secondSignal = signalWordFor(secondTexts, signalLevel)
  /**
   * ⚠⚠ СИГНАЛЬНОЕ СЛОВО ОСНОВНОГО БЛОКА — ТОЖЕ ИЗ ТАБЛИЦЫ, А НЕ ИЗ ПРОПА.
   *
   * `signalWord` приходит английским словом из `substances.signal_word`; на
   * немецкой этикетке должно стоять «Gefahr». Уровень при этом берётся из
   * КЛАССИФИКАЦИИ (`signalLevel`), а не разбирается из напечатанного слова —
   * иначе `/danger/i` на «Gefahr» не сработал бы и рамка ушла бы в янтарный.
   *
   * ⚠ `null` здесь означает «официального слова на этом языке у нас нет».
   * Для основного языка это недопустимо, и панель ниже говорит об этом прямо;
   * попасть сюда можно только ошибкой загрузки — ирландского в списке основных
   * нет вовсе.
   */
  const primarySignal = primaryLang === 'EN'
    ? (signalWord ?? null)
    : signalWordFor(primaryTexts, signalLevel)
  /**
   * ⚠⚠ Равноправная подача второго языка — решение НОРМЫ, а не пользователя.
   * Правило одно: равноправно там, где рынок требует более одного языка.
   * Канада проходит по `requiredLanguages`, Бельгия и остальные — по таблице
   * рынков. Особый случай для Канады, написанный вторым местом, однажды разошёлся
   * бы с первым, поэтому его здесь нет.
   */
  const secondEqual = secondLanguageIsEqual(jurisdictionKey, market, j.requiredLanguages)

  const second = secondLang && (secondH.length > 0 || secondP.length > 0)
    ? {
        langTag: secondLang,
        signalWord: secondSignal,
        // ⚠ Обязательный элемент по ст. 17(1)(c) + 17(2). `undefined` означает
        // «перевода имени нет» — движок тогда второй строки не печатает.
        productName: secondName ?? undefined,
        equal: secondEqual,
        // ⚠ Уже отрисованные: без указаний поставщику и с уточнением в коде.
        // `suppressed` выбрасывается — фраза, у которой не назвали обязательное,
        // на этикетке не нужна вовсе (EUH208 без имени: «Contains.»).
        hStatements: renderedSecondH
          .filter((r) => !r.suppressed)
          .map((r) => ({ code: r.code, text: r.text })),
        // ⚠ Код берётся ДО фильтра: после `filter` индекс уже не совпадает с
        // исходным массивом, и коды поехали бы относительно текстов.
        pStatements: secondP
          .map((x, i) => ({ code: x.code, r: renderedSecondP[i] }))
          .filter((x) => x.r && !x.r.suppressed)
          .map((x) => ({ code: x.code, text: x.r.text })),
        combinedPText: pFormat === 'combined'
          ? renderedSecondP.filter((r) => !r.suppressed).map((r) => r.text).join(' ')
          : undefined,
      }
    : undefined

  // ── Имя вещества на основном языке ────────────────────────────────────────
  /**
   * ⚠⚠ ПРИМЕЧАНИЕ КЛАССА `composition` ДОПИСЫВАЕТСЯ К ИМЕНИ ПРИ ПЕЧАТИ, А НЕ
   * КЛАДЁТСЯ В ПОЛЕ ВВОДА.
   *
   * По Annex VI Part 1 п. 1.1.1.4 ссылка на примесь — часть имени и печатается
   * ОБЯЗАТЕЛЬНО. Положи мы её в редактируемое поле, человек стёр бы её вместе с
   * остальным текстом, набирая своё торговое название, и обязательный элемент
   * исчез бы молча. Держи мы её только в движке — поле показывало бы одно, а
   * PDF печатал другое. Поэтому: дописывается при печати, и панель показывает,
   * что именно встанет на бумагу.
   *
   * ⚠ Защита от удвоения: если человек уже вписал этот текст руками, второй раз
   * не дописываем.
   */
  const compositionSuffix = names ? printedNameSuffix(names.annotations) : ''
  const compositionText = compositionSuffix.replace(/^\s*\[|\]\s*$/g, '')
  const productNameOnLabel = compositionSuffix && !productName.includes(compositionText)
    ? nameForLabel(productName, names?.annotations ?? [])
    : productName

  /**
   * Формы имени на основном языке.
   * ⚠ Откат на `nameVariants` — только когда строки переводов нет вовсе
   * (3 записи из 4 178) или вещество вообще не из базы.
   */
  const localisedForms = names
    ? formChoices(names, nameVariants ?? [])
    : (nameVariants ?? []).map((v) => ({ name: v.name, index: v.index, cas: v.cas, ec: v.ec }))
  const nameHints = names ? identityHints(names.annotations) : []
  /** Текст, из-за которого разбор этой записи объявлен ненадёжным, или `null`. */
  const nameNotice = names ? unreliableReason(names.annotations) : null

  // ── ДВИЖОК ОТБОРА P-ФРАЗ И ЗАМЕР ВЛЕЗАЕМОСТИ ──────────────────────────────
  /**
   * ⚠⚠ ВХОД СОБИРАЕТСЯ ИЗ H-КОДОВ, А НЕ ИЗ `pStatements`. `pStatements` — это
   * то, что Annex VI перечислил для вещества (или что человек отметил руками),
   * и оно уже неполно: у смеси там пусто, а у вещества — плоский список без
   * пар и без уровней. Классы опасности движок выводит сам, из H-кодов и
   * сигнального слова.
   *
   * ⚠⚠ БЛОК СТОИТ ЗДЕСЬ, А НЕ В НАЧАЛЕ КОМПОНЕНТА, И ЭТО НЕ ПЕРЕСТАНОВКА РАДИ
   * ПОРЯДКА. Замеру нужны отрисованные фразы, имя на языке, сигнальное слово,
   * пиктограммы и размер этикетки — то есть почти всё, что вычисляется выше.
   * Оставь вызов наверху, и замер пришлось бы собирать из вторых копий тех же
   * значений, а вторая копия расходится с первой примерно через месяц.
   */
  const precedenceInput = useMemo(
    () => ({
      hCodes: hStatements.map((h) => h.code),
      signalWord,
      audience,
      containerMl: capacityMl,
    }),
    [hStatements, signalWord, audience, capacityMl],
  )

  /**
   * Языки, на которых этикетка реально печатается.
   *
   * ⚠⚠ ВТОРОЙ ЯЗЫК СЧИТАЕТСЯ ВЫБРАННЫМ ТОЛЬКО ПРИ ЗАГРУЖЕННЫХ ПЕРЕВОДАХ. Пустая
   * карта означает, что второго блока на этикетке нет вовсе — и мерить его
   * место значит отнять его у фраз без причины.
   *
   * ⛔ Условие НЕ смотрит на `second`: тот собран из `shownP`, то есть из уже
   * отобранного набора, а замер обязан посчитаться ДО отбора. Ссылка на него
   * замкнула бы круг «отбор → замер → отбор».
   */
  const labelLangs = useMemo(
    () => (secondLang && Object.keys(secondTexts).length > 0
      ? [primaryLang, secondLang]
      : [primaryLang]),
    [primaryLang, secondLang, secondTexts],
  )

  /**
   * ⚠⚠ ТЕКСТ ФРАЗЫ ДЛЯ ЗАМЕРА — ТОТ ЖЕ, ЧТО ДЛЯ ПЕЧАТИ, НО ПОДАВЛЕННАЯ ФРАЗА
   * МЕРЯЕТСЯ ОФИЦИАЛЬНЫМ ТЕКСТОМ.
   *
   * Фраза с незаполненным обязательным пропуском («Wash … thoroughly after
   * handling») сейчас не печатается. Посчитай мы её нулём — замер пообещал бы
   * место, которое исчезнет ровно в тот момент, когда поставщик заполнит поле.
   * Замер обязан ошибаться в сторону осторожности, а не в сторону обещаний.
   */
  const measuredText = (src: string, code: string, lang: string, values: string[]): string => {
    const r = renderPStatement(src, code, lang, values, pBrackets[code] ?? false)
    return r.suppressed || !r.text.trim() ? src : r.text
  }

  const fitCtx: FitProbeContext = {
    langs: labelLangs,
    byLang: Object.fromEntries(labelLangs.map((lang) => {
      const isPrimary = lang === primaryLang
      return [lang, {
        signalWord: isPrimary ? primarySignal : secondSignal,
        productName: isPrimary ? productNameOnLabel : (secondName ?? undefined),
        // ⚠ H-блок берётся ГОТОВЫМ: он от числа P-фраз не зависит, а второй
        // отрисовки того же текста в проекте быть не должно.
        hStatements: (isPrimary ? renderedH : renderedSecondH)
          .filter((r) => !r.suppressed)
          .map((r) => ({ code: r.code, text: r.text })),
        pText: Object.fromEntries(pStatements.map((p) => {
          const src = isPrimary ? primaryText(p.code, p.text_en) : (secondTexts[p.code] ?? p.text_en)
          const values = isPrimary ? (pValues[p.code] ?? []) : (pValuesSecond[p.code] ?? [])
          return [p.code, measuredText(src, p.code, lang, values)]
        })),
      }]
    })),
    fallbackP: Object.fromEntries(pStatements.map((p) => [p.code, p.text_en])),
    productName: productNameOnLabel,
    casNumber: casOnLabel,
    ecNumber: ecOnLabel,
    nominalQty,
    batchNumber,
    ufiCode,
    signalLevel,
    pictograms: pictograms.map((p) => ({ code: p.code, svg: p.svg_content ?? '' })),
    pFormat,
    supplier: { name: supplierName, address: supplierAddress, phone: supplierPhone },
    logo: logo ?? undefined,
    notes,
    secondEqual,
    options: {
      jurisdiction: jurisdictionKey,
      purpose,
      workplaceOption,
      widthMm: Math.max(15, sizeW),
      heightMm: Math.max(15, sizeH),
      containerLitres: litres,
      containerMl: capacityMl,
      // ⭐⭐ ПОЛЗУНОК КЕГЛЯ ВХОДИТ В ЗАМЕР. Человек увеличил шрифт — фраз
      // влезает меньше, и число обязано это показать. Замер по автоподбору
      // обещал бы место, которого при поднятом кегле уже нет.
      bodyScale,
    },
  }

  /**
   * ⚠⚠ КЛЮЧ ПЕРЕСЧЁТА ЗАМЕРА. Замер стоит десятков раскладок, а `fitCtx`
   * собирается литералом на каждом кадре. Без ключа он считался бы заново на
   * каждый символ, набранный в поле имени поставщика.
   *
   * ⚠ В ключ входит всё, от чего зависит РАСКЛАДКА: размер, кегль, языки,
   * число пиктограмм и H-фраз, длина имени, заполненные пропуски. Загрузка
   * переводов видна по числу ключей в карте — она приходит асинхронно и обязана
   * пересчитать замер.
   */
  const fitProbe: FitProbe = {
    measure: (codes) => measureFitCapacity(fitCtx, codes),
    key: JSON.stringify([
      labelLangs, sizeW, sizeH, bodyScale, jurisdictionKey, purpose, workplaceOption,
      litres, capacityMl, pFormat, pictograms.length, hStatements.length,
      pStatements.map((p) => p.code), productNameOnLabel.length, (secondName ?? '').length,
      Object.keys(primaryTexts).length, Object.keys(secondTexts).length,
      supplierName.length + supplierAddress.length + supplierPhone.length,
      notes.length, Boolean(logo), secondEqual, pValues, pValuesSecond, pBrackets,
    ]),
  }

  const precedence = usePPrecedence(precedenceInput, hStatements.length > 0, fitProbe)

  /**
   * Ответ движка становится набором на этикетке — но только пока человек не
   * правил набор руками.
   */
  useEffect(() => {
    if (pTouched.current || !precedence.result) return
    setSelectedP(precedence.result.selected.map((u) => u.code))
  }, [precedence.result])

  const labelInput: LabelInput = {
    productName: productNameOnLabel,
    casNumber: casOnLabel,
    ecNumber: ecOnLabel,
    nominalQty,
    batchNumber,
    ufiCode,
    signalWord: primarySignal,
    /**
     * ⚠⚠ Степень опасности передаётся ОТДЕЛЬНЫМ ПОЛЕМ, а не выводится движком
     * из напечатанного слова. Основной язык теперь выбирается, на этикетке
     * стоит «Gefahr» или «Vaara», и разбор строки отдал бы для немецкого Danger
     * янтарный цвет. Цвет рамки и цвет слова берутся из этого поля.
     * ⭐ Поле заведено в session 48 заранее, ровно под этот день.
     */
    signalLevel,
    pictograms: pictograms.map((p) => ({ code: p.code, svg: p.svg_content ?? '' })),
    hStatements: renderedH
      .filter((r) => !r.suppressed)
      .map((r) => ({ code: r.code, text: r.text })),
    // ⚠ Пара «код + текст» собирается ДО фильтра — иначе коды съедут.
    pStatements: shownP
      .map((p, i) => ({ code: p.code, r: renderedP[i] }))
      .filter((x) => x.r && !x.r.suppressed)
      .map((x) => ({ code: x.code, text: x.r.text })),
    pFormat,
    combinedPText: pFormat === 'combined'
      ? renderedP.filter((r) => !r.suppressed).map((r) => r.text).join(' ')
      : undefined,
    hiddenPCount: pStatements.length - shownP.length,
    supplier: { name: supplierName, address: supplierAddress, phone: supplierPhone },
    logo: logo ?? undefined,
    second,
    notes,
  }

  const layout = layoutLabel(labelInput, {
    jurisdiction: jurisdictionKey,
    purpose,
    // ⚠ Движок читает это поле только при `purpose === 'workplace'`.
    workplaceOption,
    widthMm: Math.max(15, sizeW),
    heightMm: Math.max(15, sizeH),
    containerLitres: litres,
    containerMl: capacityMl,
    bodyScale,
  })
  const previewSvg = renderSvg(layout)
  const fit = layout.fit
  /**
   * ⚠ Замечания про пропуски встают ПОСЛЕ проверок движка, а не вместо них:
   * движок видит только готовые строки и о незаполненном знать не может —
   * значения живут здесь, рядом с полями ввода.
   */
  const allIssues = [...layout.issues, ...phIssues, ...pIssues]

  const fileBase = `GHS-label-${(entryCas || 'label').replace(/[^\w.-]+/g, '-')}-${j.key}`

  const confirmDownload = () => {
    if (!agreed) { setSubmitError('Please confirm the disclaimer.'); return }
    setSubmitError('')
    saveToStorage()
    setSubmitted(true)
    track('label_download_unlocked', { cas: entryCas, jurisdiction: j.key })
  }
  const handleSvg = () => {
    downloadLabelSvg(layout, `${fileBase}.svg`)
    track('label_download', { format: 'svg', cas: entryCas, jurisdiction: j.key })
  }
  /**
   * ⚠⚠ ОШИБКА ПЕЧАТИ ПОКАЗЫВАЕТСЯ ЧЕЛОВЕКУ, А НЕ ТОЛЬКО КОНСОЛИ.
   *
   * Пока сбой уходил в `console.error`, кнопка вела себя как неисправная:
   * нажатие есть, ответа нет, и понять, что случилось, можно было только через
   * F12. Так дефект с дублем width/height у пиктограмм (см. `labelEngine`)
   * прожил незамеченным, хотя выбивал PDF у 3 385 веществ из 4 178.
   */
  const handlePdf = async () => {
    setDownloadError('')
    setPdfBusy(true)
    try {
      await downloadLabelPdf(layout, `${fileBase}.pdf`)
      track('label_download', { format: 'pdf', cas: entryCas, jurisdiction: j.key })
    } catch (e) {
      console.error('PDF download failed', e)
      setDownloadError(`PDF could not be generated: ${e instanceof Error ? e.message : String(e)}. The SVG download is unaffected — please use it and let us know.`)
    } finally {
      setPdfBusy(false)
    }
  }
  const handleSheet = async () => {
    if (!selectedStock || selectedStock.sheet === 'roll') return
    const sheet = SHEET_MM[selectedStock.sheet]
    setDownloadError('')
    try {
      const res = await downloadLabelSheetPdf(
        layout,
        { widthMm: sheet.w, heightMm: sheet.h, name: SHEET_NAME[selectedStock.sheet] },
        `${fileBase}-sheet.pdf`,
      )
      setSheetNote(`${res.perSheet} labels per sheet (${res.cols} × ${res.rows})`)
      track('label_download', { format: 'sheet_pdf', cas: entryCas, jurisdiction: j.key })
    } catch (e) {
      console.error('Sheet PDF failed', e)
      setDownloadError(`Sheet PDF could not be generated: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const trackSdsAffiliateClick = () =>
    track('affiliate_click', { partner: 'sds_manager', placement: 'label_constructor', cas: entryCas })

  // ── Логотип ───────────────────────────────────────────────────────────────
  const MAX_LOGO_DIM = 600
  const processLogoFile = (file: File) => {
    setLogoError('')
    if (!/^image\/(png|jpeg)$/.test(file.type)) { setLogoError('Please use a PNG or JPEG image.'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result || '')
      const img = new Image()
      img.onload = () => {
        const w = img.naturalWidth || img.width
        const h = img.naturalHeight || img.height
        if (!w || !h) { setLogoError('Could not read that image.'); return }
        const scale = Math.min(1, MAX_LOGO_DIM / Math.max(w, h))
        const cw = Math.max(1, Math.round(w * scale))
        const ch = Math.max(1, Math.round(h * scale))
        const canvas = document.createElement('canvas')
        canvas.width = cw; canvas.height = ch
        const ctx = canvas.getContext('2d')
        if (!ctx) { setLogoError('Could not process that image.'); return }
        ctx.drawImage(img, 0, 0, cw, ch)
        const dataUrl = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9)
        setLogo({ dataUrl, aspect: cw / ch })
        setLogoName(file.name)
        try { localStorage.setItem(LOGO_STORAGE_KEY, JSON.stringify({ dataUrl, aspect: cw / ch, name: file.name })) } catch {}
        track('label_logo_added', { cas: entryCas })
      }
      img.onerror = () => setLogoError('Could not read that image.')
      img.src = src
    }
    reader.onerror = () => setLogoError('Could not read that file.')
    reader.readAsDataURL(file)
  }
  const onLogoInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0]
    if (f) processLogoFile(f)
    e.target.value = ''
  }
  const onLogoDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragActive(false)
    const f = e.dataTransfer.files && e.dataTransfer.files[0]
    if (f) processLogoFile(f)
  }
  const removeLogo = () => {
    setLogo(null); setLogoName(''); setLogoError('')
    try { localStorage.removeItem(LOGO_STORAGE_KEY) } catch {}
  }

  const purposeTabs: { key: LabelPurpose; label: string; hint: string }[] = [
    { key: 'supplier', label: 'Shipped container', hint: 'full supplier label' },
    { key: 'workplace', label: 'Workplace / secondary', hint: 'decanted inside your site' },
    { key: 'small', label: 'Small container', hint: 'reduced label information' },
  ]

  return (
    <>
      {/* ── Юрисдикция и вид этикетки ─────────────────────────────────────── */}
      <section className="mb-6 rounded-xl border-2 border-[#062A78] bg-blue-50 p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Where the product is sold or used</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {JURISDICTION_ORDER.map((key) => {
            const jj = JURISDICTIONS[key]
            const active = key === jurisdictionKey
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setJurisdictionKey(key); track('label_jurisdiction', { jurisdiction: key }) }}
                className={`cursor-pointer rounded-lg border-2 px-3 py-2 text-left transition-colors ${
                  active ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-900 hover:border-[#062A78]'
                }`}
              >
                <span className="block text-sm font-semibold">{jj.tag}</span>
                <span className={`block text-[11px] ${active ? 'text-blue-100' : 'text-gray-500'}`}>
                  {key === 'osha' ? 'United States' : key === 'clp' ? 'European Union' : key === 'whmis' ? 'Canada' : 'Great Britain'}
                </span>
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {purposeTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setPurpose(t.key)}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                purpose === t.key ? 'border-[#062A78] bg-white font-semibold text-[#062A78]' : 'border-gray-300 bg-white/70 text-gray-600 hover:border-[#062A78]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-gray-600">{j.languageNote}</p>

        {/* ── РЫНОК ────────────────────────────────────────────────────────
            ⚠⚠ Спрашиваем ТОЛЬКО там, где официальных языков больше одного.
            Выпадашка «выберите страну» на 27 стран, из которых у 21 ответ один
            и тот же, — это вопрос ради вопроса: человек тратит выбор, а на
            этикетке ничего не меняется. Показываем пять стран, где меняется. */}
        {marketsFor(jurisdictionKey).length > 0 && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Market with more than one official language
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setMarket(null)}
                className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  market === null ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-[#062A78]'
                }`}
              >not specified</button>
              {marketsFor(jurisdictionKey).map((m) => (
                <button
                  key={m.code}
                  type="button"
                  onClick={() => {
                    setMarket(m.code)
                    /**
                     * ⭐ Ставится ПАРА ЦЕЛИКОМ — и основной язык, и второй.
                     * ⚠⚠ До появления выбора основного языка сюда шёл только
                     * второй, и притом «любой, кроме английского»: первый блок
                     * всё равно был английским. Для Бельгии это давало EN + NL
                     * там, где рынку нужны NL + FR. Теперь пара берётся из
                     * таблицы рынков как есть.
                     */
                    const pair = suggestedPairFor(m.code)
                    if (pair) {
                      const [first, second] = pair
                      setPrimaryLang(first)
                      setSecondLang(second)
                      track('label_primary_language', { lang: first })
                      track('label_second_language', { lang: second })
                    }
                    track('label_market', { market: m.code })
                  }}
                  className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    market === m.code ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-[#062A78]'
                  }`}
                >{m.name} · {m.languages.join('/')}</button>
              ))}
            </div>
            {market && MARKET_BY_CODE.get(market) && (
              <p className={`mt-2 rounded border px-2 py-1.5 text-[11px] leading-relaxed ${
                MARKET_BY_CODE.get(market)!.certainty === 'required'
                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}>
                {MARKET_BY_CODE.get(market)!.note}{' '}
                <span className="text-gray-500">{MARKET_BY_CODE.get(market)!.citation}</span>
              </p>
            )}
          </div>
        )}

        {/* ⚠⚠ ЧЕСТНО ПРО НЕСОВПАДЕНИЕ ЯЗЫКОВ С РЫНКОМ.
            Прежде здесь стояло «выбор основного языка не построен». Он построен,
            и проверять теперь надо другое: человек мог выбрать рынок, а потом
            руками поставить языки, которых этот рынок не требует. Молчать об
            этом нельзя — он выбрал «Belgium», увидел два равноправных блока и
            решил, что получил бельгийскую этикетку. */}
        {(() => {
          const m = market ? MARKET_BY_CODE.get(market) : null
          if (!m) return null
          const want = m.languages.slice(0, 2)
          const have = [primaryLang, secondLang].filter(Boolean) as string[]
          const missing = want.filter((c) => !have.includes(c))
          if (missing.length === 0) return null
          const nameOf = (c: string) => LANGUAGE_BY_CODE.get(c)?.name ?? c
          return (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
              ⚠ This label carries {have.map(nameOf).join(' + ') || 'one language'}, but {m.name} is listed
              with {m.languages.map(nameOf).join(', ')}. Missing: {missing.map(nameOf).join(', ')}.{' '}
              <span className="text-gray-600">{m.citation}</span>
            </p>
          )
        })()}

        {/* ── ОСНОВНОЙ ЯЗЫК ────────────────────────────────────────────────
            ⚠⚠ Стоит ПЕРЕД вторым языком намеренно: это порядок чтения самой
            этикетки. Панель второго языка ниже ссылается на выбранный здесь. */}
        <div className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Primary label language
            </p>
            {primaryLoading && <span className="text-[11px] text-gray-400">loading official texts…</span>}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestedPrimaryLanguages(jurisdictionKey).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => { setPrimaryLang(code); track('label_primary_language', { lang: code }) }}
                className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  primaryLang === code ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-[#062A78]'
                }`}
              >{LANGUAGE_BY_CODE.get(code)?.native ?? code}</button>
            ))}
            <select
              value={suggestedPrimaryLanguages(jurisdictionKey).includes(primaryLang) ? '' : primaryLang}
              onChange={(e) => { const v = e.target.value; if (v) { setPrimaryLang(v); track('label_primary_language', { lang: v }) } }}
              aria-label="Primary label language"
              className="cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
            >
              {/* ⚠⚠ ЧИСЛО СЧИТАЕТСЯ ИЗ СПИСКА, А НЕ ВПИСАНО. Раньше здесь стояло «23»
                  буквами. В день, когда закроется №13 и ирландский вернётся в
                  PRIMARY_LANGUAGES, список станет из 24 — а надпись осталась бы
                  «all 23», и это утверждение о регламенте, сделанное опечаткой. */}
              <option value="">all {PRIMARY_LANGUAGES.length} EU languages…</option>
              {PRIMARY_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.native} — {l.name}</option>
              ))}
            </select>
          </div>

          {/* ⚠⚠ ИРЛАНДСКИЙ ОБЪЯСНЯЕТСЯ, А НЕ ПРЯЧЕТСЯ. Список из 23 языков там,
              где официальных 24, — это утверждение, и оно требует основания на
              экране. Иначе человек решит, что мы просто чего-то не доделали. */}
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-gray-500 hover:text-[#062A78]">
              Why is Irish not in this list?
            </summary>
            <p className="mt-1 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] leading-relaxed text-gray-700">
              {PRIMARY_LANGUAGE_EXCLUDED_REASON}
            </p>
          </details>

          {primaryError && (
            <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
              ⚠ Official texts could not be loaded, so this label is still in English: {primaryError}
            </p>
          )}

          {/* ⚠⚠ Откат на английский называется ПОИМЁННО. Одна английская строка
              внутри немецкой этикетки выглядит как недоделка, а является
              требованием.

              ⚠⚠ ПРИЧИНА ЗДЕСЬ БЫЛА НАЗВАНА НЕВЕРНО. Стояло: «The regulation does
              not publish these as separate rows» — и подразумевались суффиксные
              формы H350i, H360F, H361f. Регламент их публикует, в Annex VI
              Part 1 §1.1.2.1.2; session 53 залила все девять на 23 языках.
              Настоящая причина у оставшихся кодов другая и куда проще: этих
              фраз НЕТ В CLP ВООБЩЕ — они либо изъяты прежними ATP (EUH001,
              EUH006, EUH059), либо приняты UN GHS, но не ЕС (H303, H305, H313,
              H316, H320, H333, H401, H402, H421 и другие). Языковые версии
              печатают то, что в регламенте есть. */}
          {primaryMissing.length > 0 && !primaryError && (
            <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-900">
              No official {LANGUAGE_BY_CODE.get(primaryLang)?.name ?? primaryLang} wording exists for{' '}
              {primaryMissing.join(', ')} — {primaryMissing.length === 1 ? 'it stays' : 'they stay'} in English.
              {primaryMissing.length === 1 ? ' That code is' : ' Those codes are'} not part of EU CLP: either
              deleted by an earlier ATP or adopted by UN GHS but not by the Union. The 24 language versions
              print what the regulation contains, so translating the English sentence would mean inventing
              legal text.
            </p>
          )}

          {/* ⚠⚠ КРАСНАЯ ПОЛОСА — ТОЛЬКО ПРО СБОЙ ЗАГРУЗКИ, И НИКОГДА ПРО ВЫБОР
              ЧЕЛОВЕКА ИЛИ ПРО КЛАССИФИКАЦИЮ.

              До session 53 условием было `!primarySignal`, то есть «слова нет».
              Но «слова нет» бывает по трём разным причинам, и только одна из них
              — наша беда:

                1. человек выбрал «No signal word» в панели над конструктором;
                2. ⚠⚠ классификация вещества сигнального слова НЕ ДАЁТ. Это не
                   редкость и не край: **282 записи из 4 178 (6,8 %)** в
                   гармонизированном списке идут без сигнального слова —
                   Pyrimethanil (CAS 53112-28-0, H411), все H412 и H413. Aquatic
                   Chronic 2–4 по Annex I сигнального слова не назначают вовсе;
                3. уровень задан, а официальной формулировки на этом языке мы не
                   отдали.

              Полоса говорила «A signal word is a mandatory label element — do not
              print this label» во ВСЕХ трёх, и в первых двух это прямая
              неправда: этикетка Pyrimethanil без сигнального слова — законная
              этикетка, а мы запрещали её печатать.

              ⚠ И то же, что в session 51: дефект был НЕВИДИМ, пока основной язык
              оставался английским — условие начиналось с `primaryLang !== 'EN'`.
              Английская этикетка тех же 282 веществ не показывала ничего, то
              есть вела себя ВЕРНО, и потому расхождение никого не настораживало.

              Теперь условие — `signalLevel`: слово ожидается ровно тогда, когда
              классификация его назначила. */}
          {primaryLang !== 'EN' && signalLevel !== null && !primarySignal && !primaryLoading && (
            <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
              ⚠⚠ The classification assigns the signal word “{signalLevel === 'danger' ? 'Danger' : 'Warning'}”,
              but its official {LANGUAGE_BY_CODE.get(primaryLang)?.name ?? primaryLang} wording could not be
              loaded. A signal word that the classification assigns is a mandatory label element under
              Art. 17(1)(d) — do not print this label until it appears.
            </p>
          )}
        </div>

        {/* ── ВТОРОЙ ЯЗЫК ──────────────────────────────────────────────────
            ⚠⚠ Для Канады это не опция: HPR s. 6.2 требует ОБА официальных
            языка, и одноязычная этикетка поставщика там незаконна. Поэтому у
            WHMIS блок раскрыт и подписан требованием, а не предложением. */}
        <div className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Second language
              {j.requiredLanguages.length > 1 && (
                <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                  required
                </span>
              )}
            </p>
            {secondLoading && <span className="text-[11px] text-gray-400">loading official texts…</span>}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSecondLang(null)}
              className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-colors ${
                secondLang === null ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-[#062A78]'
              }`}
            >none</button>
            {/* ⚠ Из предложений вычитается ОСНОВНОЙ язык, а не английский:
                один и тот же текст двумя блоками — это не двуязычная этикетка,
                а вдвое меньше места под обязательные элементы. */}
            {suggestedLanguages(jurisdictionKey).filter((c) => c !== primaryLang).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => { setSecondLang(code); track('label_second_language', { lang: code }) }}
                className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  secondLang === code ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-[#062A78]'
                }`}
              >{LANGUAGE_BY_CODE.get(code)?.native ?? code}</button>
            ))}
            <select
              value={secondLang && !suggestedLanguages(jurisdictionKey).includes(secondLang) ? secondLang : ''}
              onChange={(e) => { const v = e.target.value; setSecondLang(v || null); if (v) track('label_second_language', { lang: v }) }}
              aria-label="Second label language"
              className="cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
            >
              {/* ⭐ Здесь ирландский ЕСТЬ: вторым языком он законен — тексты
                  H- и P-фраз на нём напечатаны в Annex III и IV. Не хватает
                  только сигнального слова, а его во втором блоке не требуется. */}
              {/* ⚠ Длина берётся у НЕотфильтрованного EU_LANGUAGES намеренно: строка
                  обещает набор («доступны все 24 языка ЕС»), а .filter ниже
                  снимает ровно один — уже выбранный основным. Это свойство
                  текущего выбора, а не заявление о том, скольких языков у нас нет. */}
              <option value="">all {EU_LANGUAGES.length} EU languages…</option>
              {EU_LANGUAGES.filter((l) => l.code !== primaryLang).map((l) => (
                <option key={l.code} value={l.code}>{l.native} — {l.name}</option>
              ))}
            </select>
          </div>

          {secondError && (
            <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
              Official texts could not be loaded: {secondError}
            </p>
          )}

          {secondLang && !secondError && (
            <>
              <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
                Hazard and precautionary texts are the official wording from CLP Annex III and Annex IV,
                and the signal word is the official wording from the Annex I label element tables —
                none of it is a translation we made.
                {/* ⚠⚠ ТОТ ЖЕ ДЕФЕКТ, ЧТО У ОСНОВНОГО БЛОКА, И ТОГО ЖЕ ВИДА.
                    Условие было `!secondSignal`, а текст утверждал «No official
                    signal word exists for Italian IN THE REGULATION». У 282
                    веществ без сигнального слова и при выборе «No signal word»
                    это ложь про регламент: итальянское слово в Annex I есть,
                    его не назначает КЛАССИФИКАЦИЯ. Утверждение о чужом
                    документе, сделанное из нашего пустого поля. */}
                {signalLevel !== null && !secondSignal && (
                  <> ⚠ The classification assigns “{signalLevel === 'danger' ? 'Danger' : 'Warning'}”, but no
                  official {LANGUAGE_BY_CODE.get(secondLang)?.name} wording for it exists in the regulation —
                  Irish is the one case, since no consolidated CLP has ever been published in it. The second
                  block is printed without a signal word.</>
                )}
              </p>
              {missingSecond.length > 0 && (
                <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-900">
                  No official {LANGUAGE_BY_CODE.get(secondLang)?.name} text exists for{' '}
                  <span className="font-semibold">{missingSecond.join(', ')}</span> — these are left out of the
                  second block; the primary block still carries them.
                  Either the statement was removed from CLP by a later adaptation, or it is a UN GHS
                  statement the EU never adopted, or it is a suffixed form (H360F, H361d and the like)
                  that the regulation does not publish as its own entry. We will not splice one together.
                </p>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-gray-400">{EURLEX_ATTRIBUTION}</p>
            </>
          )}
        </div>
        {purpose === 'workplace' && (
          <p className="mt-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-700">{j.workplaceNote}</p>
        )}

        {/* ── ВЫБОР НАБОРА ЦЕХОВОЙ ЭТИКЕТКИ ────────────────────────────────
            ⚠⚠ ПОЯВЛЯЕТСЯ ТОЛЬКО ТАМ, ГДЕ ВЫБОР ЕСТЬ У НОРМЫ. Сегодня это одна
            юрисдикция — OSHA, §1910.1200(f)(6). У CLP, GB CLP и WHMIS набор
            один, и рисовать переключатель из одной кнопки значило бы намекать
            на выбор, которого нет. Условие — на `length > 1`, а не на
            `jurisdictionKey === 'osha'`: появится вторая такая норма — панель
            придёт вместе с ней, а не следующей правкой этого файла. */}
        {purpose === 'workplace' && j.workplaceOptions.length > 1 && (
          <div className="mt-2 rounded-lg border border-blue-200 bg-white px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Which set of elements
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              The standard allows either set. Pick the one that matches how the container is used —
              this is your call, not ours.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {j.workplaceOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => { setWorkplaceOption(o.key); track('label_workplace_option', { option: o.key }) }}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-left transition-colors ${
                    wpOption.key === o.key
                      ? 'border-[#062A78] bg-[#062A78] text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-[#062A78]'
                  }`}
                >
                  <span className="block text-sm font-semibold">{o.label}</span>
                  <span className={`block text-[11px] ${wpOption.key === o.key ? 'text-blue-100' : 'text-gray-500'}`}>
                    {o.hint}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-700">
              {wpOption.note} <span className="text-gray-400">{wpOption.citation}</span>
            </p>
            {/* ⭐ (f)(8) стоит рядом с выбором, а не в общем примечании: человек,
                переливающий на одну смену для себя, не должен выбирать между
                двумя наборами — ему не нужен ни один. */}
            <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
              ⓘ A portable container filled and used by the same employee within one shift needs no
              label at all. <span className="text-gray-400">29 CFR 1910.1200(f)(8)</span>
            </p>
          </div>
        )}
        {purpose === 'small' && smallRule && (
          <p className="mt-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs leading-relaxed text-gray-700">
            {smallRule.note} <span className="text-gray-400">{smallRule.citation}</span>
          </p>
        )}
        {purpose === 'small' && !smallRule && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            No reduced-label provision applies to a {capacityMl} ml container here — the full set of elements is printed.
          </p>
        )}

        {/* ── Заполняемые пропуски H-фраз ──────────────────────────────────
            ⚠⚠ Панель появляется ТОЛЬКО когда среди выбранных фраз есть коды с
            пропусками (11 кодов из 238, но 1 584 вещества из 4 178). Показывать
            её всегда — значит просить назвать органы у вещества, у которого
            поражения органов нет вовсе. */}
        {phRoles.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-xs font-semibold text-[#062A78]">
              These statements ask you to name something
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
              CLP Annex III prints part of these statements as an instruction to the supplier in angle
              brackets. That instruction is not label text: you either fill it in or leave it out.
              What you type is printed after the code the way CLP Annex VI does it —{' '}
              <span className="font-mono">H372 (liver, kidneys; inhalation)</span>.
              {/* ⚠⚠ ПРИМЕР АНГЛИЙСКИЙ, И ЭТО НАДО СКАЗАТЬ. Он взят из английской
                  редакции Annex VI и показывает ФОРМУ записи, а не то, какими
                  словами заполнять поле. Человек, выбравший немецкий, увидев
                  «liver, kidneys», впишет английские органы в немецкую строку. */}
              {primaryLang !== 'EN' && (
                <> That example is the regulation’s English wording — it shows the format, not the words.
                Type your entry in <b>{primaryLangName}</b>: it is printed inside the{' '}
                {primaryLangName} statement as typed, and nothing here is translated.</>
              )}
            </p>
            <div className="mt-2.5 space-y-2.5">
              {phRoles.map((role) => (
                <div key={role} className={secondLang ? 'grid gap-2 sm:grid-cols-2' : ''}>
                  <label className="block">
                    <span className="text-[11px] font-medium text-gray-700">
                      {PH_LABEL[role]}
                      {roleIsRequired(role) && <span className="ml-1 text-rose-600">required</span>}
                      {/* ⚠ Подпись нужна и БЕЗ второго языка: одноязычная
                          немецкая этикетка — ровно тот случай, где поле легче
                          всего заполнить не тем языком. */}
                      {(secondLang || primaryLang !== 'EN') && (
                        <span className="ml-1 text-gray-400">· {primaryLangName}</span>
                      )}
                    </span>
                    {/* ⚠⚠ Английская подсказка внутри немецкого поля — это
                        приглашение ошибиться. Пример из регламента остаётся в
                        тексте выше, где он прямо назван английским, а в самом
                        поле стоит только название языка, на котором писать. */}
                    <input
                      type="text"
                      value={phValues[role] ?? ''}
                      onChange={(e) => setPhValues((v) => ({ ...v, [role]: e.target.value }))}
                      placeholder={primaryLang === 'EN' ? PH_HINT[role] : (LANGUAGE_BY_CODE.get(primaryLang)?.native ?? '')}
                      className={inputClass}
                    />
                  </label>
                  {/* ⚠⚠ ОТДЕЛЬНОЕ ПОЛЕ НА ВТОРОЙ ЯЗЫК, А НЕ КОПИЯ ПЕРВОГО. Мы не
                      переводим ни фразы регламента, ни то, что ввёл поставщик:
                      «liver, kidneys» внутри немецкой строки — такой же дефект,
                      как непечатаемая скобка, только незаметнее. */}
                  {secondLang && (
                    <label className="block">
                      <span className="text-[11px] font-medium text-gray-700">
                        {PH_LABEL[role]}
                        <span className="ml-1 text-gray-400">
                          · {LANGUAGE_BY_CODE.get(secondLang)?.name ?? secondLang}
                        </span>
                      </span>
                      <input
                        type="text"
                        value={phValuesSecond[role] ?? ''}
                        onChange={(e) => setPhValuesSecond((v) => ({ ...v, [role]: e.target.value }))}
                        placeholder={LANGUAGE_BY_CODE.get(secondLang)?.native ?? ''}
                        className={inputClass}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
              Leave a field empty and the instruction is simply dropped from the printed statement —
              that is what the regulation allows where the condition is not met. The compliance check
              below records what was left unnamed.
            </p>
          </div>
        )}

        {/* ── Заполняемые пропуски P-фраз ──────────────────────────────────
            ⚠⚠ Здесь пропуск чаще ОБЯЗАТЕЛЕН, чем у H-фраз: «Keep wetted with …»
            без ответа ломается в «Keep wetted with.». Такая фраза на этикетку не
            попадает вовсе, и панель соответствия говорит об этом прямо. */}
        {pFillable.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-xs font-semibold text-[#062A78]">
              These precautionary statements need you to complete them
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
              CLP Annex IV prints part of these statements as an instruction to the supplier and gives
              the details in column&nbsp;(5) — quoted under each field below. A statement whose required
              part is left empty is <span className="font-semibold">not printed on the label</span>.
            </p>
            <div className="mt-2.5 space-y-3">
              {pFillable.map((p) => {
                const bracketOn = pBrackets[p.code] ?? false
                /**
                 * ⚠⚠ ЧИСЛО ПРОПУСКОВ СЧИТАЕТСЯ ПО ТЕКСТУ ОСНОВНОГО ЯЗЫКА.
                 * У P413 по-английски четыре пропуска, по-итальянски три —
                 * итальянская редакция не даёт варианта в °F. Считать по
                 * английскому и нарисовать четыре поля над итальянской фразой
                 * значит просить заполнить пропуск, которого в ней нет.
                 */
                const pText = primaryText(p.code, p.text_en)
                const n = pSlotCount(pText, p.code, primaryLang, bracketOn)
                const kinds = pSlotKinds(pText, p.code, primaryLang, bracketOn)
                const nSecond = secondLang && secondTexts[p.code]
                  ? pSlotCount(secondTexts[p.code], p.code, secondLang, bracketOn) : 0
                return (
                  <div key={p.code} className="rounded-md border border-amber-200/70 bg-white p-2.5">
                    <p className="font-mono text-[11px] font-semibold text-gray-700">{p.code}</p>
                    {pConditions[p.code] && (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
                        {pConditions[p.code]}
                        <span className="ml-1 text-gray-400">· Annex IV, column (5)</span>
                      </p>
                    )}
                    {hasPBracket(p.code) && (
                      <label className="mt-1.5 flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={bracketOn}
                          onChange={(e) => setPBrackets((v) => ({ ...v, [p.code]: e.target.checked }))}
                        />
                        {/* ⚠ Выключено по умолчанию: «may be used» — разрешение,
                            а не указание, и включать его за поставщика нельзя. */}
                        <span className="text-[11px] text-gray-700">
                          include the optional part shown in square brackets
                        </span>
                      </label>
                    )}
                    {Array.from({ length: n }).map((_, i) => (
                      <div key={i} className={nSecond > 0 ? 'mt-1.5 grid gap-2 sm:grid-cols-2' : 'mt-1.5'}>
                        <label className="block">
                          <span className="text-[11px] text-gray-600">
                            {n > 1 ? `part ${i + 1}` : 'your wording'}
                            {kinds[i] === 'required' && <span className="ml-1 text-rose-600">required</span>}
                            {/* ⚠ Подпись языка нужна и без второго блока — см. панель H-фраз. */}
                            {(nSecond > 0 || primaryLang !== 'EN') && (
                              <span className="ml-1 text-gray-400">· {primaryLangName}</span>
                            )}
                          </span>
                          <input
                            type="text"
                            value={pValues[p.code]?.[i] ?? ''}
                            onChange={(e) => setPValues((v) => {
                              const arr = [...(v[p.code] ?? [])]; arr[i] = e.target.value
                              return { ...v, [p.code]: arr }
                            })}
                            className={inputClass}
                          />
                        </label>
                        {/* ⚠⚠ Отдельное поле на второй язык. Введённое поставщиком
                            мы не переводим — «hands» внутри немецкой строки такой
                            же дефект, как непечатаемое многоточие. */}
                        {i < nSecond && (
                          <label className="block">
                            <span className="text-[11px] text-gray-600">
                              {n > 1 ? `part ${i + 1}` : 'your wording'}
                              <span className="ml-1 text-gray-400">
                                · {LANGUAGE_BY_CODE.get(secondLang ?? '')?.name ?? secondLang}
                              </span>
                            </span>
                            <input
                              type="text"
                              value={pValuesSecond[p.code]?.[i] ?? ''}
                              onChange={(e) => setPValuesSecond((v) => {
                                const arr = [...(v[p.code] ?? [])]; arr[i] = e.target.value
                                return { ...v, [p.code]: arr }
                              })}
                              className={inputClass}
                            />
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
              Where a field is pre-filled, that wording came from this tool, not from the regulation —
              check it against your product before printing.
            </p>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 lg:gap-8">
        {/* ── Управление ──────────────────────────────────────────────────── */}
        <div className="order-2 space-y-5 lg:order-1">
          {/* Тара и размер */}
          <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:p-5">
            <p className="font-semibold text-[#062A78]">Container &amp; label size</p>

            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Container capacity</p>
            <div className="flex flex-wrap gap-2">
              {CAPACITY_PRESETS.map((c) => (
                <button
                  key={c.ml}
                  type="button"
                  onClick={() => applyCapacity(c.ml)}
                  className={`cursor-pointer rounded-lg border-2 px-3 py-1.5 text-sm transition-colors ${
                    capacityMl === c.ml ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-900 hover:border-[#062A78]'
                  }`}
                >
                  {c.label}
                </button>
              ))}
              <input
                type="number"
                min={1}
                value={capacityMl}
                onChange={(e) => applyCapacity(Math.max(1, Number(e.target.value)))}
                className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
                aria-label="Container capacity in millilitres"
              />
              <span className="self-center text-xs text-gray-500">mL</span>
            </div>
            {/* ⚠⚠ ФОРМУЛИРОВКА ЯРУСА — ИЗ ТАБЛИЦЫ, А НЕ ОДНА НА ВСЕХ.
                «must be at least» верно для > 3 л и неверно для ≤ 3 л, где
                Table 1.3 говорит «If possible, at least 52 × 74». Одна фраза на
                четыре яруса приписывала регламенту требование, которого он в
                первом ярусе не устанавливает. */}
            {tier ? (
              <p className="text-[11px] text-gray-500">
                {tier.labelSidesBinding ? (
                  <>{j.tag}: for {tier.capacityLabel} the label must be at least {tier.labelMinW} × {tier.labelMinH} mm</>
                ) : (
                  <>
                    {j.tag}: for {tier.capacityLabel} Table 1.3 asks for <b>if possible</b>, at least{' '}
                    {tier.labelMinW} × {tier.labelMinH} mm — a target for this tier, not a minimum
                  </>
                )}
                {' '}and each pictogram at least {tier.pictogramFloorMm} mm
                {tier.pictogramMm !== tier.pictogramFloorMm ? `, ${tier.pictogramMm} mm if possible` : ''}
              </p>
            ) : (
              <p className="text-[11px] text-gray-500">
                {j.tag} sets no minimum label or pictogram size — only a legibility requirement.
                For {recTier.capacityLabel} ({recTier.examples}) we suggest at least{' '}
                <span className="font-medium">{recTier.labelMinW} × {recTier.labelMinH} mm</span> — our recommendation,
                not a legal minimum.
              </p>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Label size</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={rotate} className="cursor-pointer rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:border-[#062A78]">
                  ⤢ Rotate
                </button>
                <div className="inline-flex overflow-hidden rounded-md border border-gray-300 text-xs">
                  {(['mm', 'in'] as const).map((u) => (
                    <button key={u} type="button" onClick={() => setUnit(u)}
                      className={`cursor-pointer px-2 py-1 ${unit === u ? 'bg-[#062A78] text-white' : 'bg-white text-gray-600'}`}>{u}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {tier && (
                <button
                  type="button"
                  onClick={pickClpMinimum}
                  className={`cursor-pointer rounded-lg border-2 px-3 py-1.5 text-left transition-colors ${
                    !stockId && Math.abs(sizeW - tier.labelMinW) < 0.5 && Math.abs(sizeH - tier.labelMinH) < 0.5
                      ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-900 hover:border-[#062A78]'
                  }`}
                >
                  <span className="block text-sm font-medium">{tier.labelMinW} × {tier.labelMinH} mm</span>
                  <span className="block text-[11px] opacity-70">{j.tag} minimum</span>
                </button>
              )}
              {stocks.map((s) => {
                const m = stockMm(s)
                const active = stockId === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pickStock(s)}
                    title={s.aliases.join(' · ')}
                    className={`cursor-pointer rounded-lg border-2 px-3 py-1.5 text-left transition-colors ${
                      active ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-900 hover:border-[#062A78]'
                    }`}
                  >
                    {/* ⚠ Размер печатается в ЕДИНИЦЕ, ВЫБРАННОЙ ПОЛЬЗОВАТЕЛЕМ.
                        Раньше здесь стояла родная единица формата, и при
                        переключении на миллиметры американские наклейки всё
                        равно оставались в дюймах. Родное обозначение никуда не
                        делось — оно во второй строке, рядом с кодом. */}
                    <span className="block text-sm font-medium">{fmt(m.w)} × {fmt(m.h)} {unit}</span>
                    <span className={`block text-[11px] ${active ? 'text-blue-100' : 'text-gray-500'}`}>
                      {s.aliases[0]}{s.unit !== unit ? ` · ${stockSizeLabel(s)}` : ''}{s.perSheet && s.perSheet > 1 ? ` · ${s.perSheet} per sheet` : ''}{s.chemical ? ' · chemical-resistant' : ''}{!tier && !fitsTier(m, recTier) ? ' · small for this container' : ''}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Custom:</span>
              <input type="number" min={10} step={unit === 'in' ? 0.125 : 1} value={toUnit(sizeW)}
                onChange={(e) => { setSizeW(fromUnit(Number(e.target.value))); setStockId(null) }}
                className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
              <span className="text-gray-400">×</span>
              <input type="number" min={10} step={unit === 'in' ? 0.125 : 1} value={toUnit(sizeH)}
                onChange={(e) => { setSizeH(fromUnit(Number(e.target.value))); setStockId(null) }}
                className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
              <span className="text-xs text-gray-500">{unit}</span>
            </div>

            {/* ⚠⚠ ТРИ РАЗНЫХ ВЕРДИКТА О РАЗМЕРЕ, А НЕ ОДИН (session 65).
                Table 1.3 говорит о ярусах разными словами, и смешивать их
                нельзя: у > 3 л «At least» — это норма, у ≤ 3 л «If possible» —
                это цель. Пока вердикт был один, наклейка 4 × 2 in под бутылку
                получала алую плашку «below the 52 × 74 mm minimum» — про
                минимум, которого в её ярусе нет.
                Разбор: claude/label-size-table13.md */}
            {fit.sizeVerdict?.breach ? (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {fmt(sizeW)} × {fmt(sizeH)} {unit} is below the {fit.minimumLabel} minimum for this container ({j.tag}).
                {' '}Table 1.3 requires <b>{fit.sizeVerdict.wording}</b>
                {fit.sizeVerdict.shortByMm && (fit.sizeVerdict.shortByMm.shortSide > 0 || fit.sizeVerdict.shortByMm.longSide > 0) ? (
                  <>
                    {' — short by '}
                    {[
                      fit.sizeVerdict.shortByMm.shortSide > 0 ? `${fit.sizeVerdict.shortByMm.shortSide} mm on the short side` : null,
                      fit.sizeVerdict.shortByMm.longSide > 0 ? `${fit.sizeVerdict.shortByMm.longSide} mm on the long side` : null,
                    ].filter(Boolean).join(' and ')}
                  </>
                ) : null}.
              </p>
            ) : fit.sizeVerdict?.belowIfPossible ? (
              /* ⚠ Янтарная, а не алая: это НЕ нарушение. Для тары ≤ 3 л
                 Table 1.3 говорит «If possible, at least 52 × 74» — цель, а не
                 минимум. Там, где она не достигается, работают ст. 29(1)–(2) и
                 Annex I §1.5, а не запрет. */
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {fmt(sizeW)} × {fmt(sizeH)} {unit} is under the {fit.minimumLabel} that Table 1.3 asks for
                {fit.sizeVerdict.shortByMm && fit.sizeVerdict.shortByMm.shortSide > 0
                  ? ` (short by ${fit.sizeVerdict.shortByMm.shortSide} mm on the short side)`
                  : ''}
                . <b>This is not a breach.</b> For packages not exceeding 3 litres the wording is
                “<i>if possible</i>, at least 52 × 74” — a target, not a minimum. Where it cannot be met,
                Art. 29(1)–(2) and Annex I §1.5 apply (tie-on tag, outer packaging, or a reduced set).
              </p>
            ) : fit.sizeVerdict?.onlyRotated ? (
              /* ⭐ Стороны выдержаны, но в другую сторону. Таблица даёт ПАРУ
                 размеров и не называет, который из них ширина, — поэтому это
                 соответствие, а не отступление. Но заготовка у человека на
                 столе лежит одной определённой стороной, и сказать надо. */
              <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                {fmt(sizeW)} × {fmt(sizeH)} {unit} meets the {fit.minimumLabel} pair of dimensions in landscape.
                Table 1.3 gives two dimensions and does not say which one is the width, so this is compliant —
                but check that your label stock is fed that way round.
              </p>
            ) : fit.fits ? (
              <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                Everything fits · pictograms {fit.pictogramMm} mm · text {fit.bodyMm} mm
                {fit.requiredPictogramMm ? ` (minimum ${fit.requiredPictogramMm} mm)` : ''}
              </p>
            ) : (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Does not fit: about {fit.neededHeightMm} mm of height is needed. Use a larger size, drop some
                precautionary statements, or switch to a fold-out label.
              </p>
            )}
          </section>

          {/* Продукт */}
          <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <p className="font-semibold text-[#062A78]">Product information</p>
            <div>
              <label className={labelClass}>Product name <span className="font-normal text-gray-400">as printed on the label</span></label>
              <input
                type="text"
                value={productName}
                onChange={(e) => { productNameRef.current = e.target.value; setProductName(e.target.value) }}
                className={inputClass}
              />
              {/* ⚠⚠ ОБЯЗАТЕЛЬНОЕ ПРИМЕЧАНИЕ ПОКАЗЫВАЕТСЯ ЗДЕСЬ, А НЕ ПРЯЧЕТСЯ.
                  Оно печатается на этикетке независимо от того, что человек
                  набрал в поле, и увидеть это он должен ДО того, как скачает
                  PDF, а не после. */}
              {compositionSuffix && (
                <p className="mt-1 rounded border border-[#062A78]/30 bg-blue-50 px-2 py-1.5 text-[11px] leading-relaxed text-[#062A78]">
                  Printed on the label as <b>{productNameOnLabel}</b>.{' '}
                  <span className="font-normal text-gray-600">
                    Annex VI Part 1, 1.1.1.4: a reference to an impurity is part of the name and must be on the
                    label, whichever designation you pick.
                  </span>
                </p>
              )}

              {namesError && (
                <p className="mt-1 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-800">
                  Official names could not be loaded: {namesError}
                </p>
              )}

              {/* ⚠⚠ РАЗБОР НЕНАДЁЖЕН — ФОРМЫ НЕ ПРЕДЛАГАЕМ ВОВСЕ.
                  У трёх записей Annex VI языковые версии не согласны между собой
                  в том, какой член какой, а у 607-718-00-9 имён в ячейке нет
                  совсем: между маркерами лежат куски предложения, и разрез даёт
                  «and its sodium». Предложить такое кнопкой хуже, чем не
                  предложить ничего: явный мусор человек сотрёт, а
                  правдоподобный примет за имя. Показываем первоисточник. */}
              {nameNotice ? (
                <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-2 text-[11px] leading-relaxed text-amber-900">
                  <p>
                    ⚠ This Annex VI entry cannot be split into names reliably, so no ready-made forms are offered.
                    The regulation writes it as one running phrase{nameNotice ? ` (“…${nameNotice}”)` : ''}, and
                    picking a fragment out of it would put something on the label that is not a name.
                  </p>
                  <p className="mt-1 text-gray-700">
                    The entry as printed in Annex VI:{' '}
                    <span className="font-mono text-[10px] text-gray-900">{names?.cell}</span>
                  </p>
                  <p className="mt-1 text-gray-700">Type the name of the substance you actually package.</p>
                </div>
              ) : localisedForms.length > 1 ? (
                <>
                  <p className="mt-2 text-[11px] text-gray-500">
                    {/* ⚠ «На этом языке» — не пустая вежливость: число форм между
                        языками законно разное («Kohlenstoffmonoxid; Kohlenmonoxid;
                        Kohlenoxid» против одного «carbon monoxide»). */}
                    This Annex VI entry has {localisedForms.length} designations in{' '}
                    {LANGUAGE_BY_CODE.get(primaryLang)?.name ?? primaryLang}. Pick the one you actually package:
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {localisedForms.map((v) => (
                      <button
                        key={`${v.index ?? ''}${v.name}`}
                        type="button"
                        // ⚠⚠ Номера ставятся ВСЕГДА, в том числе пустые. Было
                        // `if (v.cas)` — и у формы без своего номера на
                        // этикетке оставался номер предыдущей формы. Это хуже
                        // пустого поля: неверный номер читается как верный.
                        onClick={() => {
                          autoNameRef.current = v.name
                          productNameRef.current = v.name
                          setProductName(v.name); setCasOnLabel(v.cas ?? ''); setEcOnLabel(v.ec ?? '')
                        }}
                        className={`cursor-pointer rounded-lg border px-2.5 py-1 text-left text-[11px] transition-colors ${
                          productName === v.name ? 'border-[#062A78] bg-blue-50 font-semibold text-[#062A78]' : 'border-gray-300 bg-white text-gray-700 hover:border-[#062A78]'
                        }`}
                      >
                        {v.name}
                        {v.cas ? <span className="ml-1 text-gray-400">CAS {v.cas}</span> : null}
                        {v.ec ? <span className="ml-1 text-gray-400">EC {v.ec}</span> : null}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {/* ⚠⚠ ПОДСКАЗКА «ЭТО ТА САМАЯ ЗАПИСЬ», А НЕ УКРАШЕНИЕ.
                  У 10 пар индексных номеров скобочное примечание — ЕДИНСТВЕННОЕ
                  различие между РАЗНЫМИ классификациями: `piperazine [solid]` и
                  `piperazine [liquid]` дают одно имя и разные наборы H-фраз.
                  Без этой строки человек не отличит свою запись от чужой. */}
              {nameHints.length > 0 && (
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                  Annex VI notes this entry as{' '}
                  <b className="font-semibold text-gray-700">{nameHints.map((a) => a.text).join(', ')}</b>
                  {' '}— not printed on the label, but it is how you tell this entry from its neighbours.
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>CAS number</label>
                <input type="text" value={casOnLabel} onChange={(e) => setCasOnLabel(e.target.value)} placeholder="67-64-1" className={inputClass} />
                {casOnLabel.trim() && !casShapeOk(casOnLabel) && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    Not the shape of a CAS number (e.g. 67-64-1). It will still be printed as typed.
                  </p>
                )}
              </div>
              {/* ⚠⚠ ПОЛЕ EC ПОЯВИЛОСЬ ЗДЕСЬ ПОТОМУ, что до session 44 номер шёл
                  на этикетку прямо из базы и правке не поддавался. У 189 записей
                  там склейка форм («200-752-1[1]209-526-»), и человек видел её
                  на готовом PDF, ничего не в силах сделать. */}
              <div>
                <label className={labelClass}>EC number <span className="font-normal text-gray-400">optional</span></label>
                <input type="text" value={ecOnLabel} onChange={(e) => setEcOnLabel(e.target.value)} placeholder="200-662-2" className={inputClass} />
                {ecOnLabel.trim() && !ecShapeOk(ecOnLabel) ? (
                  <p className="mt-1 text-[11px] text-amber-700">
                    Not the shape of an EC number (three digits, three digits, one check digit — 200-662-2).
                  </p>
                ) : !ecOnLabel.trim() && nameVariants && nameVariants.length > 1 ? (
                  <p className="mt-1 text-[11px] text-gray-500">
                    This Annex VI entry stores one EC number per form. Pick a form above, or type the number for
                    the grade you package.
                  </p>
                ) : null}
              </div>
              <div>
                <label className={labelClass}>Batch / Lot number</label>
                <input type="text" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="LOT-2026-001" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Nominal quantity</label>
                <input type="text" value={nominalQty} onChange={(e) => setNominalQty(e.target.value)} placeholder="500 mL" className={inputClass} />
              </div>
              {j.requiresUfi && (
                <div className="sm:col-span-2">
                  <label className={labelClass}>UFI code <span className="font-normal text-gray-400">(EU mixtures)</span></label>
                  <input type="text" value={ufiCode} onChange={(e) => setUfiCode(e.target.value)} placeholder="UFI: XXXX-XXXX-XXXX-XXXX" className={inputClass} />
                </div>
              )}
            </div>
          </section>

          {/* Поставщик */}
          {j.supplierElements.includes('supplier') && purpose !== 'workplace' && (
            <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-[#062A78]">Supplier details</p>
                <span className="text-[11px] text-gray-400">
                  {j.key === 'osha' ? 'US address and phone · (f)(1)(vi)' : j.key === 'whmis' ? 'initial supplier identifier' : 'CLP Article 17'} · saved locally
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Company name</label>
                  <input type="text" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} onBlur={saveToStorage} placeholder="ACME Chemicals Inc" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Address</label>
                  <input type="text" value={supplierAddress} onChange={(e) => setSupplierAddress(e.target.value)} onBlur={saveToStorage} placeholder={j.key === 'osha' ? '1200 Industrial Rd, Houston, TX' : '123 Industrial Ave, London'} className={inputClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Phone</label>
                  <input type="text" value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} onBlur={saveToStorage} placeholder={j.key === 'osha' ? '+1 800 000 0000' : '+44 800 000 0000'} className={inputClass} />
                </div>
              </div>

              <div className="pt-1">
                <label className={labelClass}>Company logo <span className="font-normal text-gray-400">(optional)</span></label>
                {logo ? (
                  <div className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2">
                    <img src={logo.dataUrl} alt="Logo preview" className="h-10 w-auto max-w-[120px] object-contain" />
                    <span className="flex-1 truncate text-xs text-gray-600">{logoName || 'logo'}</span>
                    <button type="button" onClick={removeLogo} className="cursor-pointer text-xs font-semibold text-rose-600 hover:text-rose-700">Remove</button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
                    onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
                    onDrop={onLogoDrop}
                    className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-4 text-center transition-colors ${dragActive ? 'border-[#062A78] bg-blue-50' : 'border-gray-300 bg-white hover:border-[#062A78]'}`}
                  >
                    <span className="text-sm text-gray-600">Drop your logo here or click to upload</span>
                    <span className="text-[11px] text-gray-400">PNG or JPEG</span>
                  </div>
                )}
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" onChange={onLogoInputChange} className="hidden" />
                {logoError && <p className="mt-1 text-xs text-rose-600">{logoError}</p>}
                <p className="mt-1 text-[11px] text-gray-400">
                  Your logo is placed as supplemental information beside the supplier block. It must not obscure the
                  mandatory elements (CLP Art. 25 / OSHA HCS App C.3.1).
                </p>
              </div>
            </section>
          )}

          {/* P-фразы */}
          {j.supplierElements.includes('precautionaryStatements') && purpose === 'supplier' && pStatements.length > 0 && (
            <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-[#062A78]">Precautionary statements</p>
                <span className="text-[11px] text-gray-400">{selectedP.length} of {pStatements.length} selected</span>
              </div>
              <p className="text-xs text-gray-500">
                Six is the usual maximum on a label. Which six is your call — it depends on how the product is
                actually used, and the regulations let you omit statements that do not apply.
              </p>

              {/* ── ⭐⭐ АУДИТОРИЯ. Стоит НАД списком, а не в «дополнительно»:
                     от неё зависит не оформление, а сам набор фраз. ────────── */}
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">Supplied to</p>
                <div className="flex flex-wrap gap-2">
                  {([
                    { v: 'professional' as const, l: 'Industrial / professional' },
                    { v: 'general_public' as const, l: 'General public' },
                  ]).map((o) => (
                    <button
                      key={o.v} type="button" onClick={() => setAudience(o.v)}
                      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                        audience === o.v ? 'border-[#062A78] bg-[#062A78] text-white' : 'border-gray-300 bg-white text-gray-600'
                      }`}
                    >{o.l}</button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                  Supplying the general public makes a disposal statement compulsory (Art. 28(2)), brings in
                  the “Consumer products” section of Annex IV, and moves ECHA’s importance levels to their own
                  column — so this changes the set, not just the wording.
                </p>
              </div>

              {/* ── ⛔⛔ ЧЕМ ЗАДАН НАБОР. Раньше здесь молча стояли первые шесть
                     кодов по номеру; теперь отбор делает движок, и он обязан
                     сказать о себе — вместе с оговоркой, что процедуры отбора
                     ни UN GHS, ни CLP не устанавливают. ────────────────────── */}
              {precedence.error ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-700">
                  The selection data did not load ({precedence.error}). Tick the statements yourself below —
                  the tool will not fall back to “the first six codes”, because a plausible-looking wrong set
                  on a safety label is worse than an empty one.
                </p>
              ) : precedence.loading ? (
                <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
                  Working out which statements this classification calls for…
                </p>
              ) : precedence.result ? (
                <div className="rounded-lg border border-[#062A78]/25 bg-blue-50 px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#062A78]">
                      {pTouched.current ? 'Edited by you' : `Selected by the tool · limit ${precedence.result.limit}`}
                    </p>
                    <button
                      type="button"
                      onClick={() => setProtocolOpen((v) => !v)}
                      className="ml-auto cursor-pointer text-[11px] font-semibold text-[#062A78] underline"
                      aria-expanded={protocolOpen}
                    >
                      {protocolOpen ? 'Hide the reasoning' : 'Why these ones?'}
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#062A78]/90">
                    Worked out from Annex IV, ECHA’s importance scale and Art. 28 — not picked off the top of
                    the list. Neither UN GHS nor CLP lays down a selection procedure, so this is a reproducible
                    method with its working shown, not a legally correct answer.{' '}
                    <a href="/p-statements/selector/" className="underline">
                      Open the full selector →
                    </a>
                  </p>
                  {pTouched.current && (
                    <button
                      type="button"
                      onClick={() => {
                        pTouched.current = false
                        setSelectedP(precedence.result!.selected.map((u) => u.code))
                      }}
                      className="mt-1.5 cursor-pointer rounded border border-[#062A78]/40 bg-white px-2 py-1 text-[11px] text-[#062A78]"
                    >
                      ↺ Back to the tool’s selection
                    </button>
                  )}

                  {/* ── ⭐⭐ ЧТО ПОКАЗАЛ ЗАМЕР ВЛЕЗАЕМОСТИ.
                         ⚠⚠ Число здесь — ОБЕЩАНИЕ, данное до печати, поэтому
                         сказано, ЧЕМ оно получено и на каком языке измерено.
                         «Влезает шесть» без указания языка на двуязычной
                         этикетке — это половина правды: ст. 17(2) требует
                         одинакового содержания, и число задаёт самый тесный
                         язык, а не основной. ───────────────────────────── */}
                  {precedence.fit && (
                    <div className="mt-1.5 border-t border-[#062A78]/20 pt-1.5">
                      {!precedence.fit.baseFits ? (
                        <p className="text-[11px] leading-relaxed text-rose-700">
                          ⚠ At {fmt(sizeW)} × {fmt(sizeH)} {unit} this label does not fit
                          <strong> even with no precautionary statements at all</strong> — the pictograms,
                          hazard statements and supplier details alone overflow it. Removing P-statements
                          will not help: make the label larger, or lower the text size below the preview.
                        </p>
                      ) : precedence.fit.none ? (
                        <p className="text-[11px] leading-relaxed text-rose-700">
                          ⚠ Measured on this label: <strong>no precautionary statement fits</strong> at this
                          size and text size. Article 28(3) is not what limits the set here — the label is.
                        </p>
                      ) : precedence.fit.capacity >= precedence.fit.candidates ? (
                        <p className="text-[11px] leading-relaxed text-[#062A78]/90">
                          Measured on this label with the real layout: room for{' '}
                          <strong>{precedence.fit.capacity} statements or more</strong>, so the set is limited
                          by Article 28(3), not by the size.
                        </p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-[#062A78]/90">
                          Measured on this label with the real layout:{' '}
                          <strong>{precedence.fit.capacity} statements fit</strong>
                          {precedence.fit.worstLang
                            ? <> — {LANGUAGE_BY_CODE.get(precedence.fit.worstLang)?.name ?? precedence.fit.worstLang} is
                                the tightest of the languages on this label, and Art. 17(2) requires the same
                                information in every one of them, so the tightest sets the number.</>
                            : '.'}
                        </p>
                      )}
                      {labelLangs.length > 1 && (
                        <p className="mt-1 text-[11px] text-[#062A78]/70">
                          {labelLangs.map((l) => `${l} ${precedence.fit!.byLang[l] ?? '—'}`).join(' · ')}
                          {' · '}measured with both language blocks on the label, because every statement is
                          printed twice.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              {protocolOpen && precedence.result && (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <PStatementProtocol result={precedence.result} heading="Selected for this label" />
                </div>
              )}
              {/* ⚠ В ручном режиме сюда приходят все 117 фраз, и без поиска
                  список бесполезен: нужную ищут по слову, а не листанием. */}
              {pStatements.length > 12 && (
                <input
                  type="search" value={pQuery} onChange={(e) => setPQuery(e.target.value)}
                  placeholder="Search by code or text: gloves, P280…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              )}
              <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {visibleP.map((p) => {
                  const on = selectedP.includes(p.code)
                  return (
                    <label key={p.code} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${on ? 'border-[#062A78] bg-blue-50' : 'border-gray-200 bg-white'}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          // ⚠ С этого момента движок набор не перезаписывает.
                          pTouched.current = true
                          setSelectedP((prev) => on ? prev.filter((c) => c !== p.code) : [...prev, p.code])
                        }}
                        className="mt-0.5 accent-[#062A78]"
                      />
                      <span><span className="font-semibold">{p.code}</span> {p.text_en}</span>
                    </label>
                  )
                })}
              </div>
              {!pQuery && pStatements.length > 12 && (
                <button type="button" onClick={() => setShowAllP((v) => !v)} className="cursor-pointer text-xs font-semibold text-[#062A78] underline">
                  {showAllP ? 'Show fewer' : `Show all ${pStatements.length}`}
                </button>
              )}
              <div className="flex gap-2 pt-1">
                {(['codes', 'combined'] as const).map((f) => (
                  <button key={f} type="button" onClick={() => setPFormat(f)}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs transition-colors ${pFormat === f ? 'border-[#062A78] bg-white font-semibold text-[#062A78]' : 'border-gray-300 bg-white text-gray-600'}`}>
                    {f === 'codes' ? 'With codes' : 'Combined text (compact)'}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Скачивание */}
          {!submitted ? (
            <div className="space-y-4 rounded-xl border-2 border-[#062A78] bg-blue-50 p-4 sm:p-5">
              <p className="font-bold text-[#062A78]">Download your label</p>
              <p className="text-sm text-gray-600">Free, no signup: a PDF at the exact physical size and an SVG for label software.</p>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="mb-1 font-semibold">Disclaimer — please confirm before downloading:</p>
                <p>{j.disclaimer}</p>
              </div>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-4 w-4 accent-[#062A78]" />
                <span className="text-sm text-gray-800">I accept full responsibility for verifying label compliance before use.</span>
              </label>
              {submitError && <p className="text-sm text-rose-600">{submitError}</p>}
              <button type="button" onClick={confirmDownload} className="w-full cursor-pointer rounded-lg bg-[#062A78] py-3 font-semibold text-white transition-colors hover:bg-[#051f5c]">
                Show download links
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                <p className="font-semibold">Ready</p>
                <p>Print size: {fmt(layout.widthMm)} × {fmt(layout.heightMm)} {unit}. Print at 100% (“actual size”).</p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex gap-3">
                  <button type="button" onClick={handlePdf} disabled={pdfBusy} className="flex-1 cursor-pointer rounded-lg bg-[#062A78] py-3 font-semibold text-white transition-colors hover:bg-[#051f5c] disabled:cursor-wait disabled:opacity-70">
                    {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
                  </button>
                  <button type="button" onClick={handleSvg} className="flex-1 cursor-pointer rounded-lg border-2 border-[#062A78] py-3 font-semibold text-[#062A78] transition-colors hover:bg-[#062A78] hover:text-white">
                    Download SVG
                  </button>
                </div>
                {selectedStock && selectedStock.sheet !== 'roll' && (selectedStock.perSheet ?? 1) > 1 && (
                  <button type="button" onClick={handleSheet} className="cursor-pointer rounded-lg border-2 border-[#062A78] py-2.5 text-sm font-semibold text-[#062A78] transition-colors hover:bg-[#062A78] hover:text-white">
                    Full sheet — {SHEET_NAME[selectedStock.sheet]}, {selectedStock.perSheet} labels
                  </button>
                )}
                {sheetNote && <p className="text-center text-xs text-gray-500">{sheetNote}</p>}
                {downloadError && (
                  <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                    {downloadError}
                  </p>
                )}
                <NewsletterOptIn source="label_constructor" />
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                  <p className="text-sm font-semibold text-[#062A78]">Need a Safety Data Sheet for {displayName}?</p>
                  <p className="mt-1 text-sm text-gray-600">
                    Your label and a compliant SDS are the two documents that travel with this substance.
                    SDS Manager is a recommended partner solution for authoring and managing GHS-compliant Safety Data Sheets.
                  </p>
                  <a
                    href="https://sdsmanager.com/us/sds-authoring?fpr=ghs3&fp_sid=gpauth"
                    target="_blank"
                    rel="sponsored nofollow noopener"
                    onClick={trackSdsAffiliateClick}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#f97316] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#ea670c]"
                  >
                    Create an SDS with SDS Manager †
                  </a>
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">
                    † SDS Manager is a partner solution; we may earn a commission.{' '}
                    <a href="/affiliate-disclosure/" className="underline hover:text-gray-700">See disclosure</a>.
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="mb-1 font-semibold">For official use — print on certified materials</p>
                <p>Office printing does not meet BS5609 durability requirements for chemical-resistant labels.</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Превью и соответствие ───────────────────────────────────────── */}
        {/* ⚠ Превью прокручивается САМО, независимо от страницы. Пока правая
            колонка была просто `sticky`, она прилипала только после того, как
            пользователь дочитывал её до низа: блок выше экрана до этого момента
            едет вместе со страницей. Ограничение по высоте экрана плюс
            собственная прокрутка держат этикетку на виду всегда. */}
        <div className="order-1 lg:order-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-gray-400">Live preview · {j.tag}</p>
            <div className="flex justify-center rounded-lg bg-white p-3">
              {/* ⚠ Высота ограничена экраном: этикетка A4 в портрете иначе
                  вытягивает колонку на два экрана. Пропорции держит viewBox. */}
              <div
                className="w-full max-w-[460px] [&>svg]:h-auto [&>svg]:max-h-[58vh] [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: previewSvg }}
              />
            </div>
            <div className="mt-2 text-center">
              <p className="text-xs font-medium text-gray-700">
                Print size: {fmt(layout.widthMm)} × {fmt(layout.heightMm)} {unit}
                {!fit.fits ? ' · grown to fit the content' : ''}
              </p>
              <p className="text-[11px] text-gray-400">The preview is scaled to your screen — the real print size is shown above.</p>
            </div>

            {/* ⭐⭐ Ручной размер текста.
                ⚠ Стоит ПОД ПРЕВЬЮ, а не в колонке размеров слева: это настройка
                вида, и оценивается она глазами, а не числом. Ползунок в другом
                столбце заставлял бы переводить взгляд через весь экран на
                каждый шаг. */}
            <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="body-scale" className="text-xs font-semibold text-[#062A78]">Text size</label>
                <span className="text-[11px] text-gray-500">
                  {fit.bodyMm} mm
                  {Math.abs(bodyScale - 1) > 0.001 && <> · auto {fit.autoBodyMm} mm</>}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <input
                  id="body-scale" type="range" min={60} max={250} step={5}
                  value={Math.round(bodyScale * 100)}
                  onChange={(e) => setBodyScale(Number(e.target.value) / 100)}
                  className="h-1 flex-1 accent-[#062A78]"
                />
                <span className="w-12 text-right text-xs tabular-nums text-gray-700">{Math.round(bodyScale * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setBodyScale(1)}
                  disabled={Math.abs(bodyScale - 1) < 0.001}
                  className="rounded-lg border border-gray-300 px-2 py-1 text-[11px] text-gray-700 disabled:opacity-40"
                >
                  Auto
                </button>
              </div>

              {/* ⭐ Порог «ещё влезает» — без него ползунок вверх был бы ловушкой:
                  движок и так берёт самый крупный кегль, при котором содержимое
                  помещается, значит выше почти всегда означает «этикетка вырастет». */}
              {fit.maxFittingBodyMm && fit.autoBodyMm > 0 && (
                <p className="mt-2 text-[11px] text-gray-500">
                  Up to {Math.floor((fit.maxFittingBodyMm / fit.autoBodyMm) * 100)}% still fits {fmt(sizeW)} × {fmt(sizeH)} {unit}.
                </p>
              )}
              {!fit.fits && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  The content no longer fits the size you chose, so the label grew to{' '}
                  {fmt(layout.widthMm)} × {fmt(layout.heightMm)} {unit}. It will not match the die-cut stock —
                  reduce the text size, use a larger label, or drop a precautionary statement.
                </p>
              )}
              {fit.bodyClampedTo === 'min' && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  Held at {fit.bodyMm} mm — our floor for readable print. CLP sets no numeric minimum type size:
                  Article 31(3) only requires the elements to be “of such size and spacing as to be easily read”.
                  The judgement is yours, but we will not render below this.
                </p>
              )}
              {fit.bodyClampedTo === 'max' && (
                <p className="mt-2 text-[11px] text-gray-500">
                  Held at {fit.bodyMm} mm — any larger and a single character stops fitting across the label.
                </p>
              )}
            </div>
          </div>

          {/* ⚠ Список того, чего не хватает по нормам выбранной юрисдикции.
              Этого не делает ни один бесплатный генератор в нише. */}
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
            <p className="mb-2 text-sm font-semibold text-[#062A78]">Compliance check · {j.tag}</p>
            {allIssues.length === 0 ? (
              <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                All required elements are present.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {allIssues.map((iss, i) => (
                  <li
                    key={i}
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      iss.level === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800'
                        : iss.level === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900'
                        : 'border-gray-200 bg-gray-50 text-gray-600'
                    }`}
                  >
                    {iss.text}
                    {iss.citation && <span className="ml-1 opacity-60">· {iss.citation}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-gray-400">{j.groupingCitation}</p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {j.citations.map((c) => (
                <a key={c.url} href={c.url} target="_blank" rel="noopener" className="text-[11px] text-[#062A78] underline">
                  {c.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
