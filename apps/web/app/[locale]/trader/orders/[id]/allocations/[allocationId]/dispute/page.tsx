import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadTraderOrder } from "@/lib/trader-data";
import { formatDateTime } from "@/lib/localized";
import { ErrorState } from "@/components/ui/states";
import { OpenDisputeForm } from "@/components/trader/open-dispute-form";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("trader.disputes.open");


/**
 * Opening a dispute on one delivered allocation.
 *
 * ELIGIBILITY IS CHECKED HERE, ON THE SERVER, from the order the API
 * returned — not guessed in the browser. Three conditions must hold,
 * and each has its own explanation rather than a shared "you cannot do
 * this":
 *
 *   the allocation is DELIVERED   nothing can be disputed before it
 *                                 arrives;
 *   the window is still open      `disputeWindowClosesAt` is set when
 *                                 delivery is confirmed and the server
 *                                 refuses a dispute after it;
 *   no dispute exists yet         one allocation carries at most one.
 *
 * The server enforces all three regardless. Checking here means someone
 * who follows a stale link reads why, instead of filling in a form that
 * is refused on submit.
 *
 * Nested under the order because that is the ownership path: the
 * allocation is read from the order's own response, which the API has
 * already scoped to this company.
 */
export default async function OpenDisputePage({
  params,
}: {
  params: Promise<{ locale: string; id: string; allocationId: string }>;
}) {
  const { locale, id, allocationId } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.disputes.open" });
  const orders = await getTranslations({ locale: appLocale, namespace: "trader.orders" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

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

  const allocation = result.data.allocations.find((a) => a.id === allocationId);

  // An allocation id that is not on this order is indistinguishable
  // from one that does not exist — the same 404 either way.
  if (!allocation) notFound();

  const orderHref = `/${appLocale}/trader/orders/${id}`;
  const windowCloses = allocation.disputeWindowClosesAt
    ? formatDateTime(allocation.disputeWindowClosesAt, appLocale)
    : null;
  const windowOpen =
    allocation.disputeWindowClosesAt !== null &&
    new Date(allocation.disputeWindowClosesAt).getTime() > Date.now();

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={orders("breadcrumbLabel")} className="text-sm">
        <Link href={orderHref} className="text-secondary hover:opacity-[var(--state-hover-opacity)]">
          {t("backToOrder")}
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">
          {allocation.locationName} · {t("subtitle")}
        </p>
      </header>

      {allocation.disputeId ? (
        <Ineligible
          title={t("already.title")}
          description={t("already.description")}
          actionLabel={t("already.action")}
          actionHref={`/${appLocale}/trader/disputes/${allocation.disputeId}`}
        />
      ) : allocation.status !== "DELIVERED" ? (
        <Ineligible
          title={t("notDelivered.title")}
          description={t("notDelivered.description")}
          actionLabel={t("backToOrder")}
          actionHref={orderHref}
        />
      ) : !windowOpen ? (
        <Ineligible
          title={t("windowClosed.title")}
          description={t("windowClosed.description")}
          actionLabel={t("backToOrder")}
          actionHref={orderHref}
        />
      ) : (
        <>
          {windowCloses ? (
            <p className="text-sm text-content-muted">
              {orders("disputeWindowCloses", { at: windowCloses })}
            </p>
          ) : null}
          <OpenDisputeForm
            orderAllocationId={allocation.id}
            locale={appLocale}
            orderHref={orderHref}
          />
        </>
      )}
    </div>
  );
}

/** Says why this cannot be done, and offers the one thing that can. */
function Ineligible({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-card bg-surface shadow-card px-card-x py-card-y">
      <h2 className="text-base font-semibold text-content">{title}</h2>
      <p className="text-sm text-content-muted">{description}</p>
      <Link href={actionHref} className="self-start text-sm text-secondary hover:opacity-[var(--state-hover-opacity)]">
        {actionLabel}
      </Link>
    </section>
  );
}
