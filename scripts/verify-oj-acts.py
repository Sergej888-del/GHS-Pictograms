#!/usr/bin/env python3
# scripts/verify-oj-acts.py
#
# Сверяет 29 находок session 57 с ИСХОДНЫМИ актами Официального журнала —
# теми, что скачал `download-clp-act.mjs`, — а не с консолидацией.
#
# ⚠⚠ ЗАЧЕМ. Консолидация юридической силы не имеет: её собирает Бюро
# публикаций. Пока не видно исходного акта, сказать «ошибка в законе» нельзя.
# Развилка ровно такая:
#     акт печатает ТО ЖЕ, что консолидация → дефект самого закона → corrigendum;
#     акт печатает ДРУГОЕ                  → дефект сборки у Бюро публикаций.
#
# ⚠⚠ ЧИТАЕМ PDF, А ЕСЛИ ЕГО НЕТ — XHTML. Session 58 выяснила разведкой, что
# набор представлений у актов РАЗНЫЙ: у 32020R1182 есть `application/pdf`, а у
# 32018R0669 его нет вовсе (404), зато есть `application/xhtml+xml`.
#
# ⭐ PDF предпочтительнее и берётся первым: он и есть факсимиле полосы
# электронного ОЖ, а аутентичен только ОЖ (Reg. 216/2013, Art. 1(2)). Из него же
# берётся номер полосы для ссылки в обращении.
# ⚠ XHTML акта — сборка Бюро публикаций, как и консолидация, и сам по себе
# развилку не закрывает. Он годится, чтобы увидеть ТЕКСТ; довод о том, что
# ошибка была в ОЖ, по таким строкам придётся брать из другого места —
# например, из корриджендума, который цитирует полосу дословно.
#
# ⚠ Имя из консолидации НЕ ВПИСАНО РУКАМИ, а читается из файла тут же: иначе
# при переносе 29 строк в код появится 30-я ошибка — наша.
#
#     python3 scripts/verify-oj-acts.py            # все находки
#     python3 scripts/verify-oj-acts.py IT FR      # только эти редакции
#
# Запускается из корня ghspictograms. Нужен `pdftotext` (есть в системе).

import html
import os
import re
import subprocess
import sys
import unicodedata

TMP = '.tmp-eurlex'

# (index, редакция, CELEX акта-источника, вид ошибки)
# ⚠ CELEX взят из метки ▼M у самой строки консолидации, а не угадан.
FINDINGS = [
    ('017-026-00-3', 'IT', '32018R0669', 'foreign-name'),
    ('019-001-00-2', 'IT', '32018R0669', 'foreign-name'),
    ('006-018-00-5', 'IT', '32018R0669', 'foreign-name'),
    ('607-536-00-X', 'IT', '32018R0669', 'foreign-name'),
    ('016-064-00-8', 'IT', '32018R0669', 'typo'),
    ('016-018-00-7', 'FR', '32018R0669', 'foreign-name'),
    ('607-692-00-9', 'FR', '32018R0669', 'foreign-name'),
    ('612-034-01-6', 'FR', '32018R0669', 'typo'),
    ('608-066-00-8', 'LT', '32018R0669', 'foreign-name'),
    ('603-221-00-6', 'LT', '32018R0669', 'wrong-qualifier'),
    ('612-253-01-7', 'LT', '32018R0669', 'wrong-qualifier'),
    ('603-221-00-6', 'LV', '32018R0669', 'wrong-qualifier'),
    ('612-253-01-7', 'LV', '32018R0669', 'wrong-qualifier'),
    ('612-104-00-9', 'MT', '32018R0669', 'foreign-name'),
    ('006-082-00-4', 'MT', '32018R0669', 'foreign-name'),
    ('607-132-00-3', 'MT', '32018R0669', 'foreign-name'),
    ('607-260-00-X', 'MT', '32018R0669', 'foreign-name'),
    ('042-003-00-X', 'ET', '32018R0669', 'foreign-name'),
    ('613-286-00-2', 'ET', '32018R0669', 'wrong-qualifier'),
    ('601-087-00-3', 'PL', '32018R0669', 'foreign-name'),
    ('601-088-00-9', 'PL', '32018R0669', 'typo'),
    ('015-011-00-6', 'PL', '32018R0669', 'typo'),
    ('612-122-01-4', 'SV', '32018R0669', 'wrong-qualifier'),
    ('607-091-00-1', 'SV', '32018R0669', 'typo'),
    ('613-116-00-7', 'DA', '32018R0669', 'wrong-qualifier'),
    ('613-043-00-0', 'SK', '32018R0669', 'wrong-qualifier'),
    ('612-001-01-6', 'NL', '32018R0669', 'typo'),
    ('007-004-00-1', 'BG', '32020R1182', 'wrong-qualifier'),
    ('615-050-00-4', 'CS', '32022R0692', 'wrong-qualifier'),
]

