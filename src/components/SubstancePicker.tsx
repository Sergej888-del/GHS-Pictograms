import { useEffect, useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import { supabase } from '../lib/supabase'
import { substanceName, substanceNameFull } from '../lib/substanceName'
import { casForDisplay, ecForDisplay } from '../lib/substanceIdentifiers'
import {
  LM_PARAM, LM_STICKY_PARAMS, LABEL_MAKER_BASE, labelMakerHref, parseLabelMakerParams,
  readReturnBase,
} from '../lib/labelMakerLink'

/**
 * Страница выбора вещества — /ghs-label-maker/pick/
 *
 * ⚠⚠ ЗАЧЕМ ОТДЕЛЬНАЯ СТРАНИЦА, А НЕ СПИСОК ВНУТРИ ИНСТРУМЕНТА.
 * Решение Сергея после того, как он посмотрел собранный сайт: «ты не видишь
 * инструмент, из-за этого мало кто доходит до глубоко зарытого инструмента».
 * Пока выбор вещества стоял ПЕРЕД конструктором, конструктора не было видно
 * вовсе — человек попадал на список и уходил. Теперь на `/ghs-label-maker/`
 * конструктор открыт сразу, а весь подбор вещества переехал сюда, где ему и
 * место: целый экран под фильтры и список.
 *
 * ⚠⚠ ВЫБОР ВОЗВРАЩАЕТ НА ХАБ, В КОНСТРУКТОР. Щелчок по строке уводит на
 * `/ghs-label-maker/?cas=…#build` — на якорь инструмента, а НЕ в начало
 * страницы: возвращаться в hero после выбора вещества значит заставить человека
 * второй раз искать инструмент глазами.
 *
 * ⚠⚠ НАСТРОЙКИ ИНСТРУМЕНТА ПЕРЕЖИВАЮТ ПОХОД СЮДА. Юрисдикция, назначение,
 * формат и второй язык (`LM_STICKY_PARAMS`) читаются из адреса этой страницы и
 * возвращаются в ссылке обратно. Иначе человек, настроивший EU CLP и формат
 * Avery, терял бы всё это ровно в тот момент, когда выбрал вещество.
 *
 * ⚠ Счётчика «показано 60 из 737» здесь нет и быть не может: список отдаёт ВСЕ
 * совпадения. Именно расхождение счётчика с длиной списка Сергей поймал на
 * прошлой версии — счётчик писал 737, а в списке лежало 60.
 */

interface Row {
  cas_number: string
  iupac_name: string
  common_name: string | null
  display_name_short: string | null
  ec_number: string | null
  ghs_pictogram_codes: string[] | null
  signal_word: string | null
}

const PICTOGRAMS = [
  { code: 'GHS01', label: 'Explosive' },
  { code: 'GHS02', label: 'Flammable' },
  { code: 'GHS03', label: 'Oxidising' },
  { code: 'GHS04', label: 'Gas' },
  { code: 'GHS05', label: 'Corrosive' },
  { code: 'GHS06', label: 'Toxic' },
  { code: 'GHS07', label: 'Harmful' },
  { code: 'GHS08', label: 'Health' },
  { code: 'GHS09', label: 'Environment' },
]

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
/** Имена, начинающиеся не с буквы, — их в перечне Annex VI много (2,2'-…, 4-хлор-…). */
const NUM = '0–9'

/**
 * ⚠ Потолок ТОЛЬКО у самого широкого случая — «все буквы, без поиска и
 * фильтров»: это 3 809 строк, и класть их в разметку разом значит подвесить
 * вкладку на пару секунд. Как только выбрана буква, поиск или фильтр, потолок
 * не действует и список показывает ВСЁ, что нашлось. О действующем потолке
 * написано в разметке прямым текстом — молча резать нельзя.
 */
const UNFILTERED_MAX = 200

/** Первая буква имени — по тому же имени, которое человек видит в строке. */
function firstLetter(name: string): string {
  const m = name.match(/[A-Za-z]/)
  return m ? m[0].toUpperCase() : NUM
}

/**
 * ⚠⚠ СПИСОК АДРЕСОВ РАЗДЕЛА ПРИХОДИТ ПРОПОМ, А НЕ ИМПОРТОМ. `labelMakerHub.ts`
 * весит под сотню килобайт текстов веток и шаблонов, и тащить его в браузер
 * ради четырнадцати строк было бы дорого. Страница строит список на сервере из
 * `LABEL_MAKER_PATHS` — единственной его редакции.
 *
 * ⚠ Список не необязателен: без него `readReturnBase` вернёт корень раздела, и
 * человек с ветки уедет на общий хаб — ровно тот дефект, который чинится.
 */
interface Props {
  branchPaths?: readonly string[]
}

export default function SubstancePicker({ branchPaths = [] }: Props) {
  const [all, setAll] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [letter, setLetter] = useState<string>('')
  const [picFilters, setPicFilters] = useState<string[]>([])
  const [signalFilter, setSignalFilter] = useState<string>('')

  /** Настройки инструмента, с которыми человек сюда пришёл. */
  const [sticky, setSticky] = useState('')

  /**
   * Страница раздела, с которой человек ушёл за веществом, — туда же и вернём.
   * ⚠ Умолчание — корень раздела: пока адрес не прочитан, ссылка «назад» обязана
   * вести хоть куда-то годное.
   */
  const [returnBase, setReturnBase] = useState<string>(LABEL_MAKER_BASE)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    const seed = q.get('q')?.trim()
    if (seed) setQuery(seed)
    const keep = new URLSearchParams()
    for (const name of LM_STICKY_PARAMS) {
      const v = q.get(name)
      if (v) keep.set(name, v)
    }
    setSticky(keep.toString())
    setReturnBase(readReturnBase(q, branchPaths))
  }, [branchPaths])

  useEffect(() => {
    let cancelled = false
    async function loadAll() {
      let data: Row[] = []
      let from = 0
      const size = 1000
      for (;;) {
        const { data: chunk } = await supabase
          .from('substances')
          .select('cas_number, iupac_name, common_name, display_name_short, ec_number, ghs_pictogram_codes, signal_word')
          .not('cas_number', 'is', null)
          .range(from, from + size - 1)
        if (!chunk || chunk.length === 0) break
        data = [...data, ...(chunk as Row[])]
        if (chunk.length < size) break
        from += size
      }
      if (cancelled) return
      setAll(data)
      setLoading(false)
    }
    loadAll()
    return () => { cancelled = true }
  }, [])

  const fuse = useMemo(
    () => new Fuse(all, {
      keys: ['cas_number', 'iupac_name', 'common_name', 'display_name_short'],
      threshold: 0.3,
      minMatchCharLength: 2,
    }),
    [all],
  )

  const narrowed = query.trim().length >= 2 || letter !== '' || picFilters.length > 0 || signalFilter !== ''

  const results = useMemo(() => {
    let list = query.trim().length >= 2 ? fuse.search(query.trim()).map((r) => r.item) : all
    if (letter) list = list.filter((s) => firstLetter(substanceName(s)) === letter)
    if (picFilters.length > 0) {
      list = list.filter((s) => picFilters.every((c) => (s.ghs_pictogram_codes ?? []).includes(c)))
    }
    if (signalFilter) list = list.filter((s) => s.signal_word === signalFilter)
    return list
  }, [query, letter, picFilters, signalFilter, all, fuse])

  /** Какие буквы вообще что-то дадут — пустые кнопки не должны выглядеть живыми. */
  const letterHas = useMemo(() => {
    const set = new Set<string>()
    for (const s of all) set.add(firstLetter(substanceName(s)))
    return set
  }, [all])

  const capped = !narrowed && results.length > UNFILTERED_MAX
  const shown = capped ? results.slice(0, UNFILTERED_MAX) : results

  /**
   * ⚠⚠⚠ ВОЗВРАТ ИДЁТ НА `returnBase`, А НЕ НА КОРЕНЬ РАЗДЕЛА. До session 60
   * здесь стоял `LABEL_MAKER_BASE`, и выбор вещества уводил человека с ветки на
   * общий хаб: настройки ветки приходят пропами, в адресе их нет, и на корне
   * инструмент открывался с умолчаниями — OSHA, этикетка поставщика. Пришедший
   * за цеховой этикеткой по EU CLP получал не то, за чем пришёл.
   */
  function open(cas: string) {
    const params = sticky ? parseLabelMakerParams(sticky) : {}
    const href = labelMakerHref({ ...params, cas }, returnBase) + '#build'
    window.location.assign(href)
  }

  const backHref = returnBase + (sticky ? `?${sticky}` : '') + '#build'
  const nf = (n: number) => n.toLocaleString('en-US')

  const clearAll = () => { setQuery(''); setLetter(''); setPicFilters([]); setSignalFilter('') }

  return (
    <div className="lm-pick">
      <div className="tool-panel lm-pick-filters">
        <p className="tool-label">Search by name, CAS or EC number</p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="acetone · 67-64-1 · 200-662-2"
          aria-label="Search substances by name, CAS or EC number"
          className="tool-search"
          autoFocus
        />

        <div className="lm-facets">
          <p className="tool-label">First letter</p>
          <div className="sub-alpha">
            <button
              type="button"
              onClick={() => setLetter('')}
              className={letter === '' ? 'sub-alpha-item is-current' : 'sub-alpha-item'}
            >All</button>
            {[NUM, ...LETTERS].map((l) => {
              const has = letterHas.has(l)
              const cls = letter === l ? 'sub-alpha-item is-current' : has ? 'sub-alpha-item' : 'sub-alpha-item is-empty'
              return (
                <button
                  key={l}
                  type="button"
                  disabled={!has}
                  onClick={() => setLetter((p) => (p === l ? '' : l))}
                  className={cls}
                >{l}</button>
              )
            })}
          </div>
        </div>

        <div className="lm-facets">
          <p className="tool-label">Pictogram and signal word</p>
          <div className="tool-chips">
            {PICTOGRAMS.map(({ code, label }) => (
              <button
                key={code}
                type="button"
                title={label}
                onClick={() => setPicFilters((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]))}
                className={picFilters.includes(code) ? 'tool-chip on lm-chip-pic' : 'tool-chip lm-chip-pic'}
              >
                <img src={`/pictograms/${code.toLowerCase()}.svg`} alt="" aria-hidden="true" />
                {code}
              </button>
            ))}
            {(['Danger', 'Warning'] as const).map((sw) => (
              <button
                key={sw}
                type="button"
                onClick={() => setSignalFilter((p) => (p === sw ? '' : sw))}
                className={signalFilter === sw ? 'tool-chip on' : 'tool-chip'}
              >{sw}</button>
            ))}
            {narrowed && (
              <button type="button" onClick={clearAll} className="tool-chip">Clear filters</button>
            )}
          </div>
        </div>
      </div>

      <div className="lm-pick-results">
        <div className="lm-pick-head">
          <p className="tool-count">
            {loading
              ? 'Loading the CLP Annex VI list…'
              : capped
                ? `First ${nf(UNFILTERED_MAX)} of ${nf(results.length)} — pick a letter or search to see the rest`
                : `${nf(results.length)} substance${results.length === 1 ? '' : 's'}`}
          </p>
          <a href={backHref} className="tool-preview-all">← Back to the label maker</a>
        </div>

        {!loading && (
          shown.length === 0 ? (
            <div className="tool-blank">
              <p className="t">Nothing matches</p>
              <p className="s">
                Try the name instead of the number, or clear the filters. Mixtures and own products
                are not in this list — they have no harmonised classification, and you set it
                yourself inside the label maker.
              </p>
              <a href={backHref} className="lm-link">← Back to the label maker</a>
            </div>
          ) : (
            <ul className="lm-pick-list">
              {shown.map((s) => {
                const cas = casForDisplay(s.cas_number)
                const ec = ecForDisplay(s.ec_number)
                const pics = s.ghs_pictogram_codes ?? []
                return (
                  <li key={s.cas_number}>
                    <button type="button" onClick={() => open(s.cas_number)} className="lm-pick-row">
                      <span className="n" title={substanceNameFull(s)}>{substanceName(s)}</span>
                      <span className="m">
                        {cas ? cas : 'no single CAS'}{ec ? ` · EC ${ec}` : ''}
                      </span>
                      <span className="p">
                        {pics.map((c) => (
                          <img key={c} src={`/pictograms/${c.toLowerCase()}.svg`} alt={c} title={c} />
                        ))}
                        {s.signal_word && (
                          <span className={s.signal_word === 'Danger' ? 'sw danger' : 'sw warning'}>
                            {s.signal_word}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        )}
      </div>
    </div>
  )
}
