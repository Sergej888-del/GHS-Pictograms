// functions/api/classify/_shared.ts
// Общий слой обеих функций классификатора: service-ключ, Turnstile, лимит,
// снимок справочника и сборка входа движка.
//
// ⚠⚠⚠ ФАЙЛ С ПОДЧЁРКИВАНИЕМ — Pages Functions его НЕ маршрутизирует. Это не
// украшение имени: положи он рядом без «_», и адрес `/api/classify/_shared`
// начал бы существовать. Экспортов `onRequest*` здесь нет в любом случае.
//
// ⛔⛔ SERVICE-КЛЮЧ ЖИВЁТ ТОЛЬКО ЗДЕСЬ. Ни один импорт из `src/components`
// не должен тянуть этот файл: он собирается в Function, не в бандл сайта.
// Сторож — `check:dist` (строка `SUPABASE_SERVICE_ROLE_KEY` в `dist/` = красный).
//
// ⛔ Тексты для человека — по-английски: их читает посетитель.

import type {
  Annex6Ate, ClassCat, ClassifierData, ComponentInput, DataRelease, GenericLimitRow,
  MFactorRow, MixtureInput, PhysicalState, RegistryEntry, SclRow,
} from '../../../src/lib/classifier/types.ts';

export interface Env {
  PUBLIC_SUPABASE_URL: string;
  /** ⛔ Только Pages → Settings → Variables, без префикса PUBLIC_. */
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Пусто — проверка Turnstile выключена (и об этом пишется в лог). */
  TURNSTILE_SECRET?: string;
  /** Лимит анонима, расчётов в час на IP. По умолчанию 30 (design-doc §10.7). */
  CLASSIFY_RATE_LIMIT?: string;
}

const RATE_WINDOW_SECONDS = 3600;
const DEFAULT_RATE_LIMIT = 30;
/** Столько `index_number` принимает `get_classifier_profile` за один вызов. */
const PROFILE_CHUNK = 50;
/** Больше — это уже не рецептура, а выгрузка справочника. */
export const MAX_COMPONENTS = 50;

/* ── ответы ──────────────────────────────────────────────────────────────── */

export function corsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': 'https://ghspictograms.com',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
  };
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), ...extra } });
}

export function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ ok: false, error: { code, message, ...extra } }, status);
}

/* ── база ────────────────────────────────────────────────────────────────── */

export async function rpc<T>(env: Env, name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env.PUBLIC_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // ⚠ В лог — подробности, посетителю — общий текст: в ошибке PostgREST
    // может оказаться имя таблицы и кусок запроса.
    console.error('classifier rpc failed', JSON.stringify({ name, status: res.status, body: text.slice(0, 500) }));
    throw new Error(`rpc ${name} failed with ${res.status}`);
  }
  return (await res.json()) as T;
}

/* ── Turnstile ───────────────────────────────────────────────────────────── */

export async function verifyTurnstile(env: Env, token: unknown, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) {
    // ⚠ Ключа нет — проверка выключена ОСОЗНАННО (первый деплой до заведения
    // виджета). Лимит по IP при этом работает. Строка в логе, чтобы это
    // состояние не стало постоянным молча.
    console.warn('classifier: TURNSTILE_SECRET is not set — captcha check skipped');
    return true;
  }
  if (typeof token !== 'string' || !token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return !!data.success;
}

/* ── лимит ───────────────────────────────────────────────────────────────── */

/**
 * ⚠ Структурный тип, а не `Request`: в Pages Functions приходит
 * `Request<unknown, IncomingRequestCfProperties>` из `@cloudflare/workers-types`,
 * и он НЕ совместим с глобальным DOM-Request. Нам от него нужны только
 * заголовки — просим ровно их.
 */
export type RequestLike = { headers: { get(name: string): string | null } };

