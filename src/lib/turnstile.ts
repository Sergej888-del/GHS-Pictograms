// turnstile — клиентский слой Cloudflare Turnstile (№120, session 88).
//
// Один невидимый виджет на страницу, режим `execute`: скрипт Cloudflare
// подгружается лениво — при ПЕРВОМ действии, которому нужен токен, — а не на
// каждой из 4 512 страниц. Токен одноразовый (siteverify принимает его один
// раз) и живёт 5 минут, поэтому на каждую отправку берётся новый.
//
// Кто зовёт: MixtureClassifier (POST /api/classify) и toolSignals
// (POST /api/signal). Сервер проверяет токен в verifyTurnstile() —
// functions/api/classify/_shared.ts.
//
// ⚠ Без PUBLIC_TURNSTILE_SITE_KEY в сборке слой выключен: getTurnstileToken()
// отдаёт null, и сервер, если у него есть TURNSTILE_SECRET, ответит 403. Это
// осознанно: «ключ есть на сервере, но не в сборке» должно быть видно, а не
// молча пропускаться.
//
// ⚠ Блокировщики иногда режут challenges.cloudflare.com — тогда токена нет
// через таймаут; отправитель решает сам, что делать (сигналы молчат,
// классификатор показывает текст ошибки сервера).

const SITE_KEY: string | undefined = (import.meta.env.PUBLIC_TURNSTILE_SITE_KEY as string | undefined) || undefined
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const TOKEN_TIMEOUT_MS = 12_000

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string
  execute(widgetId: string): void
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

export function turnstileEnabled(): boolean {
  return typeof window !== 'undefined' && !!SITE_KEY
}

let scriptPromise: Promise<TurnstileApi> | null = null

function loadApi(): Promise<TurnstileApi> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) { resolve(window.turnstile); return }
    const s = document.createElement('script')
    s.src = SCRIPT_URL
    s.async = true
    s.defer = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile api missing after load')))
    s.onerror = () => reject(new Error('turnstile script blocked'))
    document.head.appendChild(s)
  })
  scriptPromise.catch(() => { scriptPromise = null }) // следующий вызов попробует ещё раз
  return scriptPromise
}

let widgetId: string | null = null
let pending: { resolve: (t: string | null) => void } | null = null
let queue: Promise<unknown> = Promise.resolve()

function ensureWidget(api: TurnstileApi): string {
  if (widgetId) return widgetId
  const host = document.createElement('div')
  // Виден только если Cloudflare решит показать интерактивную проверку —
  // тогда он должен быть на экране, а не за его краем.
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;'
  host.setAttribute('data-turnstile-host', '')
  document.body.appendChild(host)
  widgetId = api.render(host, {
    sitekey: SITE_KEY,
    execution: 'execute',
    appearance: 'interaction-only',
    size: 'normal',
    callback: (token: string) => { pending?.resolve(token); pending = null },
    'error-callback': () => { pending?.resolve(null); pending = null },
    'expired-callback': () => { pending?.resolve(null); pending = null },
    'timeout-callback': () => { pending?.resolve(null); pending = null },
  })
  return widgetId
}

/**
 * Свежий токен для одной отправки; null — виджет выключен, скрипт не загрузился
 * или проверка не прошла. Вызовы сериализуются: у виджета один callback.
 */
export function getTurnstileToken(): Promise<string | null> {
  if (!turnstileEnabled()) return Promise.resolve(null)
  const run = async (): Promise<string | null> => {
    let api: TurnstileApi
    try { api = await loadApi() } catch { return null }
    const id = ensureWidget(api)
    return new Promise<string | null>((resolve) => {
      const timer = window.setTimeout(() => { if (pending) { pending = null; resolve(null) } }, TOKEN_TIMEOUT_MS)
      pending = { resolve: (t) => { window.clearTimeout(timer); resolve(t) } }
      try {
        api.reset(id) // прошлый токен использован — виджет обязан выдать новый
        api.execute(id)
      } catch {
        pending = null; window.clearTimeout(timer); resolve(null)
      }
    })
  }
  const next = queue.then(run, run)
  queue = next.catch(() => null)
  return next
}
