#!/usr/bin/env python3
"""Разбор ЯЗЫКОВОЙ версии консолидированного CLP: Annex I и Annex VI Part 3.

Один проход по одному файлу даёт две вещи:

  1. СИГНАЛЬНЫЕ СЛОВА (Annex I) — «Danger» и «Warning» на этом языке.
  2. ИМЕНА ВЕЩЕСТВ (Annex VI Part 3) — колонка имени, ключ index_number.

⚠⚠ ОБА ПРИЛОЖЕНИЯ ЛЕЖАТ В ОДНОМ ДОКУМЕНТЕ. Это и есть причина, по которой
загрузок 23, а не 24 + 23: Annex I и Annex VI — части одной языковой версии
регламента.

Запуск:
    python scripts/parse-clp-language.py de
    python scripts/parse-clp-language.py de fr nl
    python scripts/parse-clp-language.py all

Вход:  .tmp-eurlex/clp-consolidated-<lang>.html  (английский — clp-consolidated.html)
Выход: .tmp-eurlex/parsed-<lang>.json

⚠⚠ АНГЛИЙСКИЙ ФАЙЛ ОБЯЗАТЕЛЕН — он служит ЭТАЛОНОМ СТРУКТУРЫ, а не источником
перевода. Без него разбор не запускается вовсе: проверить, что мы вынули из
чужого языка именно сигнальное слово, а не соседнюю ячейку, можно только
сравнением с версией, где ответ известен.
"""

import collections
import json
import re
import sys
from html import unescape
from pathlib import Path

TMP = Path('.tmp-eurlex')

