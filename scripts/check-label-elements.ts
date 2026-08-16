// Проверка наборов элементов этикетки: цеховые режимы и вывод (f)(6)(i).
//
//   node --experimental-strip-types scripts/check-label-elements.ts
//
// ⚠ Импорт с расширением `.ts` — так требует `--experimental-strip-types`.
// `jurisdictions.ts` не тянет ни одного внешнего модуля, поэтому проверка идёт
// без сборки Astro и без `tsx` — то есть работает и на машине, и из облака.
//
// ⭐⭐ ЗАЧЕМ ОНА. §1910.1200(f)(6) даёт ВЫБОР ИЗ ДВУХ законных наборов, а код до
// session 68 жёстко выбирал второй. Дефект прожил незамеченным потому, что
// проверять было нечего: один набор всегда «сходится сам с собой». Здесь
// проверяется не значение, а СВОЙСТВА — и три контроля противоположного
// ожидания ловят возврат к старой форме.
//
// Дословный текст, по которому написаны ожидания:
//   (f)(1)   (i) product identifier · (ii) signal word · (iii) hazard statement(s)
//            (iv) pictogram(s) · (v) precautionary statement(s)
//            (vi) name, U.S. address, and U.S. telephone number …
//   (f)(6)   the employer shall ensure that each container … is labeled … with either:
//            (i)  the information specified under paragraphs (f)(1)(i) through (v); or
//            (ii) product identifier and words, pictures, symbols, or combination
//                 thereof, which provide at least general information regarding the
//                 hazards of the chemicals …
//   (f)(8)   … not required to label portable containers … intended only for the
//            immediate use of the employee who performs the transfer.

import {
  JURISDICTIONS,
  JURISDICTION_ORDER,
  elementsFor,
  workplaceOptionFor,
  type Jurisdiction,
  type LabelElement,
  type WorkplaceOption,
} from '../src/lib/jurisdictions.ts';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}
function group(title: string) {
  console.log(`\n━━ ${title}`);
}
const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * ⭐⭐ ПРАВИЛА ВЫНЕСЕНЫ В ФУНКЦИЮ, ЧТОБЫ ИХ МОЖНО БЫЛО НАТРАВИТЬ НА ПОДДЕЛКУ.
 *
 * Проверка, которую нельзя заставить покраснеть, ничего не доказывает: она
 * зелёная и когда правила работают, и когда они развалились. Ниже те же
 * правила прогоняются по трём заведомо негодным юрисдикциям.
 */
function problemsOf(j: { key: string; supplierElements: LabelElement[]; workplaceOptions: WorkplaceOption[] }): string[] {
  const p: string[] = [];
  const opts = j.workplaceOptions;
  if (!opts || opts.length === 0) { p.push('список наборов пуст'); return p; }

  const keys = opts.map((o) => o.key);
  if (new Set(keys).size !== keys.length) p.push(`ключи повторяются: ${keys.join(', ')}`);

  for (const o of opts) {
    if (!o.key.trim()) p.push('у набора пустой ключ');
    if (!o.label.trim()) p.push(`${o.key}: пустая подпись`);
    if (!o.citation.trim()) p.push(`${o.key}: нет ссылки на норму`);
    if (!o.note.trim()) p.push(`${o.key}: нет пояснения`);
    if (o.elements.length === 0) p.push(`${o.key}: набор элементов пуст`);
    // ⚠ Идентификатор продукта называют ВСЕ четыре нормы — это то общее, без
    // чего цеховая этикетка перестаёт быть этикеткой.
    if (!o.elements.includes('productIdentifier')) p.push(`${o.key}: нет productIdentifier`);
    // ⚠⚠ Блок поставщика на цеховой таре не требует НИ ОДНА из четырёх норм:
    // у OSHA (f)(1)(vi) прямо вынесен за скобки ссылки (f)(6)(i).
    if (o.elements.includes('supplier')) p.push(`${o.key}: блок поставщика на цеховой этикетке`);
    if (new Set(o.elements).size !== o.elements.length) p.push(`${o.key}: элемент повторяется`);
  }
  return p;
}

console.log('Наборы элементов этикетки — проверка свойств, а не значений');

group('1. Каждая юрисдикция даёт хотя бы один законный набор');
for (const key of JURISDICTION_ORDER) {
  const j: Jurisdiction = JURISDICTIONS[key];
  const p = problemsOf(j);
  check(`${j.tag}: ${j.workplaceOptions.length} набор(ов), нарушений нет`, p.length === 0, p.join('; '));
}

group('2. Вывод (f)(6)(i) — из этикетки поставщика, а не из второго списка');
{
  const osha = JURISDICTIONS.osha;
  const f6i = osha.workplaceOptions.find((o) => o.key === 'f6i');
  const expected = osha.supplierElements.filter((e) => e !== 'supplier');
  // ⚠⚠ Проверка обязана проверять себя: сломайся источник — сравнивать станет
  // нечего, и совпадение пустых списков выглядело бы успехом.
  check('источник вывода непустой', expected.length === 5, `элементов: ${expected.length}, ждали 5`);
  check('набор (f)(6)(i) существует', !!f6i);
  if (f6i) {
    check(
      '(f)(6)(i) = этикетка поставщика минус блок поставщика',
      same(f6i.elements, expected),
      `у нас: ${f6i.elements.join(', ')}\n      вывод: ${expected.join(', ')}`,
    );
    check('в (f)(6)(i) нет supplier', !f6i.elements.includes('supplier'));
  }
}

