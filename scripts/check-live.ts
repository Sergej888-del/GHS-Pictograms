/**
 * scripts/check-live.ts — ЕДИНСТВЕННАЯ ПРОВЕРКА, КОТОРАЯ ВИДИТ ЖИВОЙ САЙТ.
 *
 * Запуск (нужна сеть; ключ PSI не обязателен):
 *   node --experimental-strip-types scripts/check-live.ts
 *   node --experimental-strip-types scripts/check-live.ts --save     ← записать базу
 *   node --experimental-strip-types scripts/check-live.ts --wait=600 ← подождать 10 мин
 *   node --experimental-strip-types scripts/check-live.ts --runs=3 --strategy=desktop
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠⚠ ЗАЧЕМ ОНА. Остальные девять проверок смотрят на `dist` — на то, что мы
 * СОБРАЛИ. Между `dist` и человеком лежит слой Cloudflare: правила кэша, Cache
 * Rules, зональные настройки, край. Ни одна проверка его не видела, и цена
 * этого известна поимённо:
 *
 *   session 66 — `_headers` полтора месяца не действовал: зональная настройка
 *                Browser Cache TTL молча штамповала `max-age=14400` всему;
 *   session 65 — `Cache-Control` из эндпоинта Astro не действовал НИ ДНЯ:
 *                статическая сборка выбрасывает заголовки `Response`;
 *   session 69 — час ушёл на «регресс», которого не было: замер шёл через три
 *                минуты после пуша, по холодному краю.
 *
 * ⛔⛔⛔ ГЛАВНЫЙ УРОК SESSION 69 ВСТРОЕН В САМУ ПРОВЕРКУ: ЗАМЕР СРАЗУ ПОСЛЕ
 * ДЕПЛОЯ МЕРЯЕТ ХОЛОДНЫЙ КРАЙ, А НЕ ПРАВКУ. Через 3 минуты страница дала 75,
 * через 14 — 98. Отсюда `--wait` и напоминание в шапке вывода.
 *
 * ⛔⛔ И ВТОРОЙ: ОДИН ПРОГОН — НАБЛЮДЕНИЕ, ДВА ОДИНАКОВЫХ — ЗАМЕР. Поэтому
 * каждая страница гоняется дважды, и проверка САМА говорит, сошлись прогоны
 * или разошлись. Разошлись — числу верить нельзя, и это печатается прямым
 * текстом, а не оставляется на глаз читателя.
 *
 * ⛔⛔ И ТРЕТИЙ, САМЫЙ ДОРОГОЙ: ИЩИ В ПЛОХОМ ЗАМЕРЕ ПОКАЗАТЕЛЬ, КОТОРЫЙ ТВОЯ
 * ПРАВКА ТРОНУТЬ НЕ МОГЛА. В session 69 TBT вырос в шесть раз от правки, не
 * касавшейся ни строки JS, — значит сдвинулся стенд, а не сайт. Поэтому здесь
 * печатаются ВСЕ метрики целиком, а не одна «оценка»: сравнивать надо то, что
 * правка тронуть не могла.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// ── Что меряем ──────────────────────────────────────────────────────────────
/**
 * ⚠ Список короткий НАМЕРЕННО. Каждая страница — это два запроса к PSI и
 * примерно минута ожидания. Мерить надо то, что меняется и на что смотрят:
 * конструктор (самый тяжёлый остров), страница вещества (3 650 таких), хаб.
 */
const PAGES: { url: string; note: string }[] = [
  { url: 'https://ghspictograms.com/ghs-label-maker/', note: 'конструктор — самый тяжёлый остров' },
  { url: 'https://ghspictograms.com/substances/aniline-62-53-3/', note: 'образец страницы вещества (их 3 650)' },
];

/**
 * ⭐⭐ ФАЙЛЫ, У КОТОРЫХ КЭШ ОБЯЗАН БЫТЬ ДОЛГИМ.
 *
 * ⚠⚠ ЭТО И ЕСТЬ ОТВЕТ НА ВОПРОС, КОТОРЫЙ SESSION 69 ОСТАВИЛА ОТКРЫТЫМ. В
 * `public/_headers` написано `max-age=31536000, immutable` для `/fonts/*` и
 * `/_astro/*`. Но написанное вступает в силу, только если в Cloudflare стоит
 * Browser Cache TTL = «Respect Existing Headers»; иначе зональная настройка
 * перебивает файл МОЛЧА — так и было полтора месяца до session 66.
 *
 * Lighthouse перечисляет в аудите `uses-long-cache-ttl` ресурсы с КОРОТКИМ
 * сроком. Попал наш шрифт в этот список — значит `_headers` погашен.
 */
