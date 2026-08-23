import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminDispute } from "@/lib/admin-data";
import { formatDateTime } from "@/lib/localized";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { StatusBadge, disputeTone } from "@/components/trader/status-badge";
import { DisputeDecisionForm } from "@/components/admin/dispute-decision-form";

/**
 * One dispute, and the decision.
 *
 * WHAT THE OPERATOR CAN DECIDE is worked out from the case's own state,
 * transcribed from the service's guards rather than guessed:
 *
 *   - No decisions yet → all four types are open, but only once the
 *     supplier has responded or their deadline has passed. Before that
 *     the server refuses, so no form is drawn and the page says why.
 *   - One decision, a REPLACEMENT that FAILED → only a refund, full or
 *     partial. The server rejects anything else.
 *   - Anything else → no further decision is possible, so no form.
 *
 * The server is still the authority; this exists so an operator is never
 * offered a decision that would be refused.
 *
 * EVIDENCE is listed as metadata only. The storage key is not on the
 * contract and is selected by no query behind this screen — a bucket
 * path handed to a browser is a credential, and an administrator is no
 * exception to that.
 */
export default async function AdminDisputeDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.disputes" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const result = await loadAdminDispute(id);

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

  const dispute = result.data;

  // Transcribed from `adminDecide`: the response window must have closed
  // or the supplier must have answered.
  const windowClosed = new Date(dispute.supplierResponseDueAt).getTime() <= Date.now();
  const canDecideAtAll =
    dispute.status === "OPEN" ||
    dispute.status === "SUPPLIER_RESPONDED" ||
    dispute.status === "AWAITING_REPLACEMENT";

  const firstDecision = dispute.decisions[0];
  const failedReplacement =
    dispute.decisions.length === 1 &&
    firstDecision?.decisionType === "REPLACEMENT" &&
    dispute.status === "AWAITING_REPLACEMENT";

  const allowed: readonly string[] =
    dispute.decisions.length === 0
      ? ["FULL_REFUND", "PARTIAL_REFUND", "REJECTED", "REPLACEMENT"]
      : failedReplacement
        ? // The server permits ONLY a refund as the second decision.
          ["FULL_REFUND", "PARTIAL_REFUND"]
        : [];

  const readyToDecide =
    canDecideAtAll &&
    allowed.length > 0 &&
    (dispute.status === "AWAITING_REPLACEMENT" ||
      dispute.supplierResponse !== null ||
      windowClosed);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-content">{t("caseTitle")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            label={vocab(`disputeStatus.${dispute.status}`)}
            tone={disputeTone(dispute.status)}
          />
          <span className="text-sm text-content-muted">
            {vocab(`disputeReason.${dispute.reasonCode}`)}
          </span>
        </div>
        <Link
          href={`/${appLocale}/admin/orders/${dispute.masterOrderId}`}
          className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
        >
          {t("openOrder")}
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("buyerAccount")}</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-3">
            {/* The buyer's own words, rendered as text. Never as HTML —
                this is free text from a counterparty. */}
            <p className="whitespace-pre-wrap text-sm text-content">{dispute.description}</p>
            <p className="text-sm text-content-muted">
              {t("openedAtLabel")}:{" "}
              <time dateTime={dispute.openedAt}>
                {formatDateTime(dispute.openedAt, appLocale)}
              </time>
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("evidenceTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          {dispute.evidence.length === 0 ? (
            <p className="text-sm text-content-muted">{t("evidenceEmpty")}</p>
          ) : (
            <ul className="flex list-none flex-col gap-2">
              {dispute.evidence.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-content-muted">{item.id}</span>
                  <time dateTime={item.uploadedAt} className="text-content">
                    {formatDateTime(item.uploadedAt, appLocale)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("supplierResponseTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          {dispute.supplierResponse ? (
            <div className="flex flex-col gap-2">
              <StatusBadge
                label={vocab(`disputeResponse.${dispute.supplierResponse.responseType}`)}
              />
              <p className="whitespace-pre-wrap text-sm text-content">
                {dispute.supplierResponse.description}
              </p>
              <p className="text-sm text-content-muted">
                <time dateTime={dispute.supplierResponse.respondedAt}>
                  {formatDateTime(dispute.supplierResponse.respondedAt, appLocale)}
                </time>
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-content-muted">{t("noSupplierResponse")}</p>
              <p className="text-sm text-content-muted">
                {t("responseDueLabel")}:{" "}
                <time dateTime={dispute.supplierResponseDueAt}>
                  {formatDateTime(dispute.supplierResponseDueAt, appLocale)}
                </time>
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      {dispute.decisions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("decisionsTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="flex list-none flex-col gap-4">
              {dispute.decisions.map((decision) => (
                <li key={decision.id} className="flex flex-col gap-2 border-b border-line pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={vocab(`decisionType.${decision.decisionType}`)} />
                    <time dateTime={decision.decidedAt} className="text-sm text-content-muted">
                      {formatDateTime(decision.decidedAt, appLocale)}
                    </time>
                  </div>

                  <dl className="grid gap-1 text-sm sm:grid-cols-2">
                    {/* A null amount means the decision awarded nothing
                        under that head — not zero — so the row is
                        omitted rather than rendered as 0.00. */}
                    {decision.productRefundAmountInclTax !== null ? (
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-content-muted">{t("productRefund")}</dt>
                        <dd className="text-content">
                          {formatMoney(decision.productRefundAmountInclTax, dispute.currency, appLocale)}
                        </dd>
                      </div>
                    ) : null}
                    {decision.shippingRefundAmount !== null ? (
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-content-muted">{t("shippingRefund")}</dt>
                        <dd className="text-content">
                          {formatMoney(decision.shippingRefundAmount, dispute.currency, appLocale)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  <p className="whitespace-pre-wrap text-sm text-content">{decision.reasonNote}</p>

                  {decision.refundObligationId ? (
                    <Link
                      href={`/${appLocale}/admin/refunds/${decision.refundObligationId}`}
                      className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                    >
                      {t("openRefund")}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}

      {readyToDecide ? (
        <DisputeDecisionForm
          disputeId={dispute.id}
          allowed={allowed}
          // The server bounds a replacement by the original allocation
          // quantity, which this contract does not carry, so the field's
          // own ceiling is the DTO's `@Max(100000)`. The server still
          // rejects anything above the real allocation, and its refusal
          // is what the operator sees.
          maxReplacementQuantity={100000}
          labels={{
            legend: t("decideLegend"),
            decisionType: t("decisionTypeLabel"),
            decisionOption: (value) => vocab(`decisionType.${value}`),
            productRefund: t("productRefund"),
            shippingRefund: t("shippingRefund"),
            amountHint: t("amountHint"),
            replacementQuantity: t("replacementQuantity"),
            replacementHint: t("replacementHint"),
            reasonNote: t("reasonNote"),
            reasonHint: t("reasonHint"),
            submit: t("decide"),
            working: t("working"),
            required: t("required"),
            errorTitle: states("errorTitle"),
            requestIdLabel: states("requestIdLabel"),
          }}
        />
      ) : (
        // A page is never a dead end: when no decision is possible the
        // reason is stated, so the operator knows what has to happen
        // next rather than wondering where the form went.
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-content-muted">
          {allowed.length === 0
            ? t("noFurtherDecision")
            : t("waitingForSupplier")}
        </p>
      )}
    </div>
  );
}
