import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { SupplierAllocationDetail } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierOrder, loadSupplierOrderDocuments } from "@/lib/supplier-data";
import { allocationAction } from "@/lib/fulfilment-actions";
import { localized, formatDate, formatDateTime } from "@/lib/localized";
import { formatMoney, formatQuantity } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Fact, FactList } from "@/components/trader/account-panels";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { FulfilmentActions } from "@/components/supplier/fulfilment-actions";
import { fulfilmentLabels } from "@/components/supplier/fulfilment-labels";

/**
 * One order, its shipments, and its documents.
 *
 * ALLOCATIONS ARE INLINE. Each is only meaningful within its order, and a
 * separate route would be a second ownership boundary to get right for no
 * benefit — the API returns them on the detail for exactly that reason.
 *
 * DOCUMENTS ARE HERE AND NOWHERE ELSE. `GET /supplier/orders/:id/documents`
 * is per-order with no flat list, so a standalone documents page could only
 * be built by fanning out over the orders list — an N+1 whose page
 * boundaries would be the ORDERS'. Every item carries
 * `notice: NOT_A_TAX_INVOICE`; the contract has no PDF, QR or ZATCA field.
 *
 * No trader identity anywhere: the projection does not select one. The
 * shipping address and contact ARE here, because a courier cannot deliver
 * to a building without them.
 */