const LONG_CACHE_PREFIXES = ['/fonts/', '/_astro/'];

const BASELINE = new URL('./fixtures/live-baseline.json', import.meta.url);
const ENV_FILE = new URL('../.env.local', import.meta.url);

// ── Разбор аргументов ───────────────────────────────────────────────────────
const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const has = (name: string) => process.argv.includes(`--${name}`);

const RUNS = Math.max(1, Number(arg('runs') ?? 2));
const STRATEGY = (arg('strategy') ?? 'mobile') as 'mobile' | 'desktop';
const WAIT_S = Number(arg('wait') ?? 0);
const SAVE = has('save');

/**
 * Ключ PSI из `.env.local`.
 *
 * ⚠⚠ ЧИТАЕТСЯ САМОСТОЯТЕЛЬНО, БЕЗ `dotenv`. Проверка обязана идти под
 * `node --experimental-strip-types`, то есть без сборки и без tsx: `dotenv`
 * потянул бы за собой node_modules, а с ним и всю разницу между машинами.
 * Файл простой — три строки `КЛЮЧ=значение`.
 *
 * ⚠ Ключ НЕ обязателен: PSI отвечает и анонимно, просто жёстче лимитит.
 * ⛔ `.env.local` лежит в `.gitignore` — и обязан там лежать.
 */
function readKey(): string | null {
  if (process.env.PSI_API_KEY) return process.env.PSI_API_KEY;
  try {
    for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = /^\s*PSI_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  } catch { /* файла нет — работаем без ключа */ }
  return null;
}

const KEY = readKey();

// ── Метрики ─────────────────────────────────────────────────────────────────
/**
 * ⚠⚠ БЕРЁМ ВСЕ ШЕСТЬ, А НЕ ОДНУ «ОЦЕНКУ». Оценка — это взвешенная сумма, и по
 * ней НЕЛЬЗЯ понять, сдвинулся сайт или стенд. Различить их можно только так:
 * найти показатель, который правка тронуть не могла, и посмотреть на него.
 * Правка шрифтов не трогает JS — значит TBT обязан стоять на месте. Не стоит —
 * шумит стенд, и весь прогон недоверен целиком, включая «подтверждающую» часть.
 */
const METRICS = [
  /**
   * ⭐⭐ ОТВЕТ СЕРВЕРА ПЕРВЫМ, И ЭТО НЕ ПОРЯДОК РАДИ ПОРЯДКА.
   *
   * ⚠⚠ Именно он различает два случая, которые по оценке неотличимы: «сайт стал
   * медленнее» и «край Cloudflare отдал страницу с origin». Первый лечится
   * кодом, второй — ожиданием. Session 70: конструктор дал FCP 3,6 с при TBT
   * 20 мс, то есть время ушло не на JavaScript, а на ожидание ответа, — и без
   * этой строки отличить холодный край от регресса было нечем.
   */
  { id: 'server-response-time', short: 'TTFB', hint: '⭐ ответ сервера: край или origin' },
  { id: 'first-contentful-paint', short: 'FCP', hint: 'первая отрисовка' },
  { id: 'largest-contentful-paint', short: 'LCP', hint: 'главный элемент экрана' },
  { id: 'total-blocking-time', short: 'TBT', hint: '⭐ JS блокирует поток' },
  { id: 'cumulative-layout-shift', short: 'CLS', hint: 'скачки вёрстки' },
  { id: 'speed-index', short: 'SI', hint: 'скорость наполнения' },
  { id: 'interactive', short: 'TTI', hint: 'готовность к вводу' },
];

/**
 * ⭐⭐ ПОЛЕВЫЕ МЕТРИКИ — ЭТО НЕ ТО ЖЕ САМОЕ, ЧТО ВСЁ ОСТАЛЬНОЕ ЗДЕСЬ.
 *
 * ⚠⚠ Всё выше — ЛАБОРАТОРИЯ: один прогон Lighthouse на подставном телефоне с
 * подставной сетью. Ниже — ПОЛЕ: что за последние 28 дней видели настоящие
 * посетители в Chrome. Числа расходятся законно и сильно, и путать их нельзя:
 * лабораторный CLS = 0 (session 69) при поле «7 % Poor» — не противоречие, а
 * два разных факта. Правит лабораторию правка кода, поле — время.
 *
 * ⭐ Приезжают тем же ответом PSI, отдельного ключа не нужно.
 * ⚠ Могут отсутствовать: у страницы или домена не набралось выборки Chrome UX
 * Report. Отсутствие данных — это «мало трафика», а не «всё хорошо».
 *
 * ⭐ Ради них и заведено: пункты очереди №50 (CLS конструктора) и №51
 * (`#storage-search`, INP 1 584 мс) требуют смотреть ПОЛЕ, а не лабораторию.
 */
