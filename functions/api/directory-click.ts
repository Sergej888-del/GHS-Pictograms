// functions/api/directory-click.ts — переход из каталога на сайт вендора (№148, session 99).
//
// ЗАЧЕМ. Цифра для вендора «we sent you N visitors» (первое обещание — SQ Label,
// 08.10, отчёт через 90 дней). GA4 видит только согласившихся на cookie, Umami
// засорён бот-роем — поэтому своя таблица directory_clicks (scripts/sql/99-*, 99b-*).
//
// ОТКУДА ЗОВЁТСЯ. Один делегированный слушатель в GoogleAnalytics.astro ловит
// клик по любой `a[data-dir-out]` (кнопки «Vendor website», «Contact vendor»,
// hero записи, строка таблицы сравнения) и шлёт navigator.sendBeacon сюда.
// Ссылка открывается в новой вкладке, ничего не ждёт.
//
// ⭐ ЧТО ХРАНИМ — и чего НЕТ. IP не хранится. Ключ посетителя считается ЗДЕСЬ:
// SHA-256(дата UTC | IP | user agent | секрет) → UUID. Он меняется каждые сутки
// и не записывается на устройство (ни cookie, ни localStorage), поэтому не узнаёт
// человека завтра. Так написано и в /privacy/ — меняешь схему, меняй и текст там.
// Страна и номер сети (ASN) — из Cloudflare: ASN нужен отчёту, чтобы отсеять
// дата-центры (бот-рой s90 шёл из облаков Сингапура и Китая).
//
// Защита: только origin ghspictograms.com · только пути /directory/ · ботовые
// user agent не считаются · лимит по IP (бакет `dirclick`) · внутри RPC — 60
// кликов на ключ в сутки и гашение повтора той же ссылки за 30 секунд.
// Turnstile здесь НЕТ сознательно: токен нельзя получить за время клика.
//
// ⛔ Service-ключ живёт в ./classify/_shared — сюда приходит только через rpc().

import type { EventContext } from '@cloudflare/workers-types';
import { type Env, clientIp, fail, json, rateLimit, rpc } from './classify/_shared';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const PLACES = new Set(['card', 'entry', 'entry-hero', 'table', 'contact']);
const HOST_RE = /^[a-z0-9.-]{1,100}$/;
const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|preview|fetch|python|curl|wget|httpclient|phantom|puppeteer|playwright|selenium/i;
const ALLOWED_ORIGIN = 'https://ghspictograms.com';

interface Click {
  category: string;
  slug: string;
  kind: 'website' | 'contact';
  place: string | null;
  page: string;
  host: string | null;
}

function parse(raw: unknown): Click | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const category = typeof r.cat === 'string' ? r.cat.trim() : '';
  const slug = typeof r.slug === 'string' ? r.slug.trim() : '';
  if (!SLUG_RE.test(category) || !SLUG_RE.test(slug)) return null;
  const place = typeof r.place === 'string' && PLACES.has(r.place) ? r.place : null;
  const page = typeof r.page === 'string' ? r.page.slice(0, 200) : '';
  if (!page.startsWith('/directory/')) return null;
  const hostRaw = typeof r.host === 'string' ? r.host.trim().toLowerCase() : '';
  return {
    category,
    slug,
    kind: place === 'contact' ? 'contact' : 'website',
    place,
    page,
    host: HOST_RE.test(hostRaw) ? hostRaw : null,
  };
}

/** Дневной ключ посетителя: тот же человек сегодня — тот же UUID, завтра — другой. */
async function dailyVisitorKey(ip: string, ua: string, secret: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${day}|${ip}|${ua}|${secret}`));
  const h = [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export async function onRequestPost(
  context: EventContext<Env, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  const origin = request.headers.get('Origin');
  if (origin && origin !== ALLOWED_ORIGIN) return fail(403, 'ORIGIN', 'Not counted.');

  const ua = request.headers.get('User-Agent') ?? '';
  if (!ua || BOT_UA.test(ua)) return json({ ok: true, counted: false, reason: 'bot' });

  let raw: unknown;
  try {
    // sendBeacon шлёт text/plain — читаем текст и разбираем сами.
    raw = JSON.parse(await request.text());
  } catch {
    return fail(400, 'BAD_JSON', 'The request body is not valid JSON.');
  }
  const click = parse(raw);
  if (!click) return fail(400, 'BAD_INPUT', 'The click could not be read.');

  let rate;
  try {
    rate = await rateLimit(env, request, 'dirclick');
  } catch {
    return fail(503, 'RATE_LIMIT_UNAVAILABLE', 'Not counted.');
  }
  if (!rate.allowed) return json({ ok: true, counted: false, reason: 'rate_limited' });

  const cf = (request as unknown as { cf?: { country?: string; asn?: number } }).cf;
  const visitor = await dailyVisitorKey(clientIp(request), ua, env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const result = await rpc(env, 'record_directory_click', {
      p_category: click.category,
      p_slug: click.slug,
      p_link_kind: click.kind,
      p_placement: click.place,
      p_visitor: visitor,
      p_page: click.page,
      p_target_host: click.host,
      p_country: typeof cf?.country === 'string' ? cf.country : null,
      p_asn: typeof cf?.asn === 'number' ? cf.asn : null,
    });
    return json({ ok: true, result });
  } catch {
    return fail(502, 'DB', 'Not counted.');
  }
}