export function clientIp(request: RequestLike): string {
  return request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? '';
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface RateVerdict { allowed: boolean; remaining: number; limit: number; resetAt: string }

/**
 * Счётчик живёт в базе, а не в Cache API: кэш Cloudflare локален для
 * колоцентра, и «30 в час» превратилось бы в «30 на каждый город».
 * ⚠ IP не хранится: ключ — SHA-256 от «ip|bucket».
 */
export async function rateLimit(env: Env, request: RequestLike, bucket: string): Promise<RateVerdict> {
  const ip = clientIp(request);
  const limit = Number(env.CLASSIFY_RATE_LIMIT ?? DEFAULT_RATE_LIMIT) || DEFAULT_RATE_LIMIT;
  const key = await sha256Hex(`${ip}|${bucket}`);
  const v = await rpc<RateVerdict>(env, 'api_rate_limit_hit', {
    p_key: key, p_limit: limit, p_window_seconds: RATE_WINDOW_SECONDS,
  });
  return v;
}

export function tooMany(v: RateVerdict): Response {
  return json({
    ok: false,
    error: {
      code: 'RATE_LIMIT',
      message: `You have used all ${v.limit} free calculations for this hour. They come back at ${v.resetAt}. A free account will lift this limit — it is coming.`,
      resetAt: v.resetAt,
    },
  }, 429, { 'Retry-After': '600' });
}

/* ── справочник ──────────────────────────────────────────────────────────── */

interface ReferencePayload {
  release: DataRelease | null;
  generic: GenericLimitRow[];
  registry: RegistryEntry[];
}

/**
 * 117 строк правил + 121 строка реестра меняются раз в релиз, а не раз в
 * запрос. Кэш Cloudflare на 10 минут по постоянному ключу: релиз едет вместе
 * со снимком, поэтому «протухший» ответ виден в строке версии, а не молчит.
 */
export async function loadReference(env: Env, cacheStore: Cache | null): Promise<ClassifierData> {
  const cacheKey = new Request('https://classifier.internal/reference');
  if (cacheStore) {
    const hit = await cacheStore.match(cacheKey);
    if (hit) return (await hit.json()) as ClassifierData;
  }
  const payload = await rpc<ReferencePayload>(env, 'get_classifier_reference', {});
  const data: ClassifierData = {
    generic: payload.generic ?? [],
    registry: payload.registry ?? [],
    release: payload.release ?? null,
  };
  if (cacheStore) {
    await cacheStore.put(cacheKey, new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=600' },
    }));
  }
  return data;
}

/* ── профиль компонентов ─────────────────────────────────────────────────── */

export interface ProfilePairRow {
  classCode: string; categoryCode: string | null; categoryRaw: string | null;
  hCode: string | null; hCodeFull: string | null; organs: string | null;
  hMarker: string | null; star: boolean; testRequired: boolean; raw: string; flags: string[];
}
export interface ProfileRow {
  substance: {
    name: string | null; iupacName: string | null; casPrimary: string | null; ecPrimary: string | null;
    hCodes: string[] | null; euhCodes: string[] | null;
    lc50Fish: number | null; ec50Daphnia: number | null; ec50Algae: number | null;
    readilyBiodegradable: boolean | null;
  } | null;
  pairs: ProfilePairRow[] | null;
  scl: SclRow[] | null;
  mFactors: MFactorRow[] | null;
  ate: Annex6Ate[] | null;
  star: { raw: string }[] | null;
  notes: string[] | null;
  rowFlags: string[] | null;
}
export type ProfileMap = Record<string, ProfileRow>;

export async function loadProfiles(env: Env, indexNumbers: string[]): Promise<ProfileMap> {
  const uniq = [...new Set(indexNumbers.filter(Boolean))];
  const out: ProfileMap = {};
  for (let i = 0; i < uniq.length; i += PROFILE_CHUNK) {
    const chunk = uniq.slice(i, i + PROFILE_CHUNK);
    const part = await rpc<ProfileMap>(env, 'get_classifier_profile', { p_index: chunk });
    Object.assign(out, part);
  }
  return out;
}