# ⚠ У перевёрнутого примечания смысл несёт ПАРА, а не строка: доказательство в
# том, что обе половины печатают одно условие. Поэтому парную тянем тоже.
PAIRS = {
    '603-221-00-6': '603-221-01-3', '612-253-01-7': '612-253-00-X',
    '613-286-00-2': '613-286-01-X', '613-116-00-7': '613-116-01-4',
    '613-043-00-0': '613-043-01-8', '007-004-00-1': '007-030-00-3',
    '615-050-00-4': '615-049-00-9', '612-122-01-4': '612-122-00-7',
}

# ⭐⭐⭐ КОНТРОЛЬНЫЕ СТРОКИ — сверка обязана сначала доказать, что она работает.
#
# Без них «всё совпало» ничего не значит: ровно так же выглядел бы разбор,
# который молча берёт не ту колонку PDF и сравнивает пустое с пустым.
#
#   FR 015-011-00-6 — к этой строке ВЫПУЩЕН корриджендум (JO L 233, 10.9.2019,
#     p. 26), и в консолидации у неё стоит ►C11. Значит акт и консолидация
#     ОБЯЗАНЫ РАЗОЙТИСЬ: в акте напечатано «acide phosphonique à …» (фосфОНовая
#     кислота — другое вещество), в консолидации уже «acide phosphorique à … %».
#     ⚠ Если они совпали — разбор слеп, верить ему нельзя.
#   IT 017-023-00-7 — соседняя запись без меток. Обязаны совпасть.
#
# (индекс, редакция, CELEX, должны ли РАЗОЙТИСЬ, зачем)
CONTROLS = [
    ('015-011-00-6', 'FR', '32018R0669', True,
     'корриджендум JO L 233, 10.9.2019, p. 26 — акт обязан отличаться'),
    ('017-023-00-7', 'IT', '32018R0669', False,
     'меток нет — акт обязан совпасть'),
]

TAGS = re.compile(r'<[^>]+>')
CELLP = re.compile(r'<p[^>]*>(.*?)</p>', re.S)
IDX_RE = re.compile(r'\d{3}-\d{3}-\d{2}-[\dX]')
ROW_START = re.compile(r'^\s*[„"“«]?\s*(\d{3}-\d{3}-\d{2}-[\dX])')
EC_RE = re.compile(r'\d{3}-\d{3}-\d\b')
CAS_RE = re.compile(r'\d{2,7}-\d{2}-\d\b')
GAP_RE = re.compile(r' {3,}')

# ⚠ Колонтитул полосы ОЖ попадает внутрь строки таблицы на разрыве страницы.
# Он на всех языках свой, поэтому ловим по общему корню слова «вестник».
JUNK = re.compile(
    r'věstník|вестник|Journal officiel|Official Journal|Amtsblatt|Gazzetta|'
    r'Diario Oficial|Publicatieblad|Dziennik|Europeiska unionens|Tidende|'
    r'leidinys|Vēstnesis|Teataja|Ġurnal|vestník|Uradni list|Jurnalul|'
    r'virallinen lehti|Επίσημη Εφημερίδα|Hivatalos Lapja|Službeni list',
    re.I)


def norm(s: str) -> str:
    """Сводим к сравнимому виду: сущности, юникод, пробелы.

    ⚠ Мягкие переносы и неразрывные пробелы у EUR-Lex в HTML и в PDF разные, а
    разницы по существу не несут. Если их не убрать, сверка утонет в ложных
    расхождениях. Мягкий перенос в PDF ещё и разрывает слово посередине."""
    s = html.unescape(s)
    s = TAGS.sub('', s)
    s = unicodedata.normalize('NFC', s)
    s = s.replace('­', '').replace(' ', ' ').replace(' ', ' ')
    return re.sub(r'\s+', ' ', s).strip()



TD = re.compile(r'<td[^>]*>([\s\S]*?)</td>')


