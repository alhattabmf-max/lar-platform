import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { loadOpportunityDetail } from "@/lib/marketplace-data";
import { localized, formatDateTime, daysUntil } from "@/lib/localized";
import { loginPath } from "@/lib/auth-redirects";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { OpportunityImage } from "@/components/opportunities/opportunity-image";
import { TraderTermsNotice } from "@/components/opportunities/trader-terms-notice";

/**
 * A single opportunity, for anyone — signed in or not.
 *
 * What is NOT on this page is as deliberate as what is: no price, no
 * quantity, no share size, no purchase step, no preparation time. The
 * public contract does not carry them, so they cannot be rendered here
 * even by mistake; the notice explains the absence and points to sign-in
 * rather than leaving a visitor to assume the listing is broken.
 *
 * A 404 from the API covers unknown ids, opportunities that are not
 * publicly visible, and ones that no longer are — one indistinguishable
 * answer, so that probing ids cannot confirm anything exists. This page
 * preserves that by rendering the same Next 404 for all of them.
 */
export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;

  const t = await getTranslations({ locale: appLocale, namespace: "marketplace" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      {/* Rendered before the fetch resolves, so the way back is
          available even while the opportunity is still loading. */}
      <nav aria-label={t("detail.breadcrumbLabel")} className="text-sm">
        <Link href={`/${appLocale}/opportunities`} className="text-secondary hover:opacity-90">
          {t("detail.backToList")}
        </Link>
      </nav>

      <Suspense fallback={<LoadingState label={common("loading")} rows={5} />}>
        <DetailBody locale={appLocale} id={id} />
      </Suspense>
    </div>
  );
}

async function DetailBody({ locale, id }: { locale: AppLocale; id: string }) {
  const appLocale = locale;
  const t = await getTranslations({ locale: appLocale, namespace: "marketplace" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const result = await loadOpportunityDetail(id);

  if (!result.ok && result.notFound) notFound();

  if (!result.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={result.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  const opportunity = result.data;
  const name = localized(appLocale, opportunity.productNameAr, opportunity.productNameEn);
  const description = localized(
    appLocale,
    opportunity.productDescriptionAr,
    opportunity.productDescriptionEn
  );
  const city = localized(
    appLocale,
    opportunity.fulfillmentCityNameAr,
    opportunity.fulfillmentCityNameEn
  );
  const region = localized(
    appLocale,
    opportunity.fulfillmentRegionNameAr,
    opportunity.fulfillmentRegionNameEn
  );
  const unit = localized(appLocale, opportunity.salesUnitNameAr, opportunity.salesUnitNameEn);

  const opens = formatDateTime(opportunity.startAt, appLocale);
  const closes = formatDateTime(opportunity.endAt, appLocale);
  const days = daysUntil(opportunity.endAt);

  const returnTo = `/${appLocale}/opportunities/${opportunity.id}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <OpportunityImage
          src={opportunity.imageUrl}
          productName={name}
          noImageLabel={t("card.noImage")}
          className="h-64 lg:h-80"
          priority
        />

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-3">
            <h1 className="flex-1 text-2xl font-semibold text-content">{name}</h1>
            {opportunity.status === "SCHEDULED" ? (
              <span className="rounded-md bg-warning-surface px-2 py-1 text-xs font-medium text-warning-text">
                {t("card.scheduled")}
              </span>
            ) : null}
          </div>

          {description ? (
            // Plain text from the frozen approval snapshot, rendered as
            // a text node. Never dangerouslySetInnerHTML — a repo-wide
            // test forbids it in this app entirely.
            <p className="whitespace-pre-wrap text-sm text-content">{description}</p>
          ) : (
            <p className="text-sm text-content-muted">{t("detail.noDescription")}</p>
          )}

          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label={t("card.city")} value={city} />
            {region ? <Fact label={t("detail.region")} value={region} /> : null}
            {unit ? <Fact label={t("card.unit")} value={unit} /> : null}
            {opens ? (
              <Fact
                label={t("detail.opens")}
                value={<time dateTime={opportunity.startAt}>{opens}</time>}
              />
            ) : null}
            {closes ? (
              <Fact
                label={t("card.closes")}
                value={<time dateTime={opportunity.endAt}>{closes}</time>}
              />
            ) : null}
          </dl>

          <p className="text-sm text-content-muted">
            {days === null ? t("detail.closed") : t("card.closesInDays", { days })}
          </p>
        </div>
      </div>

      <TraderTermsNotice
        title={t("traderTerms.title")}
        description={t("traderTerms.description")}
        signInLabel={t("traderTerms.signIn")}
        registerLabel={t("traderTerms.register")}
        signInHref={loginPath(appLocale, returnTo)}
        registerHref={`/${appLocale}/register`}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-content-muted">{label}</dt>
      <dd className="text-sm text-content">{value}</dd>
    </div>
  );
}