group('3. OSHA: выбор из двух, и порядок сохраняет прежнее поведение');
{
  const osha = JURISDICTIONS.osha;
  // ⛔ Это и есть закрываемый дефект: один набор значит, что инструмент снова
  // отвечает за человека на вопрос, который норма оставила ему.
  check('наборов ровно два', osha.workplaceOptions.length === 2, `их ${osha.workplaceOptions.length}`);
  // ⚠⚠ Первый — умолчание. До session 68 поведением был (f)(6)(ii); поставить
  // первым (f)(6)(i) значит молча поменять этикетку всем, кто уже пользуется.
  check('первым идёт f6ii — умолчание не поехало', osha.workplaceOptions[0]?.key === 'f6ii',
    `первый: ${osha.workplaceOptions[0]?.key}`);
  check('второй — f6i', osha.workplaceOptions[1]?.key === 'f6i');
  check('у f6ii набор короче, чем у f6i',
    (osha.workplaceOptions[0]?.elements.length ?? 0) < (osha.workplaceOptions[1]?.elements.length ?? 0));
  check('обе ссылки называют (f)(6)',
    osha.workplaceOptions.every((o) => o.citation.includes('1910.1200(f)(6)')),
    osha.workplaceOptions.map((o) => o.citation).join(' | '));
}

group('4. У остальных трёх выбора нет — и мы его не выдумываем');
for (const key of (['clp', 'gbclp', 'whmis'] as const)) {
  const j = JURISDICTIONS[key];
  check(`${j.tag}: ровно один набор`, j.workplaceOptions.length === 1, `их ${j.workplaceOptions.length}`);
}

group('5. Неизвестный ключ сворачивается в первый набор, а не в пустой');
for (const key of JURISDICTION_ORDER) {
  const j = JURISDICTIONS[key];
  const first = j.workplaceOptions[0];
  check(`${j.tag}: ключ «нет такого» → ${first.key}`, workplaceOptionFor(j, 'нет-такого-ключа').key === first.key);
  check(`${j.tag}: undefined → ${first.key}`, workplaceOptionFor(j, undefined).key === first.key);
  check(`${j.tag}: elementsFor с чужим ключом непустой`,
    elementsFor(j, 'workplace', undefined, 'f6i-которого-тут-нет').length > 0);
}

group('6. Ключ читается только у цеховой этикетки');
{
  const osha = JURISDICTIONS.osha;
  check('supplier: ключ игнорируется',
    same(elementsFor(osha, 'supplier', undefined, 'f6i'), osha.supplierElements));
  check('workplace + f6i: набор именно f6i',
    same(elementsFor(osha, 'workplace', undefined, 'f6i'), osha.workplaceOptions[1].elements));
  check('workplace + f6ii: набор именно f6ii',
    same(elementsFor(osha, 'workplace', undefined, 'f6ii'), osha.workplaceOptions[0].elements));
  check('workplace без ключа = f6ii (прежнее поведение)',
    same(elementsFor(osha, 'workplace'), osha.workplaceOptions[0].elements));
  // ⚠ Малая тара: у OSHA порог 100 мл оставляет свой список, ключ цеха тут ни при чём.
  check('small 50 мл: ключ цеха не вмешивается',
    same(elementsFor(osha, 'small', 50, 'f6i'), ['productIdentifier', 'pictograms', 'signalWord', 'supplier', 'outerPackageNote']));
}

group('7. Контроли: правила обязаны отвергнуть подделку');
{
  const base = JURISDICTIONS.osha;
  const bad = [
    {
      name: 'пустой список наборов',
      j: { key: 'x', supplierElements: base.supplierElements, workplaceOptions: [] as WorkplaceOption[] },
    },
    {
      name: 'набор без productIdentifier',
      j: {
        key: 'x', supplierElements: base.supplierElements,
        workplaceOptions: [{ ...base.workplaceOptions[0], elements: ['hazardStatements'] as LabelElement[] }],
      },
    },
    {
      name: 'блок поставщика на цеховой этикетке',
      j: {
        key: 'x', supplierElements: base.supplierElements,
        workplaceOptions: [{ ...base.workplaceOptions[0], elements: ['productIdentifier', 'supplier'] as LabelElement[] }],
      },
    },
  ];
  for (const b of bad) {
    const p = problemsOf(b.j);
    check(`отвергнуто: ${b.name}`, p.length > 0, 'правила промолчали — у проверки нет зубов');
  }
  // И обратный контроль: годная юрисдикция обязана пройти те же правила.
  check('пропущено: настоящая OSHA', problemsOf(base).length === 0, problemsOf(base).join('; '));
}

console.log(
  failed === 0
    ? '\n✅ все проверки прошли'
    : `\n❌ не сошлось: ${failed}`,
);
process.exit(failed === 0 ? 0 : 1);
