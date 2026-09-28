import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminOrder, loadOrderInvoiceDrafts } from "@/lib/admin-data";
import { formatDate, formatDateTime } from "@/lib/localized";
import { Money } from "@/components/ui/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { StatusBadge, allocationTone } from "@/components/trader/status-badge";
import { AdminAction } from "@/components/admin/admin-action";
import { InvoiceDraftsPanel } from "@/components/admin/invoice-drafts-panel";
import { SettleAllocationForm } from "@/components/admin/order-allocation-actions";

/**
 * One order: its money, its shipments, and its invoice documents.
 *
 * THE ACTIONS ARE PER SHIPMENT, not per order, because that is how the
 * data works: an order delivered to three branches has three
 * allocations, each of which is delivered and settled separately.
 *
 * Confirm-delivery is an OVERRIDE — normally the trader confirms — so it
 * requires a written reason, which is the record of why the platform
 * acted on someone else's order.
 *
 * Settlement is offered only on a DELIVERED shipment, transcribed from
 * the payout service's own guard. Whether it has already been settled is
 * not on this contract, so the button remains and the server's refusal
 * is what the operator sees on a second press — better than hiding a
 * control that may well be the right one.
 */

/**
 * The tab's name. The layout supplies « | لوحة التحكم ».
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as AppLocale,
    namespace: "admin.orders",
  });
  return { title: t("detailTitle") };
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.orders" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const actions = await getTranslations({ locale: appLocale, namespace: "admin.actions" });
  const money = await getTranslations({ locale: appLocale, namespace: "admin.money" });

  const [result, invoices] = await Promise.all([
    loadAdminOrder(id),
    loadOrderInvoiceDrafts(id),
  ]);

  if (!result.ok) {
    if (result.error.kind === "notFound") notFound();
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={result.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  const order = result.data;
  const currency = money("platformCurrency");

  const actionLabels = {
    confirm: actions("confirm"),
    cancel: actions("cancel"),
    working: actions("working"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
  };

  const adjustmentLabels = {
    open: t("adjustmentOpen"),
    legend: t("adjustmentLegend"),
    amount: t("adjustmentAmount"),
    currencySuffix: currency,
    sourceDescription: t("adjustmentDescription"),
    sourceReferenceId: t("adjustmentReference"),
    sourceReferenceOptional: t("adjustmentReferenceOptional"),
    submit: t("adjustmentSubmit"),
    cancel: actions("cancel"),
    working: actions("working"),
    saved: t("adjustmentSaved"),
    required: actions("required"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
    errorAmount: t("adjustmentErrorAmount"),
    errorDescription: t("adjustmentErrorDescription"),
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-content">{t("detailTitle")}</h1>
        <StatusBadge
          label={vocab(`orderStatus.${order.status}`)}
          tone={order.status === "FULFILLED" ? "done" : "neutral"}
        />
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("summaryTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("trader")}</dt>
              <dd className="text-content">{order.traderCompanyLegalName || "—"}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("supplier")}</dt>
              <dd className="text-content">{order.supplierCompanyLegalName}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("totalAmount")}</dt>
              <dd className="text-content">
                <Money amount={order.totalAmount} currency={currency} locale={appLocale} fallback={<span className="text-content-muted">—</span>} />
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("supplierPayable")}</dt>
              <dd className="text-content">
                <Money amount={order.supplierPayableAmount} currency={currency} locale={appLocale} fallback={<span className="text-content-muted">—</span>} />
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("paidAt")}</dt>
              <dd className="text-content">
                <time dateTime={order.paidAt}>{formatDateTime(order.paidAt, appLocale)}</time>
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("shipmentsTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="flex list-none flex-col gap-4">
            {order.allocations.map((allocation) => {
              const overdue =
                allocation.preparationDueAt !== null &&
                allocation.status !== "DELIVERED" &&
                new Date(allocation.preparationDueAt).getTime() < Date.now();

              return (
                <li
                  key={allocation.id}
                  className="flex flex-col gap-3 border-b border-line pb-4 last:border-b-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={vocab(`allocationStatus.${allocation.status}`)}
                      tone={allocationTone(allocation.status, overdue)}
                    />
                    {allocation.preparationDueAt ? (
                      <span className="text-sm text-content-muted">
                        {t("preparationDue")}:{" "}
                        <time dateTime={allocation.preparationDueAt}>
                          {formatDate(allocation.preparationDueAt, appLocale)}
                        </time>
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {/* Confirming for the trader is an override, so the
                        reason is mandatory and bounded exactly as the
                        endpoint requires. */}
                    {allocation.status !== "DELIVERED" ? (
                      <AdminAction
                        path={`/admin/order-allocations/${allocation.id}/confirm-delivery`}
                        variant="secondary"
                        reason={{
                          field: "reasonNote",
                          label: t("confirmDeliveryReason"),
                          minLength: 5,
                          maxLength: 2000,
                          hint: t("confirmDeliveryHint"),
                        }}
                        labels={{
                          ...actionLabels,
                          action: t("confirmDelivery"),
                          prompt: t("confirmDeliveryPrompt"),
                        }}
                      />
                    ) : (
                      <SettleAllocationForm
                        allocationId={allocation.id}
                        labels={{
                          action: t("settle"),
                          prompt: t("settlePrompt"),
                          reference: t("transferReference"),
                          referenceHint: t("transferReferenceHint"),
                          confirm: actions("confirm"),
                          cancel: actions("cancel"),
                          working: actions("working"),
                          errorTitle: states("errorTitle"),
                          requestIdLabel: states("requestIdLabel"),
                        }}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("invoicesTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-4">
            {!invoices.ok ? (
              <ErrorState
                title={states("errorTitle")}
                description={states("errorDescription")}
                requestId={invoices.error.requestId}
                requestIdLabel={states("requestIdLabel")}
              />
            ) : invoices.data.length === 0 ? (
              <p className="text-sm text-content-muted">{t("noInvoices")}</p>
            ) : (
              // THE TABLE AND THE CORRECTION PATH IT NEVER HAD. The
              // adjustment form is NOT a sixth column: a table cell is
              // sized by the table's layout, and a three-field form put
              // in one rendered eighty-one pixels wide. The row carries
              // a button; the form opens under the table.
              <InvoiceDraftsPanel
                rows={invoices.data.map((document) => ({
                  id: document.id,
                  documentType: vocab(`invoiceDocumentType.${document.documentType}`),
                  internalDocumentReference: document.internalDocumentReference,
                  amount:
                    (
                      <Money
                        amount={document.amount}
                        currency={document.currency}
                        locale={appLocale}
                        fallback={<span className="text-content-muted">—</span>}
                      />
                    ),
                  issuedAt: document.issuedAt,
                  issuedAtLabel: formatDate(document.issuedAt, appLocale) ?? "—",
                }))}
                labels={{
                  caption: t("invoicesCaption"),
                  documentType: t("documentType"),
                  documentReference: t("documentReference"),
                  amount: t("amount"),
                  issuedAt: t("issuedAt"),
                  adjustmentColumn: t("adjustmentColumn"),
                  adjustmentOpen: t("adjustmentOpen"),
                }}
                adjustmentLabels={adjustmentLabels}
              />
            )}

            <div className="flex flex-wrap gap-2">
              {/* Both drafts are idempotent endpoints — the API rejects
                  them without an Idempotency-Key — and the service
                  refuses a second draft of the same kind for the same
                  order, so pressing twice cannot double-issue. */}
              <AdminAction
                path={`/admin/orders/${order.id}/invoice-drafts/product`}
                idempotent
                variant="secondary"
                labels={{
                  ...actionLabels,
                  action: t("createProductDraft"),
                  prompt: t("createProductDraftPrompt"),
                }}
              />
              <AdminAction
                path={`/admin/orders/${order.id}/invoice-drafts/commission`}
                idempotent
                variant="secondary"
                labels={{
                  ...actionLabels,
                  action: t("createCommissionDraft"),
                  prompt: t("createCommissionDraftPrompt"),
                }}
              />
              {/* THE BILLING IDENTITY ON THIS ORDER, refreshed from the
                  buyer's current tax profile.
                  `POST /admin/orders/:id/buyer-billing-override` has
                  existed with no screen able to call it — so an order
                  captured against a stale or wrong profile could not be
                  corrected at all.

                  The body carries ONLY the reason. An administrator
                  cannot type a VAT number or a legal name: the override
                  copies the trader's own `TraderTaxProfile` verbatim,
                  which is what keeps this a correction rather than an
                  invention. */}
              <AdminAction
                path={`/admin/orders/${order.id}/buyer-billing-override`}
                variant="secondary"
                reason={{
                  field: "reasonNote",
                  label: t("billingOverrideReason"),
                  // ADMIN_REASON_MIN / MAX on the API.
                  minLength: 5,
                  maxLength: 2000,
                  hint: t("billingOverrideHint"),
                }}
                labels={{
                  ...actionLabels,
                  action: t("billingOverride"),
                  prompt: t("billingOverridePrompt"),
                }}
              />
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
