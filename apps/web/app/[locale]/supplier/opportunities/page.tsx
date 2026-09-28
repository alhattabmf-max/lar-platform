import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { SupplierOpportunitySummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierOpportunities } from "@/lib/supplier-data";
import { opportunityNeedsAttention } from "@/lib/opportunity-actions";
import { localized, formatDate } from "@/lib/localized";
import { formatQuantity } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ProductRowCard } from "@/components/supplier/product-row-card";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.opportunities");


/**
 * The supplier's offers — the SELLING, not the things sold.
 *
 * Each row here is one offer on one product: a price, a quantity, a
 * clock. The same product carries them one after another, so the
 * catalogue is a separate list under «منتجاتي» and this one repeats
 * none of it.
 *
 * AN OFFER IS NOT CREATED FROM HERE. It is made ON a product, so the
 * button points at the catalogue rather than at a form that would have
 * to open by asking which product this is about.
 *
 * NOT paginated: `GET /companies/me/opportunities` returns the company's
 * own list, so there is no page control here.
 *
 * What needs attention comes first and vanishes when nothing does — DRAFT has
 * never been published, ACTION_REQUIRED was published and then blocked.
 *
 * Every amount is a decimal string formatted at the edge of rendering.
 * Nothing on this page adds, multiplies or totals money.
 */
export default async function SupplierOpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  // THE ONE SEARCH FIELD LANDS HERE — «كلٌّ يبحث في عالمه», and the
  // supplier's world is their own offers.
  const raw = (await searchParams).q;
  const term = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) || undefined;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.opportunities" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      {/* THE TAB ABOVE IS THIS PAGE'S TITLE — «نكتفي باسم القسم في
          اللسان كعنوان للصفحة». The heading stays for the document
          outline and for anyone reading by structure; a tab is a link
          and can never stand in for it. Absolutely positioned, so the
          row it used to occupy costs nothing. */}
      <header className="sr-only">
        <h1>{t("title")}</h1>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <Listings locale={appLocale} term={term} />
      </Suspense>
    </div>
  );
}

async function Listings({ locale, term }: { locale: AppLocale; term?: string }) {
  const t = await getTranslations({ locale, namespace: "supplier.opportunities" });
  const states = await getTranslations({ locale, namespace: "states" });
  const search = await getTranslations({ locale, namespace: "shell.search" });

  const opportunities = await loadSupplierOpportunities();

  if (!opportunities.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={opportunities.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  // THE WAY TO ADD A FIRST ONE IS IN THE STRIP ABOVE, which is drawn
  // by the layout on every page — so an empty list needs nothing of
  // its own here, and a supplier with nothing yet still has the button.
  if (opportunities.data.length === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  // FILTERED HERE, NOT BY THE API, and that is safe for exactly one
  // reason: this route returns a supplier's WHOLE list, unpaginated. On
  // a paginated surface the same filter would drop matches on every
  // page but the one being shown, which is why the marketplace sends
  // its term to the server instead.
  //
  // THE PRODUCT'S NAME, IN BOTH LOCALES, which is every text field this
  // SUMMARY carries — the offer's own description is on the DETAIL
  // contract and not here, so matching it would mean loading every
  // offer in full to filter a list. «الاسم والوصف معًا» is honoured
  // where the description is actually available: the marketplace, whose
  // search the API answers.
  //
  // BOTH LOCALES WHICHEVER IS BEING READ: a supplier who filed a
  // product in English still finds it while browsing in Arabic.
  const needle = term?.toLocaleLowerCase();
  const matches = needle
    ? opportunities.data.filter((o) =>
        [o.productNameAr, o.productNameEn].some((field) =>
          field?.toLocaleLowerCase().includes(needle),
        ),
      )
    : opportunities.data;

  if (matches.length === 0) {
    return (
      <EmptyState
        title={search("noResults", { term: term ?? "" })}
        description={search("noResultsHint")}
      />
    );
  }

  const attention = matches.filter((o) => opportunityNeedsAttention(o.status));
  const rest = matches.filter((o) => !opportunityNeedsAttention(o.status));

  return (
    <div className="flex flex-col gap-6">
      {attention.length > 0 ? (
        <Card ariaLabel={t("needsAttention.title")} className="border-warning">
          <CardHeader>
            <CardTitle>{t("needsAttention.title")}</CardTitle>
          </CardHeader>
          <CardBody>
            <ListingList locale={locale} opportunities={attention} />
          </CardBody>
        </Card>
      ) : null}

      <section aria-label={t("allTitle")} className="flex flex-col gap-3">
        {/* THE NAME OF THE LIST, FOR A READER WHO CANNOT SEE THE TAB.
            The lit tab above says it on screen and the strip beside it
            carries the one action — «احذف الشريط اللي حطيته أنت
            سابقًا» — so nothing is printed here twice. The heading
            stays for the document outline and for anyone reading by
            structure. */}
        <h2 className="sr-only">{t("allTitle")}</h2>
        {rest.length === 0 ? (
          <p className="text-sm text-content-muted">{t("allHandled")}</p>
        ) : (
          <ListingList locale={locale} opportunities={rest} />
        )}
      </section>
    </div>
  );
}

async function ListingList({
  locale,
  opportunities,
}: {
  locale: AppLocale;
  opportunities: readonly SupplierOpportunitySummary[];
}) {
  const t = await getTranslations({ locale, namespace: "supplier.opportunities" });
  const status = await getTranslations({ locale, namespace: "supplier.status" });

  return (
    <ul className="flex list-none flex-col gap-card-gap">
      {opportunities.map((opportunity) => {
        const unit = localized(
          locale,
          opportunity.salesUnitNameAr,
          opportunity.salesUnitNameEn,
        );

        return (
          <li key={opportunity.id}>
            <ProductRowCard
              opportunity={opportunity}
              locale={locale}
              labels={{
                unitPrice: t("unitPrice"),
                priceInclTax: t("priceInclTax"),
                perUnit: unit ? t("perUnit", { unit }) : null,
                soldOfTarget: t(opportunity.saleMode === "DIRECT" ? "soldOfStock" : "soldOfTarget"),
                // The two counts the server sent, printed in full. The
                // bar beside them is a picture of these, not a third
                // figure this page worked out.
                soldOfTargetValue: `${t("fundedOfTarget", {
                  funded: formatQuantity(opportunity.fundedQuantity, locale),
                  target: formatQuantity(opportunity.targetQuantity, locale),
                })}${unit ? ` ${unit}` : ""}`,
                endsAt: t(opportunity.saleMode === "DIRECT" ? "availability" : "endsAt"),
                endsAtValue: opportunity.saleMode === "DIRECT"
                  ? t("noEndDate")
                  : formatDate(opportunity.endAt, locale) ?? "",
                viewDetails: t("viewDetails"),
                noImage: t("noImage"),
                // Always the translated status, never the raw enum.
                status: status(`opportunity.${opportunity.status}`),
                statusTone:
                  opportunity.status === "ACTION_REQUIRED"
                    ? "attention"
                    : opportunity.status === "ACTIVE" || opportunity.status === "FUNDED"
                      ? "done"
                      : "neutral",
                reason: opportunity.reasonCode
                  ? status(`opportunityReason.${opportunity.reasonCode}`)
                  : null,
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}