const FIELD = [
  { id: 'LARGEST_CONTENTFUL_PAINT_MS', short: 'LCP', unit: 'мс' },
  { id: 'INTERACTION_TO_NEXT_PAINT', short: 'INP', unit: 'мс' },
  { id: 'CUMULATIVE_LAYOUT_SHIFT_SCORE', short: 'CLS', unit: '' },
  { id: 'FIRST_CONTENTFUL_PAINT_MS', short: 'FCP', unit: 'мс' },
];

type FieldMetric = { p75: number; good: number; ni: number; poor: number; category: string };

type Run = {
  score: number;
  metrics: Record<string, { value: number; display: string }>;
  bytes: number;
  requests: number;
  /** Ресурсы с коротким кэшем: url → срок в мс. */
  shortCache: Record<string, number>;
  /** Поле по ЭТОЙ странице; пусто — выборки не набралось. */
  field: Record<string, FieldMetric>;
  /** Поле по ДОМЕНУ целиком. ⚠ Другая величина, не «то же самое пошире». */
  fieldOrigin: Record<string, FieldMetric>;
  /** Какой элемент оказался самым крупным на экране. */
  lcpElement: string;
  /** Что задерживает первую отрисовку: url → обещанная экономия, мс. */
  blocking: { url: string; ms: number }[];
  /** Сколько всего обещает вернуть снятие блокировки. */
  blockingTotalMs: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Разбор ответа PSI отделён от похода в сеть.
 *
 * ⚠⚠ ЭТО НЕ АККУРАТНОСТЬ РАДИ АККУРАТНОСТИ. Из облака сети до
 * `www.googleapis.com` НЕТ: песочница пускает только хосты из белого списка и
 * отвечает 403 «Host not in allowlist» ещё до Google. Значит помощник не может
 * проверить эту проверку живым прогоном — а непроверенная проверка врёт ровно
 * тогда, когда на неё положились. Разбор, отделённый от сети, гоняется на
 * сохранённом ответе: `--from=файл.json`.
 */
export function parsePsi(j: any): Run {
  const lh = j.lighthouseResult;
  if (!lh) throw new Error('в ответе нет lighthouseResult');

  const metrics: Run['metrics'] = {};
  for (const m of METRICS) {
    const a = lh.audits?.[m.id];
    metrics[m.short] = { value: a?.numericValue ?? NaN, display: a?.displayValue ?? '—' };
  }

  const shortCache: Record<string, number> = {};
  for (const it of lh.audits?.['uses-long-cache-ttl']?.details?.items ?? []) {
    if (typeof it.url === 'string') shortCache[it.url] = Number(it.cacheLifetimeMs ?? 0);
  }

  /**
   * ⚠ Доли Good / Needs improvement / Poor лежат в `distributions` тремя
   * ведёрками по порядку. Порядок задан спецификацией CrUX, но проверяем
   * длину: пустой массив здесь означает «данных нет», а не «ноль процентов».
   */
  const readField = (src: any): Record<string, FieldMetric> => {
    const out: Record<string, FieldMetric> = {};
    for (const f of FIELD) {
      const m = src?.metrics?.[f.id];
      if (!m || !Array.isArray(m.distributions) || m.distributions.length < 3) continue;
      const pct = (i: number) => Math.round((m.distributions[i]?.proportion ?? 0) * 100);
      out[f.short] = {
        p75: Number(m.percentile ?? NaN),
        good: pct(0), ni: pct(1), poor: pct(2),
        category: String(m.category ?? '—'),
      };
    }
    return out;
  };

  /**
   * ⭐⭐ КТО ИМЕННО ЗАДЕРЖИВАЕТ ОТРИСОВКУ — ПОИМЁННО, А НЕ «НАВЕРНОЕ, СКРИПТЫ».
   *
   * ⚠⚠ LCP в пять секунд при TTFB в две миллисекунды означает, что сервер тут
   * ни при чём: время уходит между ответом и картинкой. Без этих двух аудитов
   * дальше идут догадки — «наверное, GTM», «наверное, шрифты», — а догадка
   * приводит к правке того, что не виновато. Lighthouse знает ответ и называет
   * файлы; наше дело — не выбросить его в тишину.
   *
   * ⚠ `overallSavingsMs` — ОБЕЩАНИЕ Lighthouse, а не измеренный факт: столько
   * он рассчитывает вернуть, если убрать блокировку. Проверяется единственным
   * способом — убрать и померить снова.
   */
  const blocking = (lh.audits?.['render-blocking-resources']?.details?.items ?? [])
    .map((it: any) => ({ url: String(it.url ?? ''), ms: Math.round(Number(it.wastedMs ?? 0)) }))
    .filter((x: any) => x.url)
    .sort((a: any, b: any) => b.ms - a.ms);

  return {
    lcpElement: String(
      lh.audits?.['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet
      ?? lh.audits?.['largest-contentful-paint-element']?.displayValue ?? '—',
    ),
    blocking,
    blockingTotalMs: Math.round(Number(lh.audits?.['render-blocking-resources']?.details?.overallSavingsMs ?? 0)),
    score: Math.round((lh.categories?.performance?.score ?? 0) * 100),
    metrics,
    bytes: Number(lh.audits?.['total-byte-weight']?.numericValue ?? 0),
    requests: (lh.audits?.['network-requests']?.details?.items ?? []).length,
    shortCache,
    field: readField(j.loadingExperience),
    fieldOrigin: readField(j.originLoadingExperience),
  };
}

async function psi(url: string, attempt = 1): Promise<Run> {
  // ⭐ Сухой прогон на сохранённом ответе — им и проверяется разбор без сети.
  const from = arg('from');
  if (from) return parsePsi(JSON.parse(readFileSync(from, 'utf8')));

  const q = new URLSearchParams({ url, strategy: STRATEGY, category: 'performance' });
  if (KEY) q.set('key', KEY);
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`;

  const res = await fetch(api);
  if (!res.ok) {
    /**
     * ⚠⚠ ТЕЛО ОТВЕТА ПЕЧАТАЕТСЯ, А НЕ ПРОГЛАТЫВАЕТСЯ. Именно оно отличает
     * «Google лимитит» от «сеть не пускает»: 403 из облака оказался не отказом
     * Google, а строкой «Host not in allowlist» от песочницы. По одному коду
     * состояния эти два случая неразличимы, а лечатся они противоположно.
     */
    const body = await res.text().catch(() => '');
    if (body) console.log(`     ответ: ${body.slice(0, 200).replace(/\s+/g, ' ')}`);
    /**
     * ⚠⚠ 429 БЕЗ КЛЮЧА — НОРМА, А НЕ ПОЛОМКА. Анонимная квота узкая, и ждать
     * дешевле, чем падать: прогон стоит минуты, а повтор с начала — всех минут
     * сразу. Ждём по нарастающей, три попытки.
     */
    if ((res.status === 429 || res.status >= 500) && attempt <= 3) {
      const pause = attempt * 30;
      console.log(`     ⏳ ${res.status}, жду ${pause} с (попытка ${attempt} из 3)${KEY ? '' : ' — ключа нет, квота анонимная'}`);
      await sleep(pause * 1000);
      return psi(url, attempt + 1);
    }
    throw new Error(`PSI ответил ${res.status} ${res.statusText}`);
  }

  return parsePsi(await res.json());
}

// ── Вывод ───────────────────────────────────────────────────────────────────
let failed = 0;
let warned = 0;
const fail = (t: string) => { failed++; console.log(`  ✗ ${t}`); };
const warn = (t: string) => { warned++; console.log(`  ⚠ ${t}`); };

const fmtMs = (v: number) => (Number.isFinite(v) ? `${Math.round(v)}` : '—');
const fmtKb = (b: number) => `${(b / 1024).toFixed(0)} КиБ`;

type Saved = Record<string, { score: number; metrics: Record<string, number>; when: string }>;
const baseline: Saved = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const next: Saved = { ...baseline };

console.log(`\nПроверка живого сайта через PageSpeed Insights`);
console.log(`  режим:   ${STRATEGY}, прогонов на страницу: ${RUNS}`);
console.log(`  ключ:    ${KEY ? 'есть' : '⚠ НЕТ — квота анонимная, возможны паузы'}`);
console.log(`  база:    ${existsSync(BASELINE) ? 'есть, будет сравнение' : '⚠ пусто — первый прогон, сравнивать не с чем'}`);
console.log(`\n⛔⛔ ЗАМЕР СРАЗУ ПОСЛЕ ДЕПЛОЯ МЕРЯЕТ ХОЛОДНЫЙ КРАЙ, А НЕ ПРАВКУ.`);
console.log(`   Session 69: через 3 минуты — 75, через 14 — 98. Ждать минимум десять минут.`);
if (WAIT_S > 0) {
  console.log(`\n⏳ Жду ${WAIT_S} с перед первым запросом…`);
  await sleep(WAIT_S * 1000);
}

for (const page of PAGES) {
  console.log(`\n━━ ${page.url}`);
  console.log(`   ${page.note}`);

  const runs: Run[] = [];
  for (let i = 1; i <= RUNS; i++) {
    process.stdout.write(`   прогон ${i} из ${RUNS}… `);
    try {
      const r = await psi(page.url);
      runs.push(r);
      console.log(`оценка ${r.score}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`✗ ${msg}`);
      /**
       * ⛔⛔ «fetch failed» БЕЗ ПОДРОБНОСТЕЙ — ЭТО ПОЧТИ ВСЕГДА TLS, А НЕ СЕТЬ.
       *
       * На машине, где TLS перехватывается (антивирус, корпоративный прокси),
       * Node не доверяет подсунутому сертификату и падает ровно этой строкой —
       * одинаковой и для «нет интернета», и для «сертификат чужой». Отличить их
       * по сообщению нельзя, поэтому подсказка печатается всегда: она стоит две
       * строки, а её отсутствие стоило session 70 одного лишнего круга.
       *
       * ⚠ Тот же флаг стоит во всех сетевых командах проекта: `build:local`,
       * `check:dist`, `check:seo`. Проверка сети без него — недосмотр, а не
       * особый случай.
       */
      if (/fetch failed|certificate|self-signed|unable to verify/i.test(msg)) {
        console.log(`     ⚠ Похоже на перехват TLS. Команда обязана идти с флагом --use-system-ca:`);
        console.log(`       node --use-system-ca --experimental-strip-types scripts/check-live.ts`);
        console.log(`       (в package.json он уже прописан — проверь, что запускаешь через npm run check:live)`);
      }
    }
    if (i < RUNS) await sleep(5000);
  }

  if (runs.length === 0) { fail(`${page.url}: ни один прогон не удался`); continue; }

  // ── Сошлись ли прогоны ────────────────────────────────────────────────────
  /**
   * ⛔⛔ ЭТО НЕ УКРАШЕНИЕ, А УСЛОВИЕ ДОВЕРИЯ К ЧИСЛУ. Пока прогоны расходятся,
   * никакого «стало лучше на 5 пунктов» не существует — есть шум стенда.
   * Проверка говорит это прямым текстом, чтобы не пришлось замечать глазами.
   */
  const scores = runs.map((r) => r.score);
  const spread = Math.max(...scores) - Math.min(...scores);
  const score = Math.min(...scores);   // ⚠ берём ХУДШИЙ: обещать надо нижнюю границу
  console.log(`   оценки: ${scores.join(' · ')} → разброс ${spread}`);
  if (runs.length < 2) {
    warn('один прогон — это наблюдение, а не замер. Запусти ещё раз');
  } else if (spread > 5) {
    warn(`прогоны разошлись на ${spread} пунктов — стенд шумит, числу верить нельзя`);
  } else {
    console.log(`   ✓ прогоны сошлись (разброс ${spread} ≤ 5) — это замер, а не наблюдение`);
  }

  // ── Все метрики целиком ───────────────────────────────────────────────────
  console.log(`   ${'метрика'.padEnd(6)} ${'значение'.padEnd(12)} что это`);
  for (const m of METRICS) {
    const vals = runs.map((r) => r.metrics[m.short]?.value ?? NaN);
    const shown = runs[0].metrics[m.short]?.display ?? '—';
    const dev = vals.length > 1 ? ` (прогоны: ${vals.map(fmtMs).join(' · ')})` : '';
    console.log(`   ${m.short.padEnd(6)} ${String(shown).padEnd(12)} ${m.hint}${dev}`);
  }
  console.log(`   вес страницы ${fmtKb(runs[0].bytes)}, запросов ${runs[0].requests}`);

  /**
   * ⚠ Печатается ВСЕГДА, а не только при плохой оценке: список блокирующих
   * файлов — это рабочий список задач, и он полезен ровно тогда, когда до него
   * ещё не дошли руки.
   */
  if (runs[0].lcpElement && runs[0].lcpElement !== '—') {
    console.log(`   самый крупный элемент экрана: ${runs[0].lcpElement.slice(0, 90)}`);
  }
  if (runs[0].blocking.length) {
    console.log(`   задерживают первую отрисовку (Lighthouse обещает вернуть ${runs[0].blockingTotalMs} мс):`);
    for (const b of runs[0].blocking.slice(0, 6)) {
      const short = b.url.replace('https://ghspictograms.com', '').replace(/^https?:\/\//, '');
      console.log(`     ${String(b.ms).padStart(5)} мс  ${short.slice(0, 80)}`);
    }
  } else {
    console.log(`   ✓ блокирующих отрисовку ресурсов нет`);
  }

  // ── Сравнение с базой ─────────────────────────────────────────────────────
  const prev = baseline[page.url];
  if (prev) {
    const d = score - prev.score;
    const sign = d > 0 ? `+${d}` : String(d);
    console.log(`   было ${prev.score} (${prev.when.slice(0, 16).replace('T', ' ')}) → стало ${score}   ${d === 0 ? 'без изменений' : sign}`);
    /**
     * ⛔⛔ ВОТ РАДИ ЧЕГО ПЕЧАТАЮТСЯ ВСЕ МЕТРИКИ. Если оценка просела, а вместе с
     * ней прыгнул показатель, которого правка касаться не могла, — сдвинулся
     * СТЕНД. Session 69: TBT вырос в шесть раз от правки, не тронувшей JS, и
     * только это удержало от «исправления», которое было бы вредом.
     */
    if (d <= -5) {
      const moved = METRICS
        .map((m) => ({ m, now: runs[0].metrics[m.short]?.value ?? NaN, was: prev.metrics?.[m.short] }))
        .filter((x) => Number.isFinite(x.now) && Number.isFinite(x.was as number) && (x.was as number) > 0)
        .map((x) => ({ short: x.m.short, ratio: x.now / (x.was as number) }))
        .filter((x) => x.ratio >= 2 || x.ratio <= 0.5);
      warn(`просадка на ${Math.abs(d)} пунктов`);
      if (moved.length) {
        console.log(`     ⛔ и вместе с ней в разы сдвинулись: ${moved.map((x) => `${x.short} ×${x.ratio.toFixed(1)}`).join(', ')}`);
        console.log(`        Спроси себя: могла ли ТВОЯ правка тронуть эти показатели?`);
        console.log(`        Если нет — сдвинулся стенд, а не сайт, и весь прогон недоверен целиком.`);
      }
    }
  }

  /**
   * ⛔⛔ В БАЗУ ИДЁТ ТОЛЬКО СОШЕДШИЙСЯ ЗАМЕР.
   *
   * Session 70: анилин дал 98 и 73 в двух обращениях подряд, и `--save`
   * записал 73 — число, которого не было. Следующая сессия сравнивала бы с ним
   * и увидела «рост на 25 пунктов» там, где ничего не менялось.
   * ⭐ Правило то же, что и у пустой базы: не сохранять результат неудавшегося
   * замера. Предупредить и не записать — честнее, чем записать и предупредить.
   */
  if (runs.length >= 2 && spread > 5) {
    console.log(`   ⚠ в базу НЕ записано: прогоны разошлись на ${spread}, это не замер`);
    continue;
  }

  next[page.url] = {
    score,
    metrics: Object.fromEntries(METRICS.map((m) => [m.short, runs[0].metrics[m.short]?.value ?? NaN])),
    when: new Date().toISOString(),
  };

  // ── ⭐⭐ ПОЛЕ: ЧТО ВИДЕЛИ НАСТОЯЩИЕ ПОСЕТИТЕЛИ ────────────────────────────
  /**
   * ⚠⚠ ПЕЧАТАЕТСЯ ОТДЕЛЬНЫМ БЛОКОМ И НАЗЫВАЕТСЯ СВОИМ ИМЕНЕМ. Смешать поле с
   * лабораторией — значит однажды обрадоваться лабораторному CLS = 0 при поле
   * «7 % Poor» и закрыть пункт очереди, который не закрыт.
   * ⚠ Поле меняется за недели, а не за деплой: сравнивать его с прошлым
   * прогоном получасовой давности бессмысленно.
   */
  const fieldRows = Object.entries(runs[0].field);
  const originRows = Object.entries(runs[0].fieldOrigin);
  if (fieldRows.length === 0 && originRows.length === 0) {
    warn('поля нет: у страницы и домена не набралось выборки Chrome UX Report — это «мало трафика», а не «всё хорошо»');
  } else {
    const show = (title: string, rows: [string, FieldMetric][]) => {
      if (!rows.length) return;
      console.log(`   ${title}`);
      for (const [short, m] of rows) {
        const unit = FIELD.find((f) => f.short === short)?.unit ?? '';
        const p75 = short === 'CLS' ? (m.p75 / 100).toFixed(2) : String(Math.round(m.p75));
        const mark = m.category === 'FAST' ? '✓' : m.category === 'AVERAGE' ? '⚠' : '⛔';
        console.log(`     ${mark} ${short.padEnd(4)} p75 ${(p75 + unit).padEnd(8)} good ${String(m.good).padStart(3)} % · ni ${String(m.ni).padStart(3)} % · poor ${String(m.poor).padStart(3)} %`);
      }
    };
    show('поле, эта страница (28 дней, настоящие посетители):', fieldRows);
    show('поле, домен целиком:', originRows);
  }

  // ── ⭐⭐ КЭШ: ТО, ЧЕГО НЕ ВИДИТ НИ ОДНА ДРУГАЯ ПРОВЕРКА ────────────────────
  const offenders = Object.entries(runs[0].shortCache)
    .filter(([u]) => LONG_CACHE_PREFIXES.some((p) => u.includes(p)));
  if (offenders.length === 0) {
    console.log(`   ✓ кэш: ни один файл из ${LONG_CACHE_PREFIXES.join(', ')} не попал в список «короткий срок»`);
  } else {
    fail('⛔ `_headers` НЕ ДЕЙСТВУЕТ: край отдаёт короткий срок файлам, которым положен год');
    for (const [u, ms] of offenders.slice(0, 8)) {
      console.log(`      ${u.replace('https://ghspictograms.com', '')} → ${Math.round(ms / 1000)} с`);
    }
    console.log(`      Лечение: Cloudflare → Caching → Configuration →`);
    console.log(`      Browser Cache TTL = «Respect Existing Headers» (session 66), затем Cache Rules —`);
    console.log(`      правило с «Ignore cache-control header» гасит _headers молча.`);
  }
}

