// src/lib/directoryFilterClient.ts — скрипт фильтров каталога (s108, шаг A1b).
//
// Один скрипт на все страницы со списком: категория, подраздел услуг и общий вид /directory/all/. Раньше он жил внутри
// DirectoryListing.astro; общий вид сделал бы вторую копию, а две копии расходятся молча.
//
// Что делает: читает значения полей внутри [data-dir-filters] и прячет строки таблицы (tr[data-dir-row]) и карточки
// (article[data-dir-entry]), у которых data-атрибуты не подходят. Без JS видно всё.
// Поля: select[data-filter] = juris | geo | ops | tier | section, галочка named, поле q, кнопка [data-dir-reset].
//
// ⚠ Правило «Operates in» повторяет count() в directoryGeo.geoFilterOptions: токен `ww` («worldwide») подходит под любой
//   выбор, кроме самого «Worldwide», а галочка «Only vendors that name it» это отключает. Меняешь одно — меняй другое.
// ⚠ `syncUrl`: общий вид хранит выбор в адресе (?geo=c:DE&ops=…&section=…&q=…), чтобы ссылкой можно было поделиться и чтобы
//   форма «Find by country» на хабе вела сразу в отфильтрованный список. Страницы категорий адрес не трогают.

type Opts = { syncUrl?: boolean }

export function initDirectoryFilters({ syncUrl = false }: Opts = {}): void {
  const root = document.querySelector<HTMLElement>('[data-dir-filters]')
  if (!root) return
  const select = (name: string) => root.querySelector<HTMLSelectElement>(`select[data-filter="${name}"]`)
  const juris = select('juris')
  const geo = select('geo')
  const ops = select('ops')
  const tier = select('tier')
  const section = select('section')
  const named = root.querySelector<HTMLInputElement>('input[data-filter="named"]')
  const q = root.querySelector<HTMLInputElement>('input[data-filter="q"]')
  const reset = root.querySelector<HTMLButtonElement>('[data-dir-reset]')
  const visibleEl = root.querySelector('[data-dir-visible]')
  const empty = document.getElementById('dir-empty')
  const rows = Array.from(document.querySelectorAll<HTMLElement>('tr[data-dir-row]'))
  const cards = Array.from(document.querySelectorAll<HTMLElement>('article[data-dir-entry]'))
  const selects: [string, HTMLSelectElement | null][] = [['juris', juris], ['geo', geo], ['ops', ops], ['tier', tier], ['section', section]]

  const match = (el: HTMLElement): boolean => {
    const j = juris?.value ?? ''
    const g = geo?.value ?? ''
    const o = ops?.value ?? ''
    const t = tier?.value ?? ''
    const s = section?.value ?? ''
    const words = (q?.value ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    if (j && !(el.dataset.juris ?? '').split(' ').includes(j)) return false
    if (g && !(el.dataset.geo ?? '').split(' ').includes(g)) return false
    if (o) {
      const have = (el.dataset.ops ?? '').split(' ')
      if (!(have.includes(o) || (o !== 'ww' && !named?.checked && have.includes('ww')))) return false
    }
    if (s && el.dataset.section !== s) return false
    if (t === 'verified' && el.dataset.dirTier === 'listed') return false
    const blob = el.dataset.search ?? ''
    return words.every((w) => blob.includes(w))
  }

  const active = (): boolean =>
    selects.some(([, s]) => !!s?.value) || !!named?.checked || !!(q?.value ?? '').trim()

  // «Only vendors that name it»: числа в списке «Operates in» — со «worldwide» (data-n) или только прямые (data-nn).
  const relabel = () => {
    ops?.querySelectorAll<HTMLOptionElement>('option[data-label]').forEach((opt) => {
      opt.textContent = `${opt.dataset.label} (${named?.checked ? opt.dataset.nn : opt.dataset.n})`
    })
  }

  const queryOf = (names: string[]): string => {
    const params = new URLSearchParams()
    for (const [name, s] of selects) if (names.includes(name) && s?.value) params.set(name, s.value)
    if (named?.checked) params.set('named', '1')
    const text = (q?.value ?? '').trim()
    if (text) params.set('q', text)
    return params.toString().replace(/%3A/gi, ':')
  }

  const writeUrl = () => {
    if (!syncUrl) return
    const query = queryOf(['juris', 'geo', 'ops', 'tier', 'section'])
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''))
  }

  // Ссылка «по всем разделам» на странице категории несёт текущий выбор страны/рынка/поиска (juris и tier общему виду не нужны).
  const allLink = document.querySelector<HTMLAnchorElement>('a[data-dir-all-link]')
  const syncAllLink = () => {
    if (!allLink) return
    const query = queryOf(['geo', 'ops'])
    allLink.href = '/directory/all/' + (query ? `?${query}` : '')
  }

  const apply = () => {
    let n = 0
    rows.forEach((r) => {
      const ok = match(r)
      r.classList.toggle('hub-hide', !ok)
      if (ok) n++
    })
    cards.forEach((a) => a.classList.toggle('hub-hide', !match(a)))
    if (visibleEl) visibleEl.textContent = String(n)
    empty?.classList.toggle('hub-hide', n > 0)
    if (reset) reset.hidden = !active()
    writeUrl()
    syncAllLink()
  }

  // Начальный выбор из адреса: форма на хабе отправляет ?geo=…&ops=…; значение, которого нет среди опций, молча пропускается.
  if (syncUrl) {
    const params = new URLSearchParams(location.search)
    for (const [name, s] of selects) {
      const v = params.get(name)
      if (s && v && Array.from(s.options).some((o) => o.value === v)) s.value = v
    }
    if (named && params.get('named') === '1') named.checked = true
    if (q && params.get('q')) q.value = params.get('q') ?? ''
    relabel()
  }

  for (const [, s] of selects) s?.addEventListener('change', apply)
  named?.addEventListener('change', () => { relabel(); apply() })
  q?.addEventListener('input', apply)
  reset?.addEventListener('click', () => {
    for (const [, s] of selects) if (s) s.value = ''
    if (named) named.checked = false
    if (q) q.value = ''
    relabel()
    apply()
  })
  apply()
}
