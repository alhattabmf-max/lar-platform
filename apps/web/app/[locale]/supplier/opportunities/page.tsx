import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SupplierOpportunitySummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierOpportunities } from "@/lib/supplier-data";
import { opportunityNeedsAttention } from "@/lib/opportunity-actions";
import { localized, formatDate } from "@/lib/localized";
import { formatMoney, formatQuantity } from "@/lib/money";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * The supplier's own listings.
 *
 * NOT paginated: `GET /companies/me/opportunities` returns the company's own
 * list, so there is no page control here.
 *
 * What needs attention comes first and vanishes when nothing does — DRAFT has
 * never been published, ACTION_REQUIRED was published and then blocked.
 *
 * Every amount is a decimal string formatted at the edge of rendering.
 * Nothing on this page adds, multiplies or totals money.
 */
export default async function SupplierOpportunitiesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.opportunities" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      {/* Always available: creating is not gated by any listing's state.
          What it needs is an APPROVED product, and the form says so when
          there is none. */}
      <section className="flex flex-wrap gap-3">
        <ButtonLink
          href={`/${appLocale}/supplier/opportunities/new`}
          variant="accentInteractive"
        >
          {t("newOpportunity")}
        </ButtonLink>
      </section>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <Listings locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function Listings({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.opportunities" });
  const states = await getTranslations({ locale, namespace: "states" });

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

  if (opportunities.data.length === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  const attention = opportunities.data.filter((o) => opportunityNeedsAttention(o.status));
  const rest = opportunities.data.filter((o) => !opportunityNeedsAttention(o.status));

  return (
    <div className="flex flex-col gap-6">
      {attention.length > 0 ? (
        <Card ariaLabel={t("needsAttention.title")} className="border-warning">
          <CardHeader>
            <CardTitle>{t("needsAttention.title")}</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-sm text-content-muted">{t("needsAttention.description")}</p>
            <ListingList locale={locale} opportunities={attention} />
          </CardBody>
        </Card>
      ) : null}

      <section aria-label={t("allTitle")} className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-content">{t("allTitle")}</h2>
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
    <ul className="grid list-none gap-3 sm:grid-cols-2">
      {opportunities.map((opportunity) => {
        const name = localized(locale, opportunity.productNameAr, opportunity.productNameEn);
        const unit = localized(locale, opportunity.salesUnitNameAr, opportunity.salesUnitNameEn);
        // Null rather than "0.00" when the amount is not a decimal string
        // the API should have sent: a zero is a claim about a price.
        const price = formatMoney(opportunity.unitPriceAmount, opportunity.currency, locale);
        const ends = formatDate(opportunity.endAt, locale);

        return (
          <li key={opportunity.id}>
            <Card>
              <CardBody>
                <div className="flex flex-col gap-2">
                  <Link
                    href={`/${locale}/supplier/opportunities/${opportunity.id}`}
                    className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                  >
                    {name}
                  </Link>

                  <span className="flex flex-wrap items-center gap-2">
                    {/* Always the translated status, never the raw enum. */}
                    <StatusBadge
                      label={status(`opportunity.${opportunity.status}`)}
                      tone={
                        opportunity.status === "ACTION_REQUIRED"
                          ? "attention"
                          : opportunity.status === "ACTIVE" || opportunity.status === "FUNDED"
                            ? "done"
                            : "neutral"
                      }
                    />
                    {opportunity.reasonCode ? (
                      <StatusBadge
                        label={status(`opportunityReason.${opportunity.reasonCode}`)}
                        tone="attention"
                      />
                    ) : null}
                  </span>

                  <dl className="grid gap-1 text-sm">
                    {price ? (
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-content-muted">{t("unitPrice")}</dt>
                        <dd className="text-content">
                          {unit ? t("pricePerUnit", { price, unit }) : price}
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-content-muted">{t("funded")}</dt>
                      {/* Two counts printed side by side — never a
                          percentage this page computed. */}
                      <dd className="text-content">
                        {t("fundedOfTarget", {
                          funded: formatQuantity(opportunity.fundedQuantity, locale),
                          target: formatQuantity(opportunity.targetQuantity, locale),
                        })}
                      </dd>
                    </div>
                    {ends ? (
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-content-muted">{t("endsAt")}</dt>
                        <dd className="text-content">
                          <time dateTime={opportunity.endAt}>{ends}</time>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              </CardBody>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
