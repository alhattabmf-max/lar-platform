import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierSettlement } from "@/lib/supplier-data";
import { localized, formatDate } from "@/lib/localized";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Fact, FactList, StatusWithAction } from "@/components/trader/account-panels";
import { ErrorState } from "@/components/ui/states";

/**
 * One payout, and the FROZEN basis it was calculated from.
 *
 * Every figure comes from `OrderAllocationFinancialSnapshot`, written when
 * the order was created and never recomputed — which is what makes it
 * reconcilable. The supplier reads the same numbers the transfer was
 * derived from, not a fresh calculation that could differ by a rounding
 * decision.
 *
 * ABSENT BY CONSTRUCTION, not by filtering here: `externalTransferReference`,
 * `executedByAdminUserId` and `supplierBankAccountId` describe the
 * platform's banking operation and are not selected by the query at all.
 * There is no ledger posting and no journal entry either — those are the
 * platform's double-entry record; a supplier reconciling a payment needs
 * the amount and its basis, not the bookkeeping.
 *
 * The rounding remainders and `allocationShareBasisPoints` are absent too:
 * they exist so per-shipment shares sum exactly to the order total, and
 * showing someone a "rounding remainder" line invites a question with no
 * useful answer.
 *
 * NOTHING IS SUMMED HERE. The figures are shown as the server sent them.
 */
export default async function SupplierSettlementDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.settlements" });
  const status = await getTranslations({ locale: appLocale, namespace: "supplier.status" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const result = await loadSupplierSettlement(id);
  if (!result.ok && result.notFound) notFound();

  const backHref = `/${appLocale}/supplier/settlements`;

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb href={backHref} label={t("breadcrumbLabel")} back={t("backToList")} />
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      </div>
    );
  }

  const settlement = result.data;
  const money = (amount: string) => formatMoney(amount, settlement.currency, appLocale) ?? "";

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb href={backHref} label={t("breadcrumbLabel")} back={t("backToList")} />

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{money(settlement.netAmount)}</h1>
        <p className="text-sm text-content-muted">{settlement.locationName}</p>
      </header>

      <Card ariaLabel={t("outcomeTitle")}>
        <CardHeader>
          <CardTitle>{t("outcomeTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <StatusWithAction
            label={t("statusLabel")}
            status={status(`payoutOutcome.${settlement.outcome}`)}
            // ZERO_BALANCE is not a failure — nothing was owed for this
            // shipment — so its next step says so rather than implying a
            // payment went wrong.
            action={t(`outcomeNextStep.${settlement.outcome}`)}
            tone={settlement.outcome === "EXECUTED" ? "success" : "neutral"}
          />
          <div className="mt-4">
            <FactList>
              <Fact
                label={t("executedAt")}
                value={
                  <time dateTime={settlement.executedAt}>
                    {formatDate(settlement.executedAt, appLocale)}
                  </time>
                }
              />
              <Fact
                label={t("city")}
                value={
                  localized(appLocale, settlement.cityNameAr, settlement.cityNameEn) ?? ""
                }
              />
            </FactList>
          </div>
        </CardBody>
      </Card>

      <Card ariaLabel={t("basisTitle")}>
        <CardHeader>
          <CardTitle>{t("basisTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-content-muted">{t("basisNotice")}</p>
          <FactList>
            <Fact
              label={t("productAmountExclTax")}
              value={money(settlement.productAmountExclTax)}
            />
            <Fact label={t("productTaxAmount")} value={money(settlement.productTaxAmount)} />
            <Fact
              label={t("productAmountInclTax")}
              value={money(settlement.productAmountInclTax)}
            />
            <Fact label={t("shippingFeeAmount")} value={money(settlement.shippingFeeAmount)} />
            {/* What the platform charged for this shipment, and the VAT on
                it. The rate and its basis are the platform's internal
                pricing and are not on this contract. */}
            <Fact
              label={t("commissionShareAmount")}
              value={money(settlement.commissionShareAmount)}
            />
            <Fact
              label={t("commissionShareTaxAmount")}
              value={money(settlement.commissionShareTaxAmount)}
            />
            <Fact
              label={t("supplierPayableShareAmount")}
              value={money(settlement.supplierPayableShareAmount)}
            />
            <Fact label={t("netAmount")} value={money(settlement.netAmount)} />
          </FactList>
        </CardBody>
      </Card>

      <section className="flex flex-wrap gap-3">
        <Link
          href={`/${appLocale}/supplier/orders/${settlement.masterOrderId}`}
          className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
        >
          {/* The order's documents live there, including the internal
              commission draft. There is no standalone documents page. */}
          {t("openOrder")}
        </Link>
      </section>
    </div>
  );
}

function Breadcrumb({ href, label, back }: { href: string; label: string; back: string }) {
  return (
    <nav aria-label={label} className="text-sm">
      <Link href={href} className="inline-flex min-h-11 items-center text-secondary hover:opacity-90">
        {back}
      </Link>
    </nav>
  );
}