/* ── разбор и проверка тела запроса ──────────────────────────────────────── */

export interface ParsedBody { input: MixtureInput; annex6Indexes: string[] }

const STATES: PhysicalState[] = ['solid', 'liquid', 'gas'];

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Разбор тела. ⭐⭐ Классификации компонента Annex VI из запроса НЕ БЕРУТСЯ:
 * они подтягиваются здесь же по `indexNumber`. Клиент может прислать что
 * угодно; правовой контур должен зависеть от базы, а не от браузера.
 * Свои классификации присылает только компонент `supplier` — и они сверяются
 * с реестром.
 */
export function parseBody(raw: unknown): { error?: string; parsed?: ParsedBody } {
  if (!raw || typeof raw !== 'object') return { error: 'The request body must be a JSON object.' };
  const body = raw as Record<string, unknown>;
  const rawComponents = Array.isArray(body.components) ? body.components : null;
  if (!rawComponents) return { error: 'components must be an array.' };
  if (!rawComponents.length) return { error: 'Add at least one ingredient.' };
  if (rawComponents.length > MAX_COMPONENTS) {
    return { error: `A mixture may carry up to ${MAX_COMPONENTS} ingredients in this version.` };
  }

  const props = (body.properties ?? {}) as Record<string, unknown>;
  const physicalState = STATES.includes(props.physicalState as PhysicalState)
    ? (props.physicalState as PhysicalState) : 'liquid';
  const inhalForm = ['gas', 'vapour', 'dust_mist'].includes(props.inhalForm as string)
    ? (props.inhalForm as MixtureInput['properties']['inhalForm']) : null;

  const components: ComponentInput[] = [];
  const annex6Indexes: string[] = [];

  for (let i = 0; i < rawComponents.length; i++) {
    const c = rawComponents[i] as Record<string, unknown>;
    if (!c || typeof c !== 'object') return { error: `Ingredient ${i + 1} is not an object.` };
    const conc = num(c.conc);
    if (conc == null || conc < 0 || conc > 100) return { error: `Ingredient ${i + 1}: the concentration must be a number between 0 and 100.` };
    const concMax = num(c.concMax);
    if (concMax != null && (concMax < conc || concMax > 100)) {
      return { error: `Ingredient ${i + 1}: the upper bound of the range must be between the lower bound and 100.` };
    }
    const source = c.source === 'supplier' ? 'supplier' : 'annex6';
    const indexNumber = typeof c.indexNumber === 'string' && c.indexNumber.trim() ? c.indexNumber.trim() : null;
    if (source === 'annex6' && !indexNumber) {
      // Компонент вне Annex VI (вода, носитель) — законный случай: он приходит
      // как `supplier` без классификаций, а не как Annex VI без ключа.
      return { error: `Ingredient ${i + 1}: an Annex VI ingredient needs its index number. Add water, carriers and in-house blends as supplier entries.` };
    }
    if (indexNumber) annex6Indexes.push(indexNumber);

    const classifications: ClassCat[] = source === 'supplier' ? parsePairs(c.classifications) : [];

    components.push({
      id: typeof c.id === 'string' && c.id ? c.id : `c${i + 1}`,
      source,
      indexNumber,
      name: typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 200) : `Ingredient ${i + 1}`,
      conc,
      concMax,
      classifications,
      knownNonhazard: c.knownNonhazard === true,
      manualAte: parseManualAte(c.manualAte),
    });
  }

  const input: MixtureInput = {
    components,
    properties: {
      physicalState,
      inhalForm,
      ph: num(props.ph),
      acidAlkaliReserve: props.acidAlkaliReserve === true,
      viscosityMm2s40c: num(props.viscosityMm2s40c),
      separatesIntoLayers: props.separatesIntoLayers === true,
      flashPointC: num(props.flashPointC),
      boilingPointC: num(props.boilingPointC),
    },
    audience: body.audience === 'general_public' ? 'general_public' : 'professional',
    remainderStatedNonhazard: body.remainderStatedNonhazard === true,
  };

  return { parsed: { input, annex6Indexes } };
}

