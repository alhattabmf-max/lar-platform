import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { OrderAllocationDetail, OrderDetail } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadOrderDocuments, loadTraderOrder } from "@/lib/trader-data";
import { localized, formatDate, formatDateTime } from "@/lib/localized";
import { formatQuantity } from "@/lib/money";
import { Money } from "@/components/ui/money";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge, allocationTone } from "@/components/trader/status-badge";
import { ConfirmDeliveryButton } from "@/components/trader/confirm-delivery-button";
import { OrderDocuments } from "@/components/trader/order-documents";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("trader.orders");


/**
 * One order, with its allocations INLINE.
 *
 * There is no `GET /trader/order-allocations/:id`: an allocation is
 * only meaningful within its order, and a separate route would be a
 * second ownership boundary to get right for nothing in return. They
 * arrive on this response, already ordered by the API.
 *
 * WHAT IS NOT HERE. The same row carries the platform's commission,
 * the supplier's payable amount, their bank account and the ledger
 * postings. None of it is in `OrderDetail`, so none of it can be
 * rendered here — the boundary is enforced by the projection, not by
 * this page remembering to omit things.
 *
 * Ownership is in the API's query, so an unknown id and another
 * company's order answer with the same 404. This page preserves that
 * by rendering the same Next 404 for both.
 */
export default async function TraderOrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.orders" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      {/* Rendered before the fetch resolves, so the way back exists
          even while the order is still loading. */}
      <nav aria-label={t("breadcrumbLabel")} className="text-sm">
        <Link href={`/${appLocale}/trader/orders`} className="text-secondary hover:opacity-[var(--state-hover-opacity)]">
          {t("backToOrders")}
        </Link>
      </nav>

      <Suspense fallback={<LoadingState label={common("loading")} rows={5} />}>
        <OrderBody locale={appLocale} id={id} />
      </Suspense>
    </div>
  );
}

async function OrderBody({ locale, id }: { locale: AppLocale; id: string }) {
  const t = await getTranslations({ locale, namespace: "trader.orders" });
  const statuses = await getTranslations({ locale, namespace: "trader.status" });
  const states = await getTranslations({ locale, namespace: "states" });

  const result = await loadTraderOrder(id);

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

  const order = result.data;
  const name = localized(locale, order.productNameAr, order.productNameEn);
  const unit = localized(locale, order.salesUnitNameAr, order.salesUnitNameEn);
  const paid = formatDate(order.paidAt, locale);

  // What needs chasing comes first. An overdue preparation is the only
  // thing on this page a trader may have to act on that is not their
  // own decision.
  const overdue = order.allocations.filter((a) => a.isPreparationOverdue);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold text-content">{name}</h1>
          <StatusBadge
            label={statuses(`order.${order.status}`)}
            tone={order.status === "FULFILLED" ? "done" : "neutral"}
          />
        </div>

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-content-muted">{t("total")}:</dt>
            <dd className="font-semibold text-content">
              <Money
                amount={order.totalAmount}
                currency={order.currency}
                locale={locale}
                fallback={
                  <span className="font-normal text-content-muted">
                    {t("amountUnavailable")}
                  </span>
                }
              />
            </dd>
          </div>
          {paid ? (
            <div className="flex gap-2">
              <dt className="text-content-muted">{t("paidAt")}:</dt>
              <dd className="text-content">
                <time dateTime={order.paidAt}>{paid}</time>
              </dd>
            </div>
          ) : null}
          <div className="flex gap-2">
            <dt className="text-content-muted">{t("progress")}:</dt>
            <dd className="text-content">
              {t("deliveredOf", {
                delivered: formatQuantity(order.deliveredAllocationCount, locale),
                total: formatQuantity(order.allocationCount, locale),
              })}
            </dd>
          </div>
        </dl>
      </header>

      {overdue.length > 0 ? (
        <p
          role="status"
          className="rounded-lg border border-warning bg-warning-surface p-3 text-sm font-medium text-warning-text"
        >
          {t("overdueCount", { count: overdue.length })}
        </p>
      ) : null}

      <AllocationList order={order} locale={locale} unit={unit} />

      {/* Documents are a separate read, so a failure there costs the
          documents and not the order. */}
      <Suspense fallback={<LoadingState label={states("loadingDocuments")} rows={2} />}>
        <DocumentsRegion orderId={order.id} locale={locale} />
      </Suspense>
    </div>
  );
}

