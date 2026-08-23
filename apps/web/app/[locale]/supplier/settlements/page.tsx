import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierSettlements } from "@/lib/supplier-data";
import { formatDate } from "@/lib/localized";
import { formatMoney } from "@/lib/money";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * What this supplier has been paid.
 *
 * A payout is per SHIPMENT — `orderAllocationId` is unique on the model —
 * so an order delivered to three branches settles three times.
 *
 * Nothing on this page is summed. Every amount is a decimal string
 * formatted at the edge of rendering, and a client-side total would be a
 * second source of truth that eventually disagrees with the transfers that
 * actually happened.
 *
 * `ZERO_BALANCE` is an OUTCOME, not a failure: nothing was owed for that
 * shipment. It is toned neutral, never as an error.
 */
export default async function SupplierSettlementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.settlements" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <Settlements locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function Settlements({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.settlements" });
  const status = await getTranslations({ locale, namespace: "supplier.status" });
  const states = await getTranslations({ locale, namespace: "states" });

  const settlements = await loadSupplierSettlements({ pageSize: 50 });

  if (!settlements.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={settlements.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  if (settlements.data.total === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-content-muted">{t("perShipmentNotice")}</p>

      <ul className="grid list-none gap-3 sm:grid-cols-2">
        {settlements.data.items.map((settlement) => {
          const amount = formatMoney(settlement.netAmount, settlement.currency, locale);
          const executed = formatDate(settlement.executedAt, locale);

          return (
            <li key={settlement.id}>
              <Card>
                <CardBody>
                  <div className="flex flex-col gap-2">
                    <Link
                      href={`/${locale}/supplier/settlements/${settlement.id}`}
                      className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                    >
                      {amount ?? t("openDetail")}
                    </Link>

                    <StatusBadge
                      label={status(`payoutOutcome.${settlement.outcome}`)}
                      tone={settlement.outcome === "EXECUTED" ? "done" : "neutral"}
                    />

                    <dl className="grid gap-1 text-sm">
                      {executed ? (
                        <div className="flex flex-wrap gap-2">
                          <dt className="text-content-muted">{t("executedAt")}</dt>
                          <dd className="text-content">
                            <time dateTime={settlement.executedAt}>{executed}</time>
                          </dd>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-content-muted">{t("order")}</dt>
                        <dd>
                          <Link
                            href={`/${locale}/supplier/orders/${settlement.masterOrderId}`}
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

      {settlements.data.total > settlements.data.items.length ? (
        <p className="text-sm text-content-muted">{t("showingRecent")}</p>
      ) : null}
    </div>
  );
}
