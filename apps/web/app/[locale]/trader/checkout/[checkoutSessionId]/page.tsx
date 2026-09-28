import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isPaidCheckoutSession, type CheckoutSessionView } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadCheckoutSession } from "@/lib/trader-data";
import { formatDateTime } from "@/lib/localized";
import { ErrorState } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import {
  CheckoutDestinations,
  CheckoutQuote,
} from "@/components/checkout/checkout-summary";
import { StartPaymentButton } from "@/components/checkout/start-payment-button";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("trader.checkout");


/**
 * Review the frozen quote, then start payment.
 *
 * The route is keyed by the CHECKOUT SESSION id, which is what the
 * trader already holds after the session is created and what the
 * payment page keys on too. Keying it by a payment attempt would mean
 * the URL changed identity the moment an attempt was created, and a
 * reload after a failed attempt would land on a dead id.
 *
 * Every figure comes from `quote_snapshots` via the closed
 * `CheckoutSessionView`. Nothing on this page is computed.
 *
 * What is offered depends entirely on the session's own status, and the
 * union makes that exhaustive: there is no state in which a "Pay" button
 * appears beside an expired lock.
 */
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ locale: string; checkoutSessionId: string }>;
}) {
  const { locale, checkoutSessionId } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.checkout" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const result = await loadCheckoutSession(checkoutSessionId);

  // Another company's session and an unknown id answer the same 404,
  // so probing ids confirms nothing.
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

  const labels = {
    quoteLabel: t("quoteLabel"),
    unitPrice: t("unitPrice"),
    quantity: t("quantity"),
    productsExclTax: t("productsExclTax"),
    tax: t("tax"),
    productsInclTax: t("productsInclTax"),
    shipping: t("shipping"),
    grandTotal: t("grandTotal"),
    amountUnavailable: t("amountUnavailable"),
    destinationsLabel: t("destinationsLabel"),
    destinationQuantity: t("destinationQuantity"),
    destinationShipping: t("destinationShipping"),
  };

  return (
    /* TWO COLUMNS, THE SAME ARRANGEMENT AS THE OFFER'S OWN SCREEN —
       «المعلومات قليلة والمساحات الفارغة كبيرة؛ اعتمد التصميم المرتب مثل
       ما فعلنا في تفاصيل المنتج».

       IT WAS THREE FULL-WIDTH BLOCKS stacked down the page: a short
       quote, a short list of branches, and the pay button — each one a
       band of air across a wide screen, and the button below the fold.

       THE NARROW COLUMN IS THE LEFT and holds what a reader ACTS on:
       the total, and the button under it. The wide one holds what they
       are checking. The same division the offer page uses, so the two
       screens in one purchase do not read as two designs. */
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold text-content">{t("title")}</h1>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* ── WHAT IS BEING CHECKED ── */}
        <CheckoutDestinations session={session} locale={appLocale} labels={labels} />

        {/* ── WHAT IS BEING DECIDED: the total, then the button ── */}
        <div className="flex min-w-0 flex-col gap-3">
          <CheckoutQuote session={session} locale={appLocale} labels={labels} />
          <StatusRegion session={session} locale={appLocale} />
        </div>
      </div>
    </div>
  );
}

/**
 * What can be done next, decided by the session's status alone.
 *
 * The switch is exhaustive over the discriminated union, so a status
 * added to the contract fails the type check here rather than falling
 * through to a screen with no action on it.
 */
async function StatusRegion({
  session,
  locale,
}: {
  session: CheckoutSessionView;
  locale: AppLocale;
}) {
  const t = await getTranslations({ locale, namespace: "trader.checkout" });
  const states = await getTranslations({ locale, namespace: "states" });

  if (isPaidCheckoutSession(session)) {
    // PAID guarantees an order id: the webhook writes the status and the
    // MasterOrder on one transaction client, so there is no "paid but
    // still finalising" wait to sit through.
    return (
      <Notice tone="success" title={t("paid.title")} description={t("paid.description")}>
        <ButtonLink href={`/${locale}/trader/orders/${session.masterOrderId}`}>
          {t("paid.viewOrder")}
        </ButtonLink>
      </Notice>
    );
  }

  switch (session.status) {
    case "LOCKED": {
      const expires = formatDateTime(session.lockExpiresAt, locale);
      return (
        <div className="flex flex-col gap-3">
          {expires ? (
            <p className="text-sm text-content-muted">
              {t("locked.expiresAt", { at: expires })}
            </p>
          ) : null}
          <p className="text-sm text-content-muted">{t("locked.notReserved")}</p>
          <StartPaymentButton
            checkoutSessionId={session.id}
            locale={locale}
            label={t("locked.pay")}
            submittingLabel={t("locked.paying")}
            retryLabel={t("locked.retry")}
            errorTitle={states("errorTitle")}
            requestIdLabel={states("requestIdLabel")}
          />
        </div>
      );
    }

    case "PAYMENT_PENDING":
      // An attempt already exists. Offering "Pay" again here would post
      // a second attempt the server would refuse anyway.
      return (
        <Notice title={t("pending.title")} description={t("pending.description")}>
          <ButtonLink href={`/${locale}/trader/payment/${session.id}`}>
            {t("pending.continue")}
          </ButtonLink>
        </Notice>
      );

    case "EXPIRED":
      return (
        <Notice tone="warning" title={t("expired.title")} description={t("expired.description")}>
          <ButtonLink href={`/${locale}/trader/opportunities`} variant="secondary">
            {t("browseOpportunities")}
          </ButtonLink>
        </Notice>
      );

    case "ABANDONED":
      return (
        <Notice
          tone="warning"
          title={t("abandoned.title")}
          description={t("abandoned.description")}
        >
          <ButtonLink href={`/${locale}/trader/opportunities`} variant="secondary">
            {t("browseOpportunities")}
          </ButtonLink>
        </Notice>
      );
  }
}

function Notice({
  title,
  description,
  tone = "neutral",
  children,
}: {
  title: string;
  description: string;
  tone?: "neutral" | "warning" | "success";
  children?: React.ReactNode;
}) {
  const toneClass =
    tone === "warning"
      ? "border-warning bg-warning-surface text-warning-text"
      : tone === "success"
        ? "border-success"
        : "border-line";

  return (
    <section
      className={`flex flex-col gap-2 rounded-card border px-card-x py-card-y ${toneClass}`}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm">{description}</p>
      {children ? <div className="flex flex-wrap gap-3">{children}</div> : null}
    </section>
  );
}
