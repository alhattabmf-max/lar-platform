import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SupplierDisputeSummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierDisputes } from "@/lib/supplier-data";
import { formatDateTime } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge, disputeTone } from "@/components/trader/status-badge";

/**
 * Disputes raised against this supplier.
 *
 * `awaitingSupplierResponse` is derived server-side from the status, so
 * "does this need me?" is one field rather than a rule this page has to
 * re-derive — and re-derive identically to the API.
 *
 * Until 8E there was no list at all: a dispute could only be reached from
 * the notification that announced it, so one missed notification meant a
 * dispute nobody saw and a response deadline nobody met.
 */
export default async function SupplierDisputesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.disputes" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <Disputes locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function Disputes({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.disputes" });
  const states = await getTranslations({ locale, namespace: "states" });

  const disputes = await loadSupplierDisputes({ pageSize: 50 });

  if (!disputes.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={disputes.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  if (disputes.data.total === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  const awaiting = disputes.data.items.filter((dispute) => dispute.awaitingSupplierResponse);
  const rest = disputes.data.items.filter((dispute) => !dispute.awaitingSupplierResponse);

  return (
    <div className="flex flex-col gap-6">
      {awaiting.length > 0 ? (
        <Card ariaLabel={t("awaiting.title")} className="border-warning">
          <CardHeader>
            <CardTitle>{t("awaiting.title")}</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-sm text-content-muted">{t("awaiting.description")}</p>
            <DisputeList locale={locale} disputes={awaiting} />
          </CardBody>
        </Card>
      ) : null}

      <section aria-label={t("allTitle")} className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-content">{t("allTitle")}</h2>
        {rest.length === 0 ? (
          <p className="text-sm text-content-muted">{t("allHandled")}</p>
        ) : (
          <DisputeList locale={locale} disputes={rest} />
        )}
      </section>

      {disputes.data.total > disputes.data.items.length ? (
        <p className="text-sm text-content-muted">{t("showingRecent")}</p>
      ) : null}
    </div>
  );
}

async function DisputeList({
  locale,
  disputes,
}: {
  locale: AppLocale;
  disputes: readonly SupplierDisputeSummary[];
}) {
  const t = await getTranslations({ locale, namespace: "supplier.disputes" });
  const status = await getTranslations({ locale, namespace: "supplier.status" });

  return (
    <ul className="grid list-none gap-3 sm:grid-cols-2">
      {disputes.map((dispute) => {
        const due = formatDateTime(dispute.supplierResponseDueAt, locale);

        return (
          <li key={dispute.id}>
            <Card>
              <CardBody>
                <div className="flex flex-col gap-2">
                  <Link
                    href={`/${locale}/supplier/disputes/${dispute.id}`}
                    className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                  >
                    {status(`disputeReason.${dispute.reasonCode}`)}
                  </Link>

                  {/* The EXACT outcome, never a collapsed "resolved":
                      four different results live under RESOLVED_*. */}
                  <StatusBadge
                    label={status(`dispute.${dispute.status}`)}
                    tone={disputeTone(dispute.status)}
                  />

                  <dl className="grid gap-1 text-sm">
                    {due ? (
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-content-muted">{t("responseDueAt")}</dt>
                        <dd className="text-content">
                          <time dateTime={dispute.supplierResponseDueAt}>{due}</time>
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-content-muted">{t("order")}</dt>
                      <dd>
                        <Link
                          href={`/${locale}/supplier/orders/${dispute.orderId}`}
                          className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                        >
                          {t("openOrder")}
                        </Link>
                      </dd>
                    </div>
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