def html_row(blob: str, idx: str):
    """Ячейки строки таблицы по index-номеру.

    ⚠⚠ ДВЕ ГРАБЛИ, ОБЕ ВСКРЫЛИСЬ ПОЗЖЕ, НА ГОТОВОМ ДОСЬЕ.
    1. Первое вхождение номера — не обязательно строка таблицы: у малых актов
       номера перечислены ещё и в тексте статьи. Номер обязан быть ПЕРВОЙ
       ячейкой строки.
    2. Резать надо по `<td>`, а не по `<p>`: в одной ячейке бывает несколько
       абзацев (имя и примечание §1.1.1.4), и резка по `<p>` сдвигает колонки.
    ⚠ Пустые ячейки НЕ выбрасываем — иначе съезжает нумерация у записей без EC.
    ⚠ В акте строка открывается кавычкой („), в консолидации рядом с номером
    может стоять метка правки (►C11 … ◄).
    """
    for m in re.finditer(re.escape(idx), blob):
        a, b = blob.rfind('<tr', 0, m.start()), blob.find('</tr>', m.start())
        if a < 0 or b < 0:
            continue
        cells = [norm(c.replace('</p>', '</p> ')) for c in TD.findall(blob[a:b])]
        if not cells:
            continue
        first = re.sub(r'[\u25ba\u25c4\u25bc]\s*[BMC]?\d*', '', cells[0]).strip(' \u201e"\u201c\u00ab\u00bb\u201d')
        if first == idx:
            return cells
    return None

_cache = {}


def cons_text(lang):
    p = f'{TMP}/clp-consolidated-{lang.lower()}.html'
    if p not in _cache:
        _cache[p] = open(p, encoding='utf-8', errors='replace').read() if os.path.exists(p) else None
    return _cache[p]


def act_pages(celex, lang):
    """Страницы акта текстом. pdftotext -layout сохраняет колонки — без него
    имя вещества смешалось бы с классификацией из соседней ячейки."""
    key = f'act:{celex}:{lang}'
    if key in _cache:
        return _cache[key]
    pdf = f'{TMP}/act-{celex}-{lang.lower()}.pdf'
    txt = f'{TMP}/act-{celex}-{lang.lower()}.txt'
    if not os.path.exists(pdf):
        _cache[key] = None
        return None
    if not os.path.exists(txt) or os.path.getmtime(txt) < os.path.getmtime(pdf):
        subprocess.run(['pdftotext', '-layout', pdf, txt], check=True, timeout=600)
    with open(txt, encoding='utf-8', errors='replace') as f:
        _cache[key] = f.read().split('\f')
    return _cache[key]


def cons_name(lang, idx):
    blob = cons_text(lang)
    if blob is None:
        return None
    cells = html_row(blob, idx)
    if cells is None:
        return None
    return cells[1] if len(cells) > 1 else ''


def act_html(celex, lang):
    """XHTML акта — запасной источник там, где PDF-представления нет."""
    key = f'acthtml:{celex}:{lang}'
    if key not in _cache:
        p = f'{TMP}/act-{celex}-{lang.lower()}.html'
        _cache[key] = open(p, encoding='utf-8', errors='replace').read() if os.path.exists(p) else None
    return _cache[key]


def act_name_html(celex, lang, idx):
    """То же имя, но из XHTML. ⚠ Источник возвращается отдельно: вердикт по
    XHTML слабее, чем по PDF, и в отчёте это обязано быть видно."""
    blob = act_html(celex, lang)
    if blob is None:
        return None
    cells = html_row(blob, idx)
    if cells is None:
        return None
    return cells[1] if len(cells) > 1 else ''


def act_name(celex, lang, idx):
    """Имя из акта — из XHTML; номер полосы — из PDF.

    ⚠⚠⚠ РАЗДЕЛЕНИЕ РОЛЕЙ, И ОНО НЕ ОЧЕВИДНО. Сперва я брал текст из PDF: он
    факсимиле полосы ОЖ, значит аутентичнее. Контроль это отверг — и был прав.
    В наборе ОЖ длинные химические имена ПЕРЕНОСЯТСЯ по слогам, и текстовый слой
    хранит перенос:

        XHTML: tris[3-amminopropil-2-idrossi-N,N-dimetil-N-alchil C6-18]
        PDF:   tris[3- amminopropil-2-idrossi-N,N-dimetil-N-al- chil C6-18]

    ⚠⚠ Снять переносы механически НЕЛЬЗЯ: часть дефисов принадлежит самому имени
    (`3-amminopropil`), часть добавлена вёрсткой (`N-al-` + `chil`), и по одному
    знаку они неразличимы. Убрать все дефисы — значит перестать замечать разницу
    в дефисе, а она в химическом имени бывает существенной.

    ⭐⭐ Поэтому каждый источник делает то, что умеет: XHTML даёт ТЕКСТ ячейки без
    вёрстки, PDF даёт НОМЕР ПОЛОСЫ. Номер полосы от разбора ячейки не зависит
    вовсе — достаточно найти index-номер на странице.

    ⭐ Что полоса PDF равна полосе ОЖ, проверено колонтитулом: запись
    015-011-00-6 стоит на 42-й странице, в шапке напечатано `L 115/42`, и ровно
    полосу 42 называет французский корриджендум.
    """
    page = pdf_page_of(celex, lang, idx)
    where = f'полоса {page}' if page else 'полосы нет'
    txt = act_name_html(celex, lang, idx)
    if txt is not None:
        return txt, f'xhtml, {where}'
    txt, _ = act_name_pdf(celex, lang, idx)
    if txt is not None:
        return txt, f'⚠ текст из PDF (переносы), {where}'
    return None, None


