# Session 59 — шаги на машине

Правка: у каждой пометки об ошибке Annex VI появилась **ссылка на акт, выпуск
Официального журнала и полосу**, а формулировка усилена с «в консолидированном
тексте» до «в самом Официальном журнале» — это доказано в session 58.

Меняется 4 файла: `src/lib/annex6Errata.ts`, `src/pages/substances/[slug].astro`,
`src/styles/hub.css`, `scripts/check-dist.ts`. Плюс два новых скрипта.

⭐ Тридцатая ошибка (мальтийский цирам `006-012-00-2`) **включена**: три
независимые линии доказательства, четвёртый вид `foreign-designation`.

---

## 1. Типы

```
npm run check:types
```

Ожидание: 0 ошибок. ⭐ Уже прогнано в облаке — `tsc --noEmit` чист.

## 2. Сборка

```
npm run build
```

Ожидание: ~4 500 страниц, без ошибок.

## 3. Проверки

```
npm run check:dist
npm run check:seo
```

⚠⚠ Смотреть на **105-ю проверку** `annex6-errata-flags`. Она теперь сверяет
дословно ДВЕ вещи у каждой из 30 строк: текст свидетельства и ссылку на полосу
ОЖ. Заголовок должен читаться так:

```
N страниц помечено, 30 свидетельств и столько же ссылок на полосу ОЖ
сверено дословно (в списке 30)
```

⚠ Если упадёт «ссылка на полосу ОЖ не найдена дословно» — значит разметка и
модуль разошлись, а не данные неверны.

## 4. Список для IndexNow

```
node scripts/indexnow-errata.mjs
```

Соберёт `indexnow-errata.txt` по собранному `dist`: ровно те страницы, где
пометка стоит. ⚠ Список НЕ угадывается по index-номерам — слаг считается из
имени и CAS, и угаданный адрес был бы несуществующим.

## 5. Коммит и деплой — ДВА коммита, не один

⚠ В рабочей копии лежат ещё и скрипты сверки из session 58, они не
коммитились. Смешивать их с правкой сайта не надо: одно — исследование, другое —
живая страница, и откатывать их может понадобиться порознь.

```
git add scripts/probe-cellar.mjs scripts/download-clp-act.mjs ^
        scripts/download-oj-pdf.mjs scripts/download-oj-issue.mjs ^
        scripts/verify-oj-acts.py scripts/build-errata-dossier.ts
git commit -F commit-session58.txt

git add -A
git commit -F commit-session59.txt
git push
```

⚠ В PowerShell перенос строки — это `` ` ``, а не `^`. Проще одной строкой:

```
git add scripts/probe-cellar.mjs scripts/download-clp-act.mjs scripts/download-oj-pdf.mjs scripts/download-oj-issue.mjs scripts/verify-oj-acts.py scripts/build-errata-dossier.ts
git commit -F commit-session58.txt
git add -A
git commit -F commit-session59.txt
git push
```

## 6. После деплоя

- ⚠⚠ **Кэш Cloudflare чистить ПОЛНОСТЬЮ:** менялся `hub.css`, у него новый хеш
  в имени файла, и старый HTML сошлётся на несуществующий.
- **IndexNow — только адреса из `indexnow-errata.txt`.** Содержание изменилось
  ровно на них; отправлять весь справочник значит тратить краулинговый бюджет
  на страницы, где не поменялось ничего.

---

## Что проверено в облаке

| что | чем | результат |
|---|---|---|
| типы | `tsc --noEmit` с настройками проекта | 0 ошибок |
| ссылка на полосу | `erratumCitation` на трёх записях | `Regulation (EU) 2018/669, OJ L 115, 4.5.2018, p. 42` |
| модуль против файлов | `build-errata-dossier.ts` | акт и полоса сошлись у всех 30 |
| отрисовка | Playwright, настоящие `design-tokens.css` + `hub.css` | 1280 и 390 px, переполнения нет |
| контраст | янтарь `#92400e` на `#fffbeb` | 6,84 : 1 при норме AA 4,5 |
