import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminOrder, loadOrderInvoiceDrafts } from "@/lib/admin-data";
import { formatDate, formatDateTime } from "@/lib/localized";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ErrorState } from "@/components/ui/states";
import { StatusBadge, allocationTone } from "@/components/trader/status-badge";
import { AdminAction } from "@/components/admin/admin-action";
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
                {formatMoney(order.totalAmount, currency, appLocale) ?? "—"}
              </dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("supplierPayable")}</dt>
              <dd className="text-content">
                {formatMoney(order.supplierPayableAmount, currency, appLocale) ?? "—"}
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
              <div className="overflow-x-auto">
                <Table caption={t("invoicesCaption")}>
                  <THead>
                    <TR>
                      <TH>{t("documentType")}</TH>
                      <TH>{t("documentReference")}</TH>
                      <TH>{t("amount")}</TH>
                      <TH>{t("issuedAt")}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {invoices.data.map((document) => (
                      <TR key={document.id}>
                        <TD>{vocab(`invoiceDocumentType.${document.documentType}`)}</TD>
                        <TD className="break-all font-mono text-xs">
                          {document.internalDocumentReference}
                        </TD>
                        <TD>
                          {formatMoney(document.amount, document.currency, appLocale) ?? "—"}
                        </TD>
                        <TD>
                          <time dateTime={document.issuedAt}>
                            {formatDate(document.issuedAt, appLocale)}
                          </time>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
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
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