def pdf_page_of(celex, lang, idx):
    """Полоса ОЖ, на которой стоит запись. ⚠ Только номер, без разбора ячейки."""
    pages = act_pages(celex, lang)
    if pages is None:
        return None
    for n, page in enumerate(pages, 1):
        for line in page.split('\n'):
            m = ROW_START.match(line)
            if m and m.group(1) == idx:
                return n
    return None


def act_name_pdf(celex, lang, idx):
    """Ячейка имени из PDF: режем по колонке, границы берём с первой строки.

    ⚠ Левая граница — сразу за index-номером, правая — начало номера EC (или
    CAS, если EC не присвоен и там прочерк). Крайний случай — просто широкий
    зазор: в вёрстке ОЖ колонки разделены тремя и более пробелами."""
    pages = act_pages(celex, lang)
    if pages is None:
        return None, None
    for pageno, page in enumerate(pages, 1):
        lines = page.split('\n')
        for i, line in enumerate(lines):
            m = ROW_START.match(line)
            if not m or m.group(1) != idx:
                continue
            col0 = m.end()
            tail = line[col0:]
            ec = EC_RE.search(tail) or CAS_RE.search(tail)
            if ec and ec.start() > 0:
                col1 = col0 + ec.start()
            else:
                gap = GAP_RE.search(tail)
                col1 = col0 + gap.start() if gap else len(line)
            parts = [line[col0:col1]]
            for nxt in lines[i + 1:i + 40]:
                if ROW_START.match(nxt):
                    break
                if JUNK.search(nxt):
                    continue
                piece = nxt[col0:col1]
                if piece.strip():
                    parts.append(piece)
            return norm(' '.join(parts)), pageno
    return None, None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    langs = {a.upper() for a in args} or None

    print('=== КОНТРОЛЬ РАЗБОРА ===')
    ran = ok_all = 0
    for idx, lang, celex, must_differ, why in CONTROLS:
        c, (a, page) = cons_name(lang, idx), act_name(celex, lang, idx)
        if c is None or a is None:
            print(f'  {lang} {idx}: ⏳ акт ещё не скачан')
            continue
        differ = norm(c) != a and a not in norm(c) and norm(c) not in a
        good = differ == must_differ
        ran += 1
        ok_all += good
        print(f'  {lang} {idx}: {"ПРОШЁЛ" if good else "НЕ ПРОШЁЛ"} — {why}')
        print(f'      конс.: {c[:105]}')
        print(f'      акт  : {a[:105]}   ({page})')
    if ran and ok_all != ran:
        print('⚠⚠ КОНТРОЛЬ НЕ ПРОЙДЕН — вердиктам ниже верить нельзя.')
    print()

    same = diff = miss = 0
    for idx, lang, celex, kind in FINDINGS:
        if langs and lang not in langs:
            continue
        c = cons_name(lang, idx)
        a, page = act_name(celex, lang, idx)
        if c is None:
            print(f'{idx} {lang}: ⚠ нет консолидации'); miss += 1; continue
        if a is None:
            print(f'{idx} {lang} [{kind}]: ⏳ акт {celex} не скачан'); miss += 1; continue
        cn = norm(c)
        hit = cn == a or cn in a or a in cn
        if hit:
            same += 1
            print(f'✓ {idx} {lang} [{kind}] — АКТ = КОНСОЛИДАЦИЯ → дефект закона   ({page})')
            print(f'      {a[:105]}')
        else:
            diff += 1
            print(f'✗ {idx} {lang} [{kind}] — АКТ ИНОЙ → дефект сборки   ({page})')
            print(f'      конс.: {cn[:105]}')
            print(f'      акт  : {a[:105]}')
        pair = PAIRS.get(idx)
        if pair:
            ap, _ = act_name(celex, lang, pair)
            if ap:
                flag = '⚠ В АКТЕ У ПАРЫ ТО ЖЕ САМОЕ' if ap == a else 'у пары иначе'
                print(f'      пара {pair}: {flag}')
                print(f'        {ap[:105]}')

    print('-' * 96)
    print(f'акт = консолидация: {same}   акт иной: {diff}   не проверено: {miss}')
    if diff:
        print('⚠⚠ Есть расхождения — по этим строкам виновата СБОРКА, а не закон.')
    if same and not diff and not miss:
        print('⭐ Все находки есть в исходных актах ОЖ → дефект самого регламента.')


if __name__ == '__main__':
    main()