async function AllocationList({
  order,
  locale,
  unit,
}: {
  order: OrderDetail;
  locale: AppLocale;
  unit: string | null;
}) {
  const t = await getTranslations({ locale, namespace: "trader.orders" });

  // Deterministic: overdue first, then by preparation deadline, then by
  // id. Without the final key two allocations sharing a deadline could
  // swap places between renders, and a list that reorders itself is one
  // a reader stops trusting.
  const allocations = [...order.allocations].sort((a, b) => {
    if (a.isPreparationOverdue !== b.isPreparationOverdue) return a.isPreparationOverdue ? -1 : 1;
    // A SHARE WITH NO DATE SORTS LAST, not first. Null is not "the
    // earliest deadline" — it is "no deadline yet", and putting it at the
    // head would push the work that IS owed below the work that is not.
    if (a.preparationDueAt !== b.preparationDueAt) {
      if (a.preparationDueAt === null) return 1;
      if (b.preparationDueAt === null) return -1;
      return a.preparationDueAt < b.preparationDueAt ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return (
    <section aria-label={t("allocations")} className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-content">{t("allocations")}</h2>

      <ul className="flex list-none flex-col gap-3">
        {allocations.map((allocation) => (
          <li key={allocation.id}>
            <AllocationCard allocation={allocation} order={order} locale={locale} unit={unit} />
          </li>
        ))}
      </ul>
    </section>
  );
}

async function AllocationCard({
  allocation,
  order,
  locale,
  unit,
}: {
  allocation: OrderAllocationDetail;
  order: OrderDetail;
  locale: AppLocale;
  unit: string | null;
}) {
  const t = await getTranslations({ locale, namespace: "trader.orders" });
  const statuses = await getTranslations({ locale, namespace: "trader.status" });
  const states = await getTranslations({ locale, namespace: "states" });

  // THE REGION, NARROWED BY THE CITY WHEN THERE IS ONE. A branch may
  // name no city, and this line used to read «المدينة:  · address» when
  // it did not — a label and a separator with nothing between them.
  const place = [
    localized(locale, allocation.regionNameAr, allocation.regionNameEn),
    localized(locale, allocation.cityNameAr, allocation.cityNameEn),
  ]
    .filter(Boolean)
    .join(" — ");
  // ABSENT WHILE THE OFFER IS STILL GATHERING ITS TARGET — the row
  // below is drawn only when there is a date, because "due: —" tells a
  // buyer nothing and a missing line tells the truth: nothing is owed
  // yet. The share's own status says why.
  const due = allocation.preparationDueAt
    ? formatDateTime(allocation.preparationDueAt, locale)
    : null;
  const shipped = allocation.shippedAt ? formatDateTime(allocation.shippedAt, locale) : null;
  const delivered = allocation.deliveredAt ? formatDateTime(allocation.deliveredAt, locale) : null;
  const disputeCloses = allocation.disputeWindowClosesAt
    ? formatDateTime(allocation.disputeWindowClosesAt, locale)
    : null;

  // Every state says what happens next, so a status is never just a
  // label someone has to interpret.
  const nextStep = allocation.isPreparationOverdue
    ? t("next.overdue")
    : t(`next.${allocation.status}`);

  return (
    <article
      className={`flex flex-col gap-3 rounded-lg border p-4 ${
        allocation.isPreparationOverdue
          ? "border-warning bg-warning-surface"
          : "border-line bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-content">
          {allocation.locationName}
        </h3>
        <StatusBadge
          label={statuses(`allocation.${allocation.status}`)}
          tone={allocationTone(allocation.status, allocation.isPreparationOverdue)}
        />
      </div>

      <p className="text-sm text-content-muted">
        {/* The trader's OWN address, captured at checkout. DELIVERY
            city — not the supplier's shipping origin. */}
        {t("deliveryRegion")}: {place} · {allocation.address}
      </p>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-content-muted">{t("quantity")}:</dt>
          <dd className="text-content">
            {formatQuantity(allocation.quantity, locale)}
            {unit ? ` ${unit}` : ""}
          </dd>
        </div>
        {due ? (
          <div className="flex gap-2">
            <dt className="text-content-muted">{t("preparationDue")}:</dt>
            <dd className="text-content">
              <time dateTime={allocation.preparationDueAt ?? undefined}>{due}</time>
            </dd>
          </div>
        ) : null}
        {shipped ? (
          <div className="flex gap-2">
            <dt className="text-content-muted">{t("shippedAt")}:</dt>
            <dd className="text-content">
              <time dateTime={allocation.shippedAt!}>{shipped}</time>
            </dd>
          </div>
        ) : null}
        {delivered ? (
          <div className="flex gap-2">
            <dt className="text-content-muted">{t("deliveredAt")}:</dt>
            <dd className="text-content">
              <time dateTime={allocation.deliveredAt!}>{delivered}</time>
            </dd>
          </div>
        ) : null}
      </dl>

      {/* Carrier and tracking are the trader's means of following their
          OWN shipment — not counterparty data. Null until shipped, and
          shown only when both exist: a carrier with no number is not
          something anyone can act on. */}
      {allocation.carrierCode && allocation.trackingNumber ? (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-content-muted">{t("carrier")}:</dt>
            <dd className="text-content">{allocation.carrierCode}</dd>
          </div>
          <div className="flex min-w-0 gap-2">
            <dt className="text-content-muted">{t("tracking")}:</dt>
            {/* No link. There is no carrier tracking integration, and a
                URL guessed from a code would send someone to a page
                that may not be theirs. */}
            <dd className="min-w-0 break-all font-mono text-content" dir="ltr">
              {allocation.trackingNumber}
            </dd>
          </div>
        </dl>
      ) : null}

      <p className="text-sm text-content">{nextStep}</p>

      {/* Confirm delivery ONLY from SHIPPED — the one state the server
          claims the transition from. Rendering it elsewhere would offer
          an action that answers 409. */}
      {allocation.status === "SHIPPED" ? (
        <ConfirmDeliveryButton
          resource="order-allocations"
          id={allocation.id}
          label={t("confirmDelivery.label")}
          confirmPrompt={t("confirmDelivery.prompt")}
          confirmAction={t("confirmDelivery.confirm")}
          cancelAction={t("confirmDelivery.cancel")}
          submittingLabel={t("confirmDelivery.submitting")}
          errorTitle={states("errorTitle")}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : null}

      {/* The dispute route, offered only while the window is genuinely
          open. `disputeWindowClosesAt` is null until delivered. */}
      {allocation.disputeId ? (
        <Link
          href={`/${locale}/trader/disputes/${allocation.disputeId}`}
          className="self-start text-sm text-secondary hover:opacity-[var(--state-hover-opacity)]"
        >
          {t("viewDispute")}
        </Link>
      ) : allocation.status === "DELIVERED" && disputeCloses ? (
        <div className="flex flex-col gap-1">
          <Link
            href={`/${locale}/trader/orders/${order.id}/allocations/${allocation.id}/dispute`}
            className="self-start text-sm text-secondary hover:opacity-[var(--state-hover-opacity)]"
          >
            {t("openDispute")}
          </Link>
          <p className="text-sm text-content-muted">
            {t("disputeWindowCloses", { at: disputeCloses })}
          </p>
        </div>
      ) : null}
    </article>
  );
}

async function DocumentsRegion({ orderId, locale }: { orderId: string; locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "trader.documents" });
  const states = await getTranslations({ locale, namespace: "states" });

  const result = await loadOrderDocuments(orderId);

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

  return (
    <OrderDocuments
      documents={result.data}
      locale={locale}
      labels={{
        title: t("title"),
        description: t("description"),
        emptyTitle: t("emptyTitle"),
        emptyDescription: t("emptyDescription"),
        amount: t("amount"),
        issuedAt: t("issuedAt"),
        reference: t("reference"),
        notTaxInvoice: t("notTaxInvoice"),
        amountUnavailable: t("amountUnavailable"),
        typeLabel: (documentType) => t(`type.${documentType}`),
      }}
    />
  );
}