/**
 * ⛔⛔ БАЗА НЕ ПИШЕТСЯ, ЕСЛИ ПИСАТЬ НЕЧЕГО.
 *
 * Первый живой прогон session 70 упал на TLS во всех четырёх обращениях — и
 * `--save` бодро записал в базу пустой `{}`, отрапортовав «База обновлена».
 * Пустая база молчаливо отменяет сравнение в СЛЕДУЮЩИЙ раз: файл есть, шапка
 * говорит «база есть, будет сравнение», а сравнивать не с чем.
 *
 * ⭐ Правило общее: не сохранять результат неудавшегося замера. Пустой файл на
 * месте настоящего хуже, чем отсутствие файла, — он выглядит как данные.
 */
if (SAVE && Object.keys(next).length === 0) {
  console.log(`\n⚠ База НЕ записана: ни одного удачного прогона. Пустой файл на месте`);
  console.log(`  настоящего хуже, чем отсутствие файла, — он выглядит как данные.`);
} else if (SAVE) {
  writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  console.log(`\n💾 База обновлена: scripts/fixtures/live-baseline.json`);
  console.log(`   ⚠ Записывай базу ТОЛЬКО когда прогоны сошлись — иначе в неё уедет шум,`);
  console.log(`     и следующая сессия будет сравниваться с числом, которого не было.`);
} else if (Object.keys(next).length > Object.keys(baseline).length || !existsSync(BASELINE)) {
  console.log(`\n⚠ База не записана. Чтобы запомнить эти числа: добавь --save`);
}

console.log(failed === 0 && warned === 0
  ? '\n✅ Живой сайт проверен, расхождений нет.'
  : `\n${failed ? '❌' : '⚠'} Провалов: ${failed}, предупреждений: ${warned}`);
process.exit(failed === 0 ? 0 : 1);