export default async function SupplierOrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.orders" });
  const status = await getTranslations({ locale: appLocale, namespace: "supplier.status" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  const result = await loadSupplierOrder(id);
  if (!result.ok && result.notFound) notFound();

  const backHref = `/${appLocale}/supplier/orders`;

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

  const order = result.data;
  const name = localized(appLocale, order.productNameAr, order.productNameEn);
  const unit = localized(appLocale, order.salesUnitNameAr, order.salesUnitNameEn);
  const labels = await fulfilmentLabels(appLocale);

  // Overdue first, then anything still waiting on the supplier.
  const ordered = [...order.allocations].sort((a, b) => {
    const weight = (allocation: SupplierAllocationDetail) =>
      allocation.isPreparationOverdue ? 0 : allocationAction(allocation.status) ? 1 : 2;
    return weight(a) - weight(b);
  });

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb href={backHref} label={t("breadcrumbLabel")} back={t("backToList")} />

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{name}</h1>
        {unit ? <p className="text-sm text-content-muted">{unit}</p> : null}
      </header>

      <Card ariaLabel={t("summaryTitle")}>
        <CardHeader>
          <CardTitle>{t("summaryTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <FactList>
            <Fact label={t("statusLabel")} value={status(`order.${order.status}`)} />
            <Fact
              label={t("payable")}
              value={formatMoney(order.supplierPayableAmount, order.currency, appLocale) ?? ""}
            />
            {/* What the platform charges THIS supplier. They are party to
                the commission; how it was derived is the platform's
                business and is not on this contract. */}
            <Fact
              label={t("commission")}
              value={formatMoney(order.commissionAmount, order.currency, appLocale) ?? ""}
            />
            <Fact
              label={t("commissionTax")}
              value={formatMoney(order.commissionTaxAmount, order.currency, appLocale) ?? ""}
            />
            <Fact
              label={t("orderTotal")}
              value={formatMoney(order.totalAmount, order.currency, appLocale) ?? ""}
            />
            <Fact
              label={t("paidAt")}
              value={
                <time dateTime={order.paidAt}>{formatDateTime(order.paidAt, appLocale)}</time>
              }
            />
          </FactList>
        </CardBody>
      </Card>

      <section aria-label={t("shipmentsTitle")} className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-content">{t("shipmentsTitle")}</h2>

        <ul className="flex list-none flex-col gap-4">
          {ordered.map((allocation) => {
            const action = allocationAction(allocation.status);

            return (
              <li key={allocation.id}>
                <Card
                  ariaLabel={allocation.locationName}
                  className={allocation.isPreparationOverdue ? "border-warning" : undefined}
                >
                  <CardHeader>
                    <CardTitle>{allocation.locationName}</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="flex flex-col gap-4">
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          label={status(`allocation.${allocation.status}`)}
                          tone={
                            allocation.isPreparationOverdue
                              ? "attention"
                              : allocation.status === "DELIVERED"
                                ? "done"
                                : "neutral"
                          }
                        />
                        {allocation.isPreparationOverdue ? (
                          <StatusBadge label={t("overdueBadge")} tone="attention" />
                        ) : null}
                        {allocation.disputeId ? (
                          <Link
                            href={`/${appLocale}/supplier/disputes/${allocation.disputeId}`}
                            className="inline-flex min-h-11 items-center text-sm text-secondary hover:opacity-90"
                          >
                            {t("openDispute")}
                          </Link>
                        ) : null}
                      </span>

                      <FactList>
                        <Fact
                          label={t("quantity")}
                          value={
                            unit
                              ? t("quantityWithUnit", {
                                  quantity: formatQuantity(allocation.quantity, appLocale),
                                  unit,
                                })
                              : formatQuantity(allocation.quantity, appLocale)
                          }
                        />
                        <Fact
                          label={t("city")}
                          value={
                            localized(
                              appLocale,
                              allocation.cityNameAr,
                              allocation.cityNameEn
                            ) ?? ""
                          }
                        />
                        {/* The courier needs the address and someone to
                            call. No coordinate is on this contract. */}
                        <Fact label={t("address")} value={allocation.address} />
                        <Fact label={t("contactName")} value={allocation.contactName} />
                        <Fact label={t("contactPhone")} value={allocation.contactPhone} />
                        <Fact
                          label={t("preparationDueAt")}
                          value={
                            <time dateTime={allocation.preparationDueAt}>
                              {formatDateTime(allocation.preparationDueAt, appLocale)}
                            </time>
                          }
                        />
                        {allocation.shippedAt ? (
                          <Fact
                            label={t("shippedAt")}
                            value={formatDate(allocation.shippedAt, appLocale) ?? ""}
                          />
                        ) : null}
                        {allocation.deliveredAt ? (
                          <Fact
                            label={t("deliveredAt")}
                            value={formatDate(allocation.deliveredAt, appLocale) ?? ""}
                          />
                        ) : null}
                        {allocation.carrierCode ? (
                          <Fact label={t("carrierCode")} value={allocation.carrierCode} />
                        ) : null}
                        {allocation.trackingNumber ? (
                          <Fact
                            label={t("trackingNumber")}
                            value={allocation.trackingNumber}
                          />
                        ) : null}
                        <Fact
                          label={t("allocationPayable")}
                          value={
                            formatMoney(
                              allocation.supplierPayableShareAmount,
                              order.currency,
                              appLocale
                            ) ?? ""
                          }
                        />
                        {allocation.payoutSettledAt ? (
                          <Fact
                            label={t("payoutSettledAt")}
                            value={formatDate(allocation.payoutSettledAt, appLocale) ?? ""}
                          />
                        ) : null}
                      </FactList>

                      {/* One action, or none. DELIVERED is the trader's to
                          confirm and has no supplier route at all. */}
                      <FulfilmentActions
                        resource="order-allocations"
                        id={allocation.id}
                        action={action}
                        labels={labels}
                      />

                      {action === null ? (
                        <p className="text-sm text-content-muted">
                          {t(`allocationNextStep.${allocation.status}`)}
                        </p>
                      ) : null}
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
        <Documents locale={appLocale} orderId={order.id} />
      </Suspense>
    </div>
  );
}

/**
 * The order's internal documents.
 *
 * Its own boundary so a documents failure costs this panel, not the order.
 */
async function Documents({ locale, orderId }: { locale: AppLocale; orderId: string }) {
  const t = await getTranslations({ locale, namespace: "supplier.orders" });
  const docs = await getTranslations({ locale, namespace: "supplier.documents" });
  const states = await getTranslations({ locale, namespace: "states" });

  const documents = await loadSupplierOrderDocuments(orderId);

  return (
    <Card ariaLabel={t("documentsTitle")}>
      <CardHeader>
        <CardTitle>{t("documentsTitle")}</CardTitle>
      </CardHeader>
      <CardBody>
        {!documents.ok ? (
          <ErrorState
            title={states("errorTitle")}
            description={states("errorDescription")}
            requestId={documents.error.requestId}
            requestIdLabel={states("requestIdLabel")}
          />
        ) : documents.data.length === 0 ? (
          <EmptyState title={t("documentsEmptyTitle")} description={t("documentsEmptyDescription")} />
        ) : (
          <ul className="flex list-none flex-col gap-4">
            {documents.data.map((document) => (
              <li key={document.id} className="flex flex-col gap-1 rounded-md border border-line p-3">
                <p className="text-sm font-medium text-content">
                  {docs(`type.${document.documentType}`)}
                </p>
                <FactList>
                  <Fact
                    label={t("documentAmount")}
                    value={formatMoney(document.amount, document.currency, locale) ?? ""}
                  />
                  <Fact
                    label={t("documentIssuedAt")}
                    value={formatDate(document.issuedAt, locale) ?? ""}
                  />
                  <Fact label={t("documentReference")} value={document.internalDocumentReference} />
                </FactList>
                {/* The legal notice, from the contract's own constant. No
                    document here is a tax invoice and none claims to be. */}
                <p className="text-xs text-warning-text">{docs(`notice.${document.notice}`)}</p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
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
