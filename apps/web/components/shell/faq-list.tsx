import type { PublicFaqItem } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { localized } from "@/lib/localized";

/**
 * The questions, as a list of disclosures.
 *
 * `<details>` rather than a scripted accordion: it opens without
 * JavaScript, is keyboard operable and screen-reader announced by the
 * browser, and survives a failed hydration. A FAQ is exactly the content
 * that must work when nothing else does.
 *
 * Both strings are TEXT NODES. Operator-written content is never markup
 * anywhere in this app, and answers preserve their line breaks through
 * `whitespace-pre-line`, which is formatting the browser applies to a
 * plain string rather than markup an operator can inject.
 *
 * Only ACTIVE items reach here — the API drops the rest — so there is no
 * visibility decision to make in the view.
 */
export interface FaqListProps {
  items: readonly PublicFaqItem[];
  locale: AppLocale;
}

export function FaqList({ items, locale }: FaqListProps) {
  return (
    <ul className="flex list-none flex-col gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <details className="rounded-lg border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-primary marker:text-content-muted">
              {localized(locale, item.questionAr, item.questionEn)}
            </summary>
            <p className="whitespace-pre-line border-t border-line px-4 py-3 text-sm text-content-muted">
              {localized(locale, item.answerAr, item.answerEn)}
            </p>
          </details>
        </li>
      ))}
    </ul>
  );
}
