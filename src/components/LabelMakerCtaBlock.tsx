// src/components/LabelMakerCtaBlock.tsx
//
// Тот же блок «собрать этикетку», что `LabelMakerCta.astro`, но ВНУТРИ
// React-острова. Пункты A2 и A3 плана `claude/label-maker-hub-plan.md`.
//
// ⚠⚠ ЗАЧЕМ ВТОРОЙ ФАЙЛ, ЕСЛИ ЕСТЬ .astro. Страница фразы знает свой код на
// сборке — там блок статический. Инструмент знает свой ответ только ПОСЛЕ
// ПЕРЕСЧЁТА: на селекторе между галочками и результатом лежит CLP Art. 26,
// который часть пиктограмм снимает. Отрисовать этот блок в `.astro` и потом
// дописывать ему `href` скриптом — значит завести третье место, где собирается
// адрес конструктора.
//
// ⚠⚠ ЧТО УДЕРЖИВАЕТ ДВА ФАЙЛА ВМЕСТЕ. Оформления у блока своего нет: классы
// приходят из `LMC_CLASS` (один объект на оба файла), стили — из `hub.css`
// (`.lmc-*`, одна семья), цвет — из карты разделов, адрес — из `ctaHref`.
// Разойтись им негде: расходятся редакции, а здесь редакция одна, отрисовщика
// два.
//
// ⚠ Ни одной утилиты Tailwind и ни одного литерала цвета — design-system.md §7.
import { LABEL_MAKER_BASE } from '../lib/labelMakerLink';
import { ctaHref, LMC_CLASS, type CtaContent } from '../lib/labelMakerCta';
import { accentClass, accentBadge } from '../lib/sectionAccent';

type Props = {
  /**
   * Содержание блока. ⚠⚠ `null` — законное значение и означает «передавать
   * нечего»: обе функции-сборщика возвращают его, когда результата ещё (или
   * уже) нет. Проверка здесь, а не у каждого вызывающего, затем, чтобы условие
   * показа блока жило в одном месте.
   */
  content: CtaContent | null;
  /** Хаб или его ветка. */
  base?: string;
  /** `inline` — внутри колонки инструмента; `wide` — во всю ширину текста. */
  variant?: 'wide' | 'inline';
};

export default function LabelMakerCtaBlock({
  content,
  base = LABEL_MAKER_BASE,
  variant = 'inline',
}: Props) {
  if (!content) return null;

  const href = ctaHref(content.params, base);
  // ⚠ Акцент — ПО АДРЕСУ НАЗНАЧЕНИЯ, а не по странице, на которой блок стоит:
  // он уводит в label maker, значит он оранжевый, а не янтарный, как селектор.
  const acc = accentClass(base);
  const badge = accentBadge(base);
  const variantClass = variant === 'wide' ? LMC_CLASS.wide : LMC_CLASS.inline;

  return (
    <aside className={`${LMC_CLASS.root} ${variantClass}${acc ? ` ${acc}` : ''}`}>
      {badge && <span className={LMC_CLASS.badge}>{badge}</span>}
      <h3 className={LMC_CLASS.title}>{content.title}</h3>
      <p className={LMC_CLASS.copy}>{content.copy}</p>
      <a className={LMC_CLASS.cta} href={href}>{content.cta}</a>
      {content.note && <p className={LMC_CLASS.note}>{content.note}</p>}
    </aside>
  );
}
