import { getTranslations } from "next-intl/server";
import {
  SITE_CONTENT_PAGE_FIELDS,
  type SiteContentPage,
} from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { getSiteContent, siteText } from "@/lib/site-content";
import { EmptyState } from "@/components/ui/states";
import { FaqList } from "./faq-list";

/**
 * About, FAQ and Contact — one component, three routes.
 *
 * Each page's body is a SITE CONTENT FIELD, edited from the existing
 * admin content screen. No new table, no new endpoint and no migration:
 * the fields were added to `SITE_CONTENT_FIELDS`, and the admin editor
 * and the API validator both iterate that same list, so they appeared on
 * both sides at once.
 *
 * THE TEXT IS A TEXT NODE. Operator-written content is never HTML,
 * never Markdown, and never reaches `dangerouslySetInnerHTML` — a
 * repo-wide test forbids that call anywhere in this app. Line breaks
 * survive through `whitespace-pre-line`, which is formatting the
 * BROWSER applies to a plain string rather than markup the operator can
 * inject.
 *
 * NOTHING INTERNAL IS EXPOSED. The page reads one resolved string per
 * locale; there is no row id, no field name and no settings metadata in
 * the output.
 *
 * An unset field is not an error. It renders the empty state, because a
 * page nobody has written yet is a normal state on a fresh install —
 * and an operator seeing it knows exactly where to go.
 */
export interface ContentPageProps {
  locale: AppLocale;
  page: SiteContentPage;
}

export async function ContentPage({ locale, page }: ContentPageProps) {
  const t = await getTranslations({ locale, namespace: "pages" });

  const content = await getSiteContent();
  const body = siteText(content, SITE_CONTENT_PAGE_FIELDS[page], locale);

  // The FAQ is a LIST of questions, not one block: it is the page that
  // grows an entry at a time, and an operator needs to reorder and
  // retire entries rather than edit a wall of text. Its intro paragraph
  // is still the page's own content field, so a page can have both.
  const faqItems = page === "faq" ? content.faqItems : [];
  const isEmpty = body === null && faqItems.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-primary">
        {t(`${page}.title`)}
      </h1>

      {isEmpty ? (
        <EmptyState title={t(`${page}.title`)} description={t("empty")} />
      ) : (
        <>
          {body === null ? null : (
            <p className="max-w-3xl whitespace-pre-line text-sm text-content">
              {body}
            </p>
          )}
          {faqItems.length > 0 ? (
            <FaqList items={faqItems} locale={locale} />
          ) : null}
        </>
      )}
    </div>
  );
}