function parsePairs(v: unknown): ClassCat[] {
  if (!Array.isArray(v)) return [];
  const out: ClassCat[] = [];
  for (const p of v.slice(0, 40)) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    if (typeof o.classCode !== 'string') continue;
    out.push({
      classCode: o.classCode,
      categoryCode: typeof o.categoryCode === 'string' ? o.categoryCode : null,
      hCode: typeof o.hCode === 'string' ? o.hCode : null,
      star: o.star === true,
      raw: typeof o.raw === 'string' ? o.raw.slice(0, 200) : null,
    });
  }
  return out;
}

function parseManualAte(v: unknown): ComponentInput['manualAte'] {
  if (!v || typeof v !== 'object') return undefined;
  const src = v as Record<string, unknown>;
  const out: NonNullable<ComponentInput['manualAte']> = {};
  for (const route of ['oral', 'dermal', 'inhalation'] as const) {
    const r = src[route];
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const ate = num(o.ate);
    const cat = num(o.cat);
    out[route] = {
      ate: ate != null && ate > 0 ? ate : null,
      cat: cat != null && cat >= 1 && cat <= 5 ? Math.round(cat) : null,
    };
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Пары поставщика должны существовать в реестре — иначе движок построит
 * решение по классу, которого нет, и `decide()` поднимет `REGISTRY_GAP`
 * ПОСЛЕ расчёта. Ловим до.
 */
export function invalidSupplierPairs(input: MixtureInput, data: ClassifierData): string[] {
  const known = new Set(data.registry.map((e) => `${e.classCode}|${e.categoryCode}`));
  const bad: string[] = [];
  for (const c of input.components) {
    if (c.source !== 'supplier') continue;
    for (const p of c.classifications) {
      if (p.categoryCode == null || !known.has(`${p.classCode}|${p.categoryCode}`)) {
        bad.push(`${c.name}: ${p.classCode} ${p.categoryCode ?? '(no category)'}`);
      }
    }
  }
  return bad;
}

/** Данные Annex VI поверх присланного состава (личность, пары, пределы, ноты). */
export function applyProfiles(input: MixtureInput, profiles: ProfileMap): void {
  for (const c of input.components) {
    if (!c.indexNumber) continue;
    const p = profiles[c.indexNumber];
    if (!p) {
      // Ключа нет в Annex VI — оставляем компонент без гармонизированных данных;
      // движок увидит пустые классификации, а интерфейс — предупреждение.
      c.notes = [...(c.notes ?? []), 'This index number is not in our copy of Annex VI Table 3.'];
      continue;
    }
    if (p.substance) {
      c.name = c.name || p.substance.name || p.substance.iupacName || c.name;
      c.casPrimary = p.substance.casPrimary;
      c.ecPrimary = p.substance.ecPrimary;
      c.hCodes = p.substance.hCodes;
      c.euhCodes = p.substance.euhCodes;
      c.ecotox = {
        lc50Fish: p.substance.lc50Fish, ec50Daphnia: p.substance.ec50Daphnia,
        ec50Algae: p.substance.ec50Algae, noec: null,
        rapidlyDegradable: p.substance.readilyBiodegradable,
      };
    }
    c.classifications = (p.pairs ?? []).map((x) => ({
      classCode: x.classCode, categoryCode: x.categoryCode, hCode: x.hCode,
      star: x.star, raw: x.raw,
    }));
    c.scl = p.scl ?? [];
    c.mFactors = p.mFactors ?? [];
    c.ate = p.ate ?? [];
    c.notes = [...(c.notes ?? []), ...(p.notes ?? [])];
  }
}
