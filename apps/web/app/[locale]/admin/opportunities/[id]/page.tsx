import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminOpportunity } from "@/lib/admin-data";
import { formatDate, formatDateTime, localized } from "@/lib/localized";
import { formatMoney, formatQuantity } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { AdminAction } from "@/components/admin/admin-action";

/**
 * One opportunity, and the three things an operator may do to it.
 *
 * MONITOR PLUS THREE TRANSITIONS, and nothing else. There is no create
 * and no edit in the admin service at all, so price, quantity and every
 * share field are unreachable from this portal by construction.
 *
 * Each action is drawn only from the status the service will accept it
 * from, transcribed from its own guards:
 *
 *   pause   — ACTIVE only.
 *   resume  — PAUSED, and only while the window is still open. The SQL
 *             also requires `end_at > now()`, so a paused opportunity
 *             whose window has closed cannot be resumed; the button is
 *             hidden and the reason is stated.
 *   cancel  — DRAFT, SCHEDULED, ACTIVE or PAUSED, filtered through the
 *             domain's own transition table.
 *
 * ACTION_REQUIRED has no admin action at all: the transition table only
 * allows ACTION_REQUIRED → SCHEDULED/ACTIVE, and that path belongs
 * exclusively to the supplier's publish. An administrator cannot "fix" a
 * blocked opportunity on their behalf, and the page says so instead of
 * leaving an operator hunting for a button that was never built.
 */
