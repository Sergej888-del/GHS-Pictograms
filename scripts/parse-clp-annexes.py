#!/usr/bin/env python3
"""
Разбор Annex III (H + EUH) и Annex IV (P) консолидированного CLP на 24 языка.

⚠⚠ ОБА ПРИЛОЖЕНИЯ УСТРОЕНЫ ОДИНАКОВО, и на этом всё держится: трёхколоночная
таблица, где строка-шапка это [КОД | "Language" | описание класса], а дальше идут
строки [пусто | ЯЗЫК | текст]. Никакой другой признак кода не нужен и не годится:
искать код регуляркой по тексту ячейки нельзя, потому что коды встречаются и в
описаниях («omit where P202 is used»).

⚠ Annex IV состоит из ДВУХ частей. Part 1 — критерии отбора, там пятиколоночные
таблицы и только английский. Part 2 — сами фразы на 24 языках. Резать по «Part 2»
не нужно: таблицы Part 1 просто не содержат шапки со словом Language и
отбрасываются сами.

Источник: EUR-Lex / Publications Office, CELEX 02008R1272.
Лицензия Commission Decision 2011/833/EU — использование свободно при указании
источника. Юридически аутентичен только текст в электронном Official Journal.
"""
import json
import re
import sys
from lxml import html as LH

SRC = '/mnt/user-data/uploads/ghspictograms/.tmp-eurlex/clp-consolidated.html'
OUT = '/home/claude/clp-translations.json'

# 24 официальных языка ЕС в порядке, в котором их печатает регламент.
LANGS = ['BG', 'ES', 'CS', 'DA', 'DE', 'ET', 'EL', 'EN', 'FR', 'GA', 'HR', 'IT',
         'LV', 'LT', 'HU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SL', 'FI', 'SV']
LANGSET = set(LANGS)

# ⚠⚠ EUH-коды в Annex III Part 2 напечатаны С ПРОБЕЛОМ — «EUH 014», а не «EUH014».
# На этом первый прогон потерял ВЕСЬ Part 2: приложение отдало 82 кода вместо
# полутора сотен, и пропажу было видно только по контрольной строке EUH.
# Пробел допускается в разборе и снимается в `norm_code`.
CODE_RE = re.compile(r'^(EUH\s?\d{3}[A-Za-z]?|H\s?\d{3}[A-Za-z]*|P\s?\d{3})'
                     r'(\s*\+\s*(EUH\s?\d{3}[A-Za-z]?|H\s?\d{3}[A-Za-z]*|P\s?\d{3}))*$')


def norm_code(c: str) -> str:
    """«EUH 014» → «EUH014», «H300 + H310» → «H300+H310». В базе коды без пробелов."""
    return re.sub(r'(?<=[A-Z])\s+(?=\d)', '', c).replace(' + ', '+').strip()


def cell_text(td) -> str:
    """
    Текст ячейки без служебных врезок.

    ⚠⚠ В консолидированном тексте внутри ячеек сидят маркеры изменений — ссылки
    вида ►M2 и одиночные ◄. Если их не снять, каждая вторая фраза приезжает как
    «Unstable explosive. ►M2 ◄» и попадает такой на этикетку.
    """
    for a in td.xpath('.//a'):
        a.drop_tree()
    t = td.text_content()
    t = t.replace('►', ' ').replace('◄', ' ')   # ► ◄
    t = re.sub(r'[▲▼]M?\d*', ' ', t)            # ▲ ▼M12
    t = t.replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', t).strip()


def main() -> int:
    raw = open(SRC, encoding='utf-8', errors='replace').read()

    a3 = raw.find('ANNEX III')
    a4 = raw.find('ANNEX IV', a3)
    m5 = re.search(r'ANNEX\s+V\b', raw[a4:])
    a5 = a4 + m5.start() if m5 else len(raw)
    if not (0 < a3 < a4 < a5):
        print('✖ не найдены границы приложений', file=sys.stderr)
        return 1

    out: dict[str, dict] = {}
    stats = {'annex_iii': 0, 'annex_iv': 0, 'skipped_tables': 0}

    for annex, start, end in (('III', a3, a4), ('IV', a4, a5)):
        doc = LH.fromstring(raw[start:end])
        for table in doc.xpath('//table'):
            code = None
            for tr in table.xpath('.//tr'):
                tds = tr.xpath('./td')
                if len(tds) < 2:
                    continue
                texts = [cell_text(td) for td in tds]

                # Строка-шапка блока: во второй ячейке слово Language.
                if len(texts) >= 2 and texts[1] == 'Language':
                    cand = texts[0]
                    code = norm_code(cand) if CODE_RE.match(cand) else None
                    if code and code not in out:
                        out[code] = {'annex': annex, 'texts': {}}
                    continue

                if code is None:
                    continue

                # Строка перевода: [пусто | ЯЗЫК | текст]
                lang = texts[1] if len(texts) >= 3 else None
                if lang in LANGSET:
                    body = texts[2].strip()
                    if body:
                        out[code]['texts'][lang] = body

            if code is None:
                stats['skipped_tables'] += 1

    for code, rec in out.items():
        stats['annex_iii' if rec['annex'] == 'III' else 'annex_iv'] += 1

    # ── Проверки, без которых импорт бессмыслен ──────────────────────────────
    full = [c for c, r in out.items() if len(r['texts']) == 24]
    partial = {c: sorted(LANGSET - set(r['texts'])) for c, r in out.items()
               if 0 < len(r['texts']) < 24}
    empty = [c for c, r in out.items() if not r['texts']]

    print(f'кодов найдено:        {len(out)}')
    print(f'  Annex III (H/EUH):  {stats["annex_iii"]}')
    print(f'  Annex IV  (P):      {stats["annex_iv"]}')
    print(f'полных (24 языка):    {len(full)}')
    print(f'неполных:             {len(partial)}')
    print(f'пустых:               {len(empty)}')
    if partial:
        for c, miss in list(partial.items())[:15]:
            print(f'    {c}: нет {",".join(miss)}')
    if empty:
        print('    пустые:', ', '.join(empty[:20]))

    # Контрольные значения — если разъедутся, парсер поймал не то.
    probes = [('H200', 'EN'), ('H319', 'DE'), ('P501', 'FR'), ('EUH014', 'EN'),
              ('EUH208', 'FR'), ('H200', 'EL'), ('H315', 'PL'), ('H360FD', 'EN')]
    print('\nконтрольные строки:')
    for code, lang in probes:
        val = out.get(code, {}).get('texts', {}).get(lang)
        print(f'  {code} {lang}: {val!r}')

    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'\n→ {OUT}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
