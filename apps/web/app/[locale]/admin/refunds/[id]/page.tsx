import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminRefund, loadRefundProviders } from "@/lib/admin-data";
import { formatDateTime } from "@/lib/localized";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ErrorState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { RefundAttemptForm } from "@/components/admin/refund-attempt-form";

/**
 * One refund obligation and every attempt made on it.
 *
 * THE ATTEMPT HISTORY IS THE POINT. A refund that failed three times
 * and one that nobody has touched both read as "not completed" from the
 * list; here the difference is visible, along with the provider's own
 * reference for each transfer and the reason each failure gave.
 *
 * `idempotencyKey` is NOT on this contract and is not shown. It is the
 * token deciding whether a replayed refund executes once or twice, and
 * anyone holding it can collide with a real settlement instruction.
 *
 * The two per-head figures are shown only when they are non-null: null
 * means the decision awarded nothing under that head, which is not the
 * same as zero and must not print as `0.00`.
 */
export default async function AdminRefundDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.refunds" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  // Fetched together: the provider list is needed to render the form and
  // does not depend on the obligation.
  const [result, providers] = await Promise.all([loadAdminRefund(id), loadRefundProviders()]);

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

  const refund = result.data;
  const amount = formatMoney(refund.amount, refund.currency, appLocale);

  // The service refuses a new attempt on an obligation that is already
  // settled, so the form is drawn only where it can work.
  const canAttempt = refund.status === "PENDING_EXECUTION" || refund.status === "FAILED";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-content">{amount ?? t("title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            label={vocab(`refundStatus.${refund.status}`)}
            tone={
              refund.status === "COMPLETED"
                ? "done"
                : refund.status === "FAILED"
                  ? "attention"
                  : "neutral"
            }
          />
          <span className="text-sm text-content-muted">
            {vocab(`refundSource.${refund.source}`)}
          </span>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("obligationTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("reason")}</dt>
              <dd className="text-content">{vocab(`refundReason.${refund.reasonCode}`)}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("createdAt")}</dt>
              <dd className="text-content">
                <time dateTime={refund.createdAt}>
                  {formatDateTime(refund.createdAt, appLocale)}
                </time>
              </dd>
            </div>
            {refund.productRefundAmountInclTax !== null ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("productRefund")}</dt>
                <dd className="text-content">
                  {formatMoney(refund.productRefundAmountInclTax, refund.currency, appLocale) ??
                    "—"}
                </dd>
              </div>
            ) : null}
            {refund.shippingRefundAmount !== null ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("shippingRefund")}</dt>
                <dd className="text-content">
                  {formatMoney(refund.shippingRefundAmount, refund.currency, appLocale) ?? "—"}
                </dd>
              </div>
            ) : null}
            {refund.masterOrderId ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("order")}</dt>
                <dd>
                  <Link
                    href={`/${appLocale}/admin/orders/${refund.masterOrderId}`}
                    className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                  >
                    {t("openOrder")}
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("attemptsTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          {refund.attempts.length === 0 ? (
            <p className="text-sm text-content-muted">{t("noAttempts")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table caption={t("attemptsCaption")}>
                <THead>
                  <TR>
                    <TH>{t("attemptStartedAt")}</TH>
                    <TH>{t("provider")}</TH>
                    <TH>{t("attemptStatus")}</TH>
                    <TH>{t("providerReference")}</TH>
                    <TH>{t("failureReason")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {refund.attempts.map((attempt) => (
                    <TR key={attempt.id}>
                      <TD>
                        <time dateTime={attempt.createdAt}>
                          {formatDateTime(attempt.createdAt, appLocale)}
                        </time>
                      </TD>
                      <TD className="font-mono text-xs">{attempt.providerCode}</TD>
                      <TD>
                        <StatusBadge
                          label={vocab(`refundAttemptStatus.${attempt.status}`)}
                          tone={
                            attempt.status === "SUCCEEDED"
                              ? "done"
                              : attempt.status === "FAILED"
                                ? "attention"
                                : "neutral"
                          }
                        />
                      </TD>
                      <TD className="break-all font-mono text-xs">
                        {attempt.providerReference ?? "—"}
                      </TD>
                      {/* The provider's own words about why it refused.
                          Shown verbatim because paraphrasing a payment
                          rail's reason is how a real cause gets lost. */}
                      <TD className="whitespace-pre-wrap">{attempt.failureReason ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {canAttempt ? (
        <RefundAttemptForm
          refundObligationId={refund.id}
          providers={providers.ok ? providers.data : []}
          labels={{
            legend: t("startAttempt"),
            provider: t("provider"),
            hint: t("providerHint"),
            submit: t("startAttempt"),
            working: t("working"),
            required: t("required"),
            noProviders: t("noProviders"),
            errorTitle: states("errorTitle"),
            requestIdLabel: states("requestIdLabel"),
          }}
        />
      ) : (
        // Never a dead end: when no attempt can be started the reason is
        // stated rather than the form silently vanishing.
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-content-muted">
          {t("noAttemptPossible")}
        </p>
      )}
    </div>
  );
}
