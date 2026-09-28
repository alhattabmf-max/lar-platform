import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isPaidCheckoutSession, type CheckoutSessionView } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadCheckoutSession } from "@/lib/trader-data";
import { formatDateTime } from "@/lib/localized";
import { Money } from "@/components/ui/money";
import { ErrorState } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import { PaymentStatusPoller } from "@/components/checkout/payment-status-poller";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("trader.payment");


/**
 * Where a trader waits for a payment to complete.
 *
 * Keyed by the CHECKOUT SESSION id, not a payment attempt id, for two
 * reasons: the session is the thing whose status actually answers "did
 * this go through", and a failed attempt would otherwise leave the URL
 * pointing at a dead id after a reload.
 *
 * The browser does not complete the payment. The provider calls the
 * webhook, which marks the session PAID and creates the MasterOrder on
 * one transaction client. This page reads the session — the single
 * authority — and a small client poller notices when the answer
 * changes.
 *
 * There is no "paid but still finalising" state to render, because the
 * write path cannot produce one: PAID and the order commit together.
 */
export default async function PaymentPage({
  params,
}: {
  params: Promise<{ locale: string; checkoutSessionId: string }>;
}) {
  const { locale, checkoutSessionId } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.payment" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const result = await loadCheckoutSession(checkoutSessionId);

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

  const session = result.data;

  // Paid: the order exists, guaranteed by the union. Straight there —
  // there is nothing to wait for and nothing to confirm, and leaving
  // someone on a waiting screen after the money moved is worse than a
  // redirect they did not ask for.
  if (isPaidCheckoutSession(session)) {
    redirect(`/${appLocale}/trader/orders/${session.masterOrderId}`);
  }

  // No attempt has been started, so there is nothing to wait for. The
  // quote and the button both live on the checkout page.
  if (session.status === "LOCKED") {
    redirect(`/${appLocale}/trader/checkout/${session.id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
      </header>

      <StatusRegion session={session} locale={appLocale} />
    </div>
  );
}

async function StatusRegion({
  session,
  locale,
}: {
  session: CheckoutSessionView;
  locale: AppLocale;
}) {
  const t = await getTranslations({ locale, namespace: "trader.payment" });

  // PAID and LOCKED both redirected above; this narrows what remains.
  if (session.status === "EXPIRED" || session.status === "ABANDONED") {
    return (
      <section className="flex flex-col gap-3 rounded-lg border border-warning bg-warning-surface p-4 text-warning-text">
        <h2 className="text-base font-semibold">{t(`${session.status}.title`)}</h2>
        <p className="text-sm">{t(`${session.status}.description`)}</p>
        {/* Deliberately not a "try again" that re-posts: this session is
            terminal, and a new purchase starts from the opportunity. */}
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={`/${locale}/trader/opportunities`} variant="secondary">
            {t("browseOpportunities")}
          </ButtonLink>
        </div>
      </section>
    );
  }

  const deadline = session.paymentDeadlineAt
    ? formatDateTime(session.paymentDeadlineAt, locale)
    : null;

  return (
    <section className="flex flex-col gap-4 rounded-card bg-surface shadow-card px-card-x py-card-y">
      <h2 className="text-base font-semibold text-content">{t("pending.title")}</h2>

      <p className="text-lg font-semibold text-content">
        <Money
          amount={session.grandTotalAmount}
          currency={session.currency}
          locale={locale}
          fallback={
            <span className="text-sm font-normal text-content-muted">
              {t("amountUnavailable")}
            </span>
          }
        />
      </p>

      {deadline ? (
        <p className="text-sm text-content-muted">{t("pending.deadline", { at: deadline })}</p>
      ) : null}

      <p className="text-sm text-content">{t("pending.description")}</p>

      <PaymentStatusPoller
        checkoutSessionId={session.id}
        initialStatus={session.status}
        waitingLabel={t("pending.waiting")}
        stoppedLabel={t("pending.stopped")}
        recheckLabel={t("pending.recheck")}
        contractErrorLabel={t("pending.contractError")}
      />

      {/* No "cancel payment" control. Abandoning is only permitted while
          the lock is unreleased, and offering it mid-capture would let
          someone release a session the provider is about to confirm. */}
      <p className="text-sm text-content-muted">{t("pending.doNotClose")}</p>
    </section>
  );
}
