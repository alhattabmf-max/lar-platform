import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadReplacement } from "@/lib/trader-data";
import { formatDateTime } from "@/lib/localized";
import { formatQuantity } from "@/lib/money";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge, replacementTone } from "@/components/trader/status-badge";
import { ConfirmDeliveryButton } from "@/components/trader/confirm-delivery-button";

/**
 * One replacement obligation.
 *
 * This route is what closes the action target of a `REPLACEMENT_FAILED`
 * notification — before it existed, that notification had nowhere to
 * send anyone.
 *
 * Carrier and tracking are shown only when the API actually has them.
 * There is no carrier integration and no tracking URL to build: a link
 * guessed from a carrier code would send someone to a page that may
 * not be theirs, so the number is displayed and nothing more.
 */
export default async function TraderReplacementDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.replacements" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumbLabel")} className="text-sm">
        <Link href={`/${appLocale}/trader/replacements`} className="text-secondary hover:opacity-90">
          {t("backToList")}
        </Link>
      </nav>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <ReplacementBody locale={appLocale} id={id} />
      </Suspense>
    </div>
  );
}

async function ReplacementBody({ locale, id }: { locale: AppLocale; id: string }) {
  const t = await getTranslations({ locale, namespace: "trader.replacements" });
  const statuses = await getTranslations({ locale, namespace: "trader.status" });
  const states = await getTranslations({ locale, namespace: "states" });

  const result = await loadReplacement(id);

  // Ownership is in the API's query, so an unknown id and another
  // company's replacement answer with the same 404.
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

  const replacement = result.data;

  const timeline: { label: string; at: string }[] = [
    { label: t("createdAt"), at: replacement.createdAt },
    ...(replacement.preparationStartedAt
      ? [{ label: t("preparationStartedAt"), at: replacement.preparationStartedAt }]
      : []),
    ...(replacement.readyToShipAt
      ? [{ label: t("readyToShipAt"), at: replacement.readyToShipAt }]
      : []),
    ...(replacement.shippedAt ? [{ label: t("shippedAt"), at: replacement.shippedAt }] : []),
    ...(replacement.deliveredAt ? [{ label: t("deliveredAt"), at: replacement.deliveredAt }] : []),
    ...(replacement.failedAt ? [{ label: t("failedAt"), at: replacement.failedAt }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold text-content">
            {t("itemTitle", {
              quantity: formatQuantity(replacement.replacementQuantity, locale),
            })}
          </h1>
          <StatusBadge
            label={statuses(`replacement.${replacement.status}`)}
            tone={replacementTone(replacement.status)}
          />
        </div>
        <p className="text-sm text-content">{t(`next.${replacement.status}`)}</p>
      </header>

      <section aria-label={t("timeline")} className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-content">{t("timeline")}</h2>
        <dl className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 text-sm">
          {timeline.map((entry) => (
            <div key={entry.label} className="flex flex-wrap justify-between gap-2">
              <dt className="text-content-muted">{entry.label}</dt>
              <dd className="text-content">
                <time dateTime={entry.at}>{formatDateTime(entry.at, locale)}</time>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Both must exist. A carrier with no number is not something
          anyone can act on, and there is no tracking URL to build. */}
      {replacement.carrierCode && replacement.trackingNumber ? (
        <section aria-label={t("shipping")} className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-content">{t("shipping")}</h2>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-line bg-surface p-4 text-sm">
            <div className="flex gap-2">
              <dt className="text-content-muted">{t("carrier")}:</dt>
              <dd className="text-content">{replacement.carrierCode}</dd>
            </div>
            <div className="flex min-w-0 gap-2">
              <dt className="text-content-muted">{t("tracking")}:</dt>
              <dd className="min-w-0 break-all font-mono text-content" dir="ltr">
                {replacement.trackingNumber}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Link
          href={`/${locale}/trader/orders/${replacement.orderId}`}
          className="text-sm text-secondary hover:opacity-90"
        >
          {t("viewOrder")}
        </Link>
        <Link
          href={`/${locale}/trader/disputes/${replacement.disputeId}`}
          className="text-sm text-secondary hover:opacity-90"
        >
          {t("viewDispute")}
        </Link>
      </div>

      {/* Confirm ONLY from SHIPPED — the one state the server claims
          the transition from. */}
      {replacement.status === "SHIPPED" ? (
        <ConfirmDeliveryButton
          resource="replacement-obligations"
          id={replacement.id}
          label={t("confirmDelivery.label")}
          confirmPrompt={t("confirmDelivery.prompt")}
          confirmAction={t("confirmDelivery.confirm")}
          cancelAction={t("confirmDelivery.cancel")}
          submittingLabel={t("confirmDelivery.submitting")}
          errorTitle={states("errorTitle")}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : null}
    </div>
  );
}
