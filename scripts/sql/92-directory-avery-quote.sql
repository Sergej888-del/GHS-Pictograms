-- 92-directory-avery-quote.sql — архив миграции s92_directory_avery_quote_fragment (применена Claude через MCP, 05.10.2026)
--
-- Почему: Сергей спросил, правда ли это написано у Avery. Проверка глазами в браузере (блог Avery «How to create
-- GHS labels using the Avery GHS Wizard»): обе цитаты на странице есть, НО факт 621 печатался как отдельная фраза
-- «You are responsible for ensuring the accuracy of the label information.», а на странице это хвост инструкции:
-- «click the box indicating that you are responsible for ensuring the accuracy of the label information».
-- Слова дословные, граница предложения и заглавная буква — наши. В кавычках так нельзя: теперь с «…» и контекстом,
-- который к тому же точнее говорит, что делает продукт (галочка «я отвечаю за точность» перед FINISH).
-- Факт 622 (disclaimer статей Avery) — дословно, фраза продолжается «…or legal advice regarding any specific issue
-- or factual circumstance.» — оставлен как есть (обрезан многоточием).
--
-- До:    quote = 'You are responsible for ensuring the accuracy of the label information.'
-- После: quote = '…click the box indicating that you are responsible for ensuring the accuracy of the label information.'
-- Посев: scripts/data/directory-v3.json правлен так же (quote + evidence).
-- Откат: не нужен — старая форма неверна.

update public.directory_facts
   set quote = '…click the box indicating that you are responsible for ensuring the accuracy of the label information.',
       evidence = 'click the box indicating that you are responsible for ensuring the accuracy of the label information',
       confirmed = true, confirmed_on = '2026-10-05'
 where id = 621
   and quote = 'You are responsible for ensuring the accuracy of the label information.';