LANGS = ['bg', 'es', 'cs', 'da', 'de', 'et', 'el', 'en', 'fr', 'ga', 'hr', 'it',
         'lv', 'lt', 'hu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'fi', 'sv']

HCODE = re.compile(r'\bH\s?\d{3}\b')
INDEX_NO = re.compile(r'^\d{3}-\d{3}-\d{2}-\d$')
# ⚠ Метки правок EUR-Lex (▼M19, ►C4) попадают в ячейки и сигнальным словом не
# являются. Их надо отбросить ДО подсчёта, иначе «различных значений» станет
# не два, а восемь, и проверка на два слова провалится на верном файле.
AMEND = re.compile(r'^[▼►]\s*[A-Z]?\d*$')


def file_for(lang: str) -> Path:
    return TMP / ('clp-consolidated.html' if lang == 'en' else f'clp-consolidated-{lang}.html')


def cell_text(fragment: str) -> str:
    t = re.sub(r'<[^>]+>', ' ', fragment)
    t = unescape(t).replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', t).strip()


def iter_tables(html: str):
    for m in re.finditer(r'<table\b[^>]*>(.*?)</table>', html, re.S | re.I):
        yield m.group(1)


def iter_rows(tbl: str):
    for m in re.finditer(r'<tr\b[^>]*>(.*?)</tr>', tbl, re.S | re.I):
        yield m.group(1)


def row_cells(row: str) -> list:
    return [cell_text(m.group(1)) for m in re.finditer(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', row, re.S | re.I)]


# ── Annex I: сигнальные слова ────────────────────────────────────────────────

def signal_sequence(html: str) -> list:
    """Упорядоченная последовательность ячеек ряда сигнальных слов по всем таблицам.

    ⚠⚠ ПРАВИЛО СТРУКТУРНОЕ, А НЕ СЛОВЕСНОЕ. Подпись ряда на 24 языках разная
    («Signalwort», «Signal Word», «Mention d'avertissement», «Προειδοποιητική
    λέξη»), а порядок рядов в таблицах элементов этикетки один и тот же:
    пиктограмма → сигнальное слово → H-фразы → P-фразы. Ряд H-фраз узнаётся по
    КОДАМ, а коды языка не имеют. Значит ряд сигнальных слов — тот, что стоит
    непосредственно перед первым рядом с H-кодом.

    ⚠ Отбрасываются ряды, где есть ячейка длиннее 40 знаков или сам H-код: это
    не ряд сигнальных слов, а разъехавшаяся таблица.
    """
    out = []
    for tbl in iter_tables(html):
        rows = list(iter_rows(tbl))
        k = next((i for i, r in enumerate(rows) if HCODE.search(cell_text(r))), None)
        if not k:            # None или 0 — ряда выше нет
            continue
        cells = [c for c in row_cells(rows[k - 1]) if c and not AMEND.match(c)]
        if not cells or any(len(c) > 40 or HCODE.search(c) for c in cells):
            continue
        out.append(cells[1:] if len(cells) > 1 else cells)   # [0] — подпись ряда
    return out


def signal_words(lang: str, html: str, ref_seq: list) -> dict:
    """Слова этого языка, СВЕРЕННЫЕ с английской последовательностью позиционно.

    Возвращает {'danger': …, 'warning': …} либо бросает, если сверка не сошлась.
    """
    seq = signal_sequence(html)
    if len(seq) != len(ref_seq):
        raise SystemExit(
            f'✖ {lang}: таблиц с сигнальными словами {len(seq)}, а в английской версии '
            f'{len(ref_seq)}. Структура разошлась — разбирать нельзя.')

    # Английские значения → множество слов этого языка на тех же позициях.
    mapping = collections.defaultdict(collections.Counter)
    mismatched_rows = 0
    for a, b in zip(ref_seq, seq):
        if len(a) != len(b):
            mismatched_rows += 1
            continue
        for en, other in zip(a, b):
            mapping[en][other] += 1
    if mismatched_rows:
        raise SystemExit(
            f'✖ {lang}: в {mismatched_rows} таблицах число ячеек не совпало с английской. '
            f'Подгонять нельзя — это ошибка разбора, а не особенность языка.')

    out = {}
    for en_word, key in (('Danger', 'danger'), ('Warning', 'warning')):
        got = mapping.get(en_word)
        if not got:
            raise SystemExit(f'✖ {lang}: в английской последовательности нет «{en_word}».')
        # ⚠⚠ У одного английского слова обязан быть РОВНО ОДИН ответ. Два разных
        # означают, что либо структура таблиц разошлась, либо в языковой версии
        # опечатка — и то и другое надо увидеть, а не выбрать большинством.
        if len(got) != 1:
            raise SystemExit(
                f'✖ {lang}: «{en_word}» соответствует нескольким словам: {dict(got)}. '
                f'Выбирать большинством нельзя.')
        word, count = got.most_common(1)[0]
        out[key] = {'text': word, 'cells': count}

    # Опорные числа английской версии: 44 Danger и 32 Warning в 37 таблицах.
    print(f'  Annex I: {out["danger"]["text"]!r} ×{out["danger"]["cells"]}  ·  '
          f'{out["warning"]["text"]!r} ×{out["warning"]["cells"]}  '
          f'({len(seq)} таблиц)')
    return out


# ── Annex VI Part 3: имена веществ ──────────────────────────────────────────

MARKER = re.compile(r'\[(\d{1,2})\]')


def split_name(cell: str) -> dict:
    """Разбор ячейки имени на формы.

    ⚠⚠ ДВА СОВЕРШЕННО РАЗНЫХ СЛУЧАЯ, И ПУТАТЬ ИХ НЕЛЬЗЯ.

    1. ЕСТЬ МАРКЕРЫ `[1] [2] [3]` — это ГРУППОВАЯ ЗАПИСЬ: под одним индексным
       номером идут РАЗНЫЕ вещества, и номер маркера привязывает имя к своей
       позиции в колонках EC и CAS. Значит формы делятся ПО МАРКЕРАМ, а не по
       точке с запятой, и соответствие между языками по НОМЕРУ МАРКЕРА
       гарантировано — в отличие от порядка.

       ⭐ Это снимает задачу, которая в claude/substance-names-translation.md
       записана как нерешаемая («соответствие форм между языками по порядку не
       гарантировано»). По порядку — действительно нет. По маркеру — да.

    2. МАРКЕРОВ НЕТ — это ОДНО вещество, а точки с запятой разделяют СИНОНИМЫ.
       ⚠⚠ И вот здесь число форм между языками ЗАКОННО РАЗНОЕ: немецкая версия
       Annex VI даёт «Kohlenstoffmonoxid; Kohlenmonoxid; Kohlenoxid» там, где
       английская даёт одно «carbon monoxide». Это содержание регламента, а не
       ошибка разбора, и требовать совпадения числа синонимов — значит забраковать
       443 верные записи из 4 014.

    ⚠ Квадратные скобки с ТЕКСТОМ (`[komplexe Kombination von Kohlenwasserstoffen…]`)
    — описание записи, а не маркер: маркер состоит только из цифр.
    """
    cell = cell.strip()
    marks = MARKER.findall(cell)
    if marks:
        # Делим по маркерам: текст ПЕРЕД маркером принадлежит этому маркеру.
        members = {}
        pos = 0
        for m in MARKER.finditer(cell):
            chunk = cell[pos:m.start()].strip().strip(';').strip()
            if chunk:
                members[int(m.group(1))] = chunk
            pos = m.end()
        tail = cell[pos:].strip().strip(';').strip()
        return {
            'kind': 'group',
            'members': members,          # {1: 'Borsäure', 2: 'Borsäure'}
            'forms': [members[k] for k in sorted(members)],
            'synonyms': [],
        }
    parts = [x.strip() for x in cell.split(';')]
    parts = [x for x in parts if x]
    return {'kind': 'single', 'members': {}, 'forms': parts[:1], 'synonyms': parts}


def annex6_names(html: str) -> dict:
    """{index_number: {'name':…, 'forms':[…], 'ec':…, 'cas':…}} из Table 3.

    ⚠ Строка узнаётся по ФОРМЕ ПЕРВОЙ ЯЧЕЙКИ (индексный номер `NNN-NNN-NN-N`), а
    не по заголовку таблицы: заголовок на 24 языках разный, а форма номера — нет.
    """
    out = {}
    for tbl in iter_tables(html):
        for row in iter_rows(tbl):
            cells = row_cells(row)
            if len(cells) < 4 or not INDEX_NO.match(cells[0]):
                continue
            idx, name = cells[0], cells[1]
            if not name:
                continue
            out[idx] = dict(name=name, ec=cells[2] or None, cas=cells[3] or None, **split_name(name))
    return out


def compare_names(lang: str, mine: dict, ref: dict) -> dict:
    """Сверка с английской версией. ⚠ Что расхождение, а что норма — см. ниже."""
    only_ref = sorted(set(ref) - set(mine))
    only_mine = sorted(set(mine) - set(ref))
    both = sorted(set(ref) & set(mine))

    # ⚠⚠ ЖЁСТКАЯ ПРОВЕРКА только для ГРУППОВЫХ записей: набор номеров маркеров
    # обязан совпасть. Маркер привязывает имя к своей позиции в колонках EC и CAS,
    # и если в немецкой версии маркеров три, а в английской четыре, имя уедет к
    # чужому CAS. Это настоящая ошибка, и подгонять её нельзя.
    marker_mismatch = [
        i for i in both
        if ref[i]['kind'] == 'group' and mine[i]['kind'] == 'group'
        and sorted(ref[i]['members']) != sorted(mine[i]['members'])
    ]
    # ⚠ Смена типа записи (группа ↔ одиночная) — тоже ошибка структуры.
    kind_mismatch = [i for i in both if ref[i]['kind'] != mine[i]['kind']]
    # ⚠ А вот разное число СИНОНИМОВ у одиночной записи — норма, не ошибка.
    syn_diff = [i for i in both if ref[i]['kind'] == 'single' == mine[i]['kind']
                and len(ref[i]['synonyms']) != len(mine[i]['synonyms'])]
    identical = [i for i in both if mine[i]['name'].lower() == ref[i]['name'].lower()]

    groups = sum(1 for i in mine if mine[i]['kind'] == 'group')
    print(f'  Annex VI: {len(mine)} записей (в английской {len(ref)}, общих {len(both)}), '
          f'групповых {groups}')
    if only_ref:
        print(f'    ⚠ нет в {lang}: {len(only_ref)} — {", ".join(only_ref[:5])}'
              + (' …' if len(only_ref) > 5 else ''))
    if only_mine:
        print(f'    ⚠ лишние в {lang}: {len(only_mine)} — {", ".join(only_mine[:5])}'
              + (' …' if len(only_mine) > 5 else ''))
    if kind_mismatch:
        print(f'    ✖ ТИП ЗАПИСИ РАЗОШЁЛСЯ (группа ↔ одиночная): {len(kind_mismatch)} — '
              f'{", ".join(kind_mismatch[:5])}' + (' …' if len(kind_mismatch) > 5 else ''))
    if marker_mismatch:
        print(f'    ✖ НАБОР МАРКЕРОВ РАЗОШЁЛСЯ: {len(marker_mismatch)} — '
              f'{", ".join(marker_mismatch[:5])}' + (' …' if len(marker_mismatch) > 5 else ''))
    if not kind_mismatch and not marker_mismatch:
        print('    ✔ у всех групповых записей набор маркеров совпал с английским')
    print(f'    разное число синонимов у одиночных записей: {len(syn_diff)} — '
          f'это содержание регламента, не ошибка')
    share = 100.0 * len(identical) / max(1, len(both))
    print(f'    имён, дословно равных английскому: {len(identical)} ({share:.1f} %)')
    if lang != 'en' and share > 90:
        print('    ✖✖ БОЛЬШЕ 90 % ИМЁН СОВПАДАЮТ С АНГЛИЙСКИМИ — почти наверняка '
              'CELLAR отдал английскую версию. Проверь Accept-Language (нужен код '
              'из трёх букв) и перекачай.')
    return {
        'only_in_reference': only_ref,
        'only_in_language': only_mine,
        'kind_mismatch': kind_mismatch,
        'marker_mismatch': marker_mismatch,
        'synonym_count_differs': len(syn_diff),
        'identical_to_english': len(identical),
        'identical_share_pct': round(share, 1),
    }


def main() -> None:
    args = [a.lower() for a in sys.argv[1:] if a.strip()]
    if not args:
        raise SystemExit('Укажи языки: de  |  de fr nl  |  all')
    langs = LANGS if 'all' in args else args
    unknown = [l for l in langs if l not in LANGS]
    if unknown:
        raise SystemExit(f'✖ Неизвестный язык: {", ".join(unknown)}\n  Доступны: {" ".join(LANGS)}')

    ref_file = file_for('en')
    if not ref_file.exists():
        raise SystemExit(
            f'✖ Нет эталона {ref_file}. Английская версия обязательна: она задаёт '
            f'структуру, по которой проверяется всё остальное.\n'
            f'  node --use-system-ca scripts/download-clp-annexes.mjs en')
    print(f'Эталон структуры: {ref_file}')
    ref_html = ref_file.read_text(encoding='utf-8', errors='replace')
    ref_seq = signal_sequence(ref_html)
    ref_names = annex6_names(ref_html)
    print(f'  таблиц с сигнальными словами: {len(ref_seq)} · записей Annex VI: {len(ref_names)}\n')

    for lang in langs:
        f = file_for(lang)
        if not f.exists():
            print(f'{lang}: файла нет ({f}) — пропускаю.')
            continue
        print(f'{lang}:')
        html = f.read_text(encoding='utf-8', errors='replace')
        words = signal_words(lang, html, ref_seq)
        names = annex6_names(html)
        report = compare_names(lang, names, ref_names)

        out = {
            'lang': lang.upper(),
            'source': str(f),
            'signal_words': [
                {'code': 'SIGNAL_DANGER', 'annex': 'I', 'lang': lang.upper(), 'text': words['danger']['text']},
                {'code': 'SIGNAL_WARNING', 'annex': 'I', 'lang': lang.upper(), 'text': words['warning']['text']},
            ],
            'substance_names': [
                {'index_number': i, 'lang': lang.upper(), 'name': v['name'],
                 'kind': v['kind'], 'forms': v['forms'],
                 'members': v['members'], 'synonyms': v['synonyms']}
                for i, v in sorted(names.items())
            ],
            'report': report,
        }
        dest = TMP / f'parsed-{lang}.json'
        dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
        mb = dest.stat().st_size / 1024 / 1024
        print(f'  → {dest} ({mb:.1f} МБ)\n')


if __name__ == '__main__':
    main()