export default async function AdminOpportunityDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.opportunities" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const actions = await getTranslations({ locale: appLocale, namespace: "admin.actions" });

  const result = await loadAdminOpportunity(id);

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

  const opportunity = result.data;
  const windowOpen = new Date(opportunity.endAt).getTime() > Date.now();

  const canPause = opportunity.status === "ACTIVE";
  const canResume = opportunity.status === "PAUSED" && windowOpen;
  const canCancel = ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED"].includes(opportunity.status);

  const city = localized(
    appLocale,
    opportunity.fulfillmentCityNameAr,
    opportunity.fulfillmentCityNameEn
  );
  const salesUnit = localized(
    appLocale,
    opportunity.salesUnitNameAr,
    opportunity.salesUnitNameEn
  );

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
          label={vocab(`opportunityStatus.${opportunity.status}`)}
          tone={
            opportunity.status === "FUNDED"
              ? "done"
              : opportunity.status === "ACTION_REQUIRED" || opportunity.status === "PAUSED"
                ? "attention"
                : "neutral"
          }
        />
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("commercialTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("unitPrice")}</dt>
              <dd className="text-content">
                {formatMoney(opportunity.unitPriceAmount, opportunity.currency, appLocale) ?? "—"}
              </dd>
            </div>
            {/* Every money figure comes from the server as a fixed-scale
                string and is formatted once here. Nothing on this page
                adds two of them together. */}
            {opportunity.unitPriceExclTaxAmount !== null ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("unitPriceExclTax")}</dt>
                <dd className="text-content">
                  {formatMoney(
                    opportunity.unitPriceExclTaxAmount,
                    opportunity.currency,
                    appLocale
                  ) ?? "—"}
                </dd>
              </div>
            ) : null}
            {opportunity.unitTaxAmount !== null ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("unitTax")}</dt>
                <dd className="text-content">
                  {formatMoney(opportunity.unitTaxAmount, opportunity.currency, appLocale) ?? "—"}
                </dd>
              </div>
            ) : null}
            {opportunity.totalValueInclTaxAmount !== null ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("totalValue")}</dt>
                <dd className="text-content">
                  {formatMoney(
                    opportunity.totalValueInclTaxAmount,
                    opportunity.currency,
                    appLocale
                  ) ?? "—"}
                </dd>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("funding")}</dt>
              <dd className="text-content">
                {t("fundedOfTarget", {
                  funded: formatQuantity(opportunity.fundedQuantity, appLocale),
                  target: formatQuantity(opportunity.targetQuantity, appLocale),
                })}
              </dd>
            </div>
            {salesUnit ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("salesUnit")}</dt>
                <dd className="text-content">{salesUnit}</dd>
              </div>
            ) : null}
            {city ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("fulfillmentCity")}</dt>
                <dd className="text-content">{city}</dd>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("window")}</dt>
              <dd className="text-content">
                <time dateTime={opportunity.startAt}>
                  {formatDate(opportunity.startAt, appLocale)}
                </time>
                {" — "}
                <time dateTime={opportunity.endAt}>
                  {formatDate(opportunity.endAt, appLocale)}
                </time>
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      {/* The reasons already on the record. Shown whenever present,
          because "why is this paused" is the first question anyone
          arriving at a paused listing asks. */}
      {opportunity.pauseReason || opportunity.cancelReason || opportunity.reasonDetails ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("reasonsTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid gap-2 text-sm">
              {opportunity.pauseReason ? (
                <div className="flex flex-col gap-1">
                  <dt className="text-content-muted">
                    {t("pauseReasonLabel")}
                    {opportunity.pausedAt ? (
                      <>
                        {" — "}
                        <time dateTime={opportunity.pausedAt}>
                          {formatDateTime(opportunity.pausedAt, appLocale)}
                        </time>
                      </>
                    ) : null}
                  </dt>
                  <dd className="whitespace-pre-wrap text-content">{opportunity.pauseReason}</dd>
                </div>
              ) : null}
              {opportunity.cancelReason ? (
                <div className="flex flex-col gap-1">
                  <dt className="text-content-muted">{t("cancelReasonLabel")}</dt>
                  <dd className="whitespace-pre-wrap text-content">{opportunity.cancelReason}</dd>
                </div>
              ) : null}
              {opportunity.reasonDetails ? (
                <div className="flex flex-col gap-1">
                  <dt className="text-content-muted">
                    {opportunity.reasonCode
                      ? vocab(`opportunityReason.${opportunity.reasonCode}`)
                      : t("blockedReasonLabel")}
                  </dt>
                  <dd className="whitespace-pre-wrap text-content">
                    {opportunity.reasonDetails}
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("actionsTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-3">
            {canPause || canResume || canCancel ? (
              <div className="flex flex-wrap gap-2">
                {canPause ? (
                  <AdminAction
                    path={`/admin/opportunities/${opportunity.id}/pause`}
                    variant="secondary"
                    reason={{
                      field: "reason",
                      label: t("pauseReasonField"),
                      minLength: 5,
                      maxLength: 2000,
                      // Says where the text goes: the supplier reads it.
                      hint: t("pauseReasonHint"),
                    }}
                    labels={{
                      ...actionLabels,
                      action: t("pause"),
                      prompt: t("pausePrompt"),
                    }}
                  />
                ) : null}

                {/* Resume takes no reason — the server's endpoint has no
                    body at all. Asking for one would be collecting text
                    that goes nowhere. */}
                {canResume ? (
                  <AdminAction
                    path={`/admin/opportunities/${opportunity.id}/resume`}
                    labels={{
                      ...actionLabels,
                      action: t("resume"),
                      prompt: t("resumePrompt"),
                    }}
                  />
                ) : null}

                {canCancel ? (
                  <AdminAction
                    path={`/admin/opportunities/${opportunity.id}/cancel`}
                    variant="danger"
                    reason={{
                      field: "reason",
                      label: t("cancelReasonField"),
                      minLength: 5,
                      maxLength: 2000,
                      hint: t("cancelReasonHint"),
                    }}
                    labels={{
                      ...actionLabels,
                      action: t("cancelOpportunity"),
                      // Cancellation is terminal and releases every
                      // active checkout lock. Both facts are in the
                      // prompt.
                      prompt: t("cancelPrompt"),
                    }}
                  />
                ) : null}
              </div>
            ) : null}

            {/* A page is never a dead end. When nothing can be done the
                reason is named — and for ACTION_REQUIRED it names who
                CAN act, which is the supplier. */}
            {!canPause && !canResume && !canCancel ? (
              <p className="text-sm text-content-muted">
                {opportunity.status === "ACTION_REQUIRED"
                  ? t("actionRequiredNotice")
                  : t("noActionsAvailable")}
              </p>
            ) : null}

            {opportunity.status === "PAUSED" && !windowOpen ? (
              <p className="text-sm text-content-muted">{t("cannotResumeExpired")}</p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Link
        href={`/${appLocale}/admin/opportunities`}
        className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
      >
        {t("backToList")}
      </Link>
    </div>
  );
}
