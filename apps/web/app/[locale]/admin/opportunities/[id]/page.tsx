import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminOpportunity } from "@/lib/admin-data";
import { formatDate, formatDateTime, localized } from "@/lib/localized";
import { formatQuantity } from "@/lib/money";
import { Money } from "@/components/ui/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { AdminAction } from "@/components/admin/admin-action";
import { AdminOpportunityEditForm } from "@/components/admin/admin-opportunity-edit-form";

/**
 * One opportunity, and what an operator may do to it.
 *
 * FOUR TRANSITIONS, AN EDIT AND A DELETE — «حذف وتعديل العرض من صفحة
 * الإدارة، دام المشتري ما بعد دفع».
 *
 * THE LAST TWO ARE NEW, and the page had said in this very comment
 * that they did not exist. What stood here answered «أوقفه» four ways
 * and «صحّحه» none: an operator who found a price with a zero too many
 * had to ask the supplier to cancel and republish, which loses an
 * offer's history to fix a typo. Neither is a way around the buyer —
 * both refuse the moment one has paid, from the same function the
 * supplier's own routes ask.
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
 *             domain's own transition table, AND ONLY WHILE NOBODY HAS
 *             PAID. A plain cancel leaves money where it is, so the
 *             service refuses it outright once an order stands on the
 *             offer, and names the other route in the refusal.
 *   cancel-and-refund
 *           — the same states, and the button drawn in cancel's place
 *             once buyers are on it. «الإدارة توقف العرض ويكون عندها زر
 *             استرداد الأموال، عند الضغط يكون مثل أن فرصة انتهت ولم
 *             تكتمل — بس يدوي، قبل أن تنتهي مدة العرض.»
 *
 * THE TWO ARE NEVER BOTH DRAWN. Moving buyers' money is not a variation
 * of stopping an offer, and an operator should not be choosing between
 * two buttons whose difference is whether the money moves — the offer's
 * own state decides which one is the honest act, and only that one
 * appears.
 *
 * ACTION_REQUIRED has no admin action at all: the transition table only
 * allows ACTION_REQUIRED → SCHEDULED/ACTIVE, and that path belongs
 * exclusively to the supplier's publish. An administrator cannot "fix" a
 * blocked opportunity on their behalf, and the page says so instead of
 * leaving an operator hunting for a button that was never built.
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
    namespace: "admin.opportunities",
  });
  return { title: t("detailTitle") };
}

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
  const cancellable = ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED"].includes(opportunity.status);
  // «العرض منشور وليس عليه أي عمليات شراء — يقدر يلغيه… وإذا كان عليه
  //  عملية شراء يطلب المورد من الإدارة» — and no share is held without
  //  payment, so a funded quantity above zero IS money in the platform.
  const hasBuyers = opportunity.fundedQuantity > 0;
  const canCancel = cancellable && !hasBuyers;
  const canCancelAndRefund = cancellable && hasBuyers;

  // EDIT AND DELETE ANSWER TO THE BUYER, NOT TO THE STATUS — «دام
  // المشتري ما بعد دفع». FUNDED, EXPIRED and CANCELLED are excluded
  // for a different reason: they are finished states, and correcting
  // one would be correcting the past.
  //
  // THE REFUSAL IS STILL THE SERVER'S TO GIVE. `fundedQuantity` is one
  // of three witnesses the service reads — a live basket and a paid
  // one are the others, and neither is on this page — so the server
  // may refuse what this drew, and says which of the two it was.
  const live = ["DRAFT", "SCHEDULED", "ACTION_REQUIRED", "ACTIVE", "PAUSED"].includes(
    opportunity.status
  );
  const canEdit = live && !hasBuyers;
  const canDelete = live && !hasBuyers;

  const region = localized(
    appLocale,
    opportunity.fulfillmentRegionNameAr,
    opportunity.fulfillmentRegionNameEn
  );
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
                <Money
                  amount={opportunity.unitPriceAmount}
                  currency={opportunity.currency}
                  locale={appLocale}
                  fallback={<span className="text-content-muted">—</span>}
                />
              </dd>
            </div>
            {/* Every money figure comes from the server as a fixed-scale
                string and is formatted once here. Nothing on this page
                adds two of them together. */}
            {opportunity.unitPriceExclTaxAmount !== null ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("unitPriceExclTax")}</dt>
                <dd className="text-content">
                  <Money
                    amount={opportunity.unitPriceExclTaxAmount}
                    currency={opportunity.currency}
                    locale={appLocale}
                    fallback={<span className="text-content-muted">—</span>}
                  />
                </dd>
              </div>
            ) : null}
            {opportunity.unitTaxAmount !== null ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("unitTax")}</dt>
                <dd className="text-content">
                  <Money
                    amount={opportunity.unitTaxAmount}
                    currency={opportunity.currency}
                    locale={appLocale}
                    fallback={<span className="text-content-muted">—</span>}
                  />
                </dd>
              </div>
            ) : null}
            {opportunity.totalValueInclTaxAmount !== null ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("totalValue")}</dt>
                <dd className="text-content">
                  <Money
                    amount={opportunity.totalValueInclTaxAmount}
                    currency={opportunity.currency}
                    locale={appLocale}
                    fallback={<span className="text-content-muted">—</span>}
                  />
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
            {/*
              THE REGION FIRST — a listing ships from a branch and a
              branch is recorded against one. This row showed the city
              alone, so a listing from a branch that names no city said
              nothing at all about where it ships from.
            */}
            {region ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("fulfillmentRegion")}</dt>
                <dd className="text-content">{region}</dd>
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

      {/* CORRECTING IT COMES BEFORE STOPPING IT. An operator reading
          down the page meets the smaller act first: the four buttons
          below all end something. */}
      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("editTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <AdminOpportunityEditForm
              opportunity={{
                id: opportunity.id,
                status: opportunity.status,
                unitPriceAmount: opportunity.unitPriceAmount,
                targetQuantity: opportunity.targetQuantity,
                startAt: opportunity.startAt,
                endAt: opportunity.endAt,
                expectedPreparationDays: opportunity.expectedPreparationDays,
                descriptionAr: opportunity.descriptionAr,
                descriptionEn: opportunity.descriptionEn,
              }}
              labels={{
                save: actions("save"),
                working: actions("working"),
                saved: t("editSaved"),
                noChange: t("editNoChange"),
                errorTitle: states("errorTitle"),
                requestIdLabel: states("requestIdLabel"),
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t("actionsTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-3">
            {canPause || canResume || canCancel || canCancelAndRefund || canDelete ? (
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

                {/* THE OWNER'S BUTTON. It ends the offer and gives every
                    payment back through the same util the clock uses
                    when a window closes short, so a buyer's refund does
                    not depend on which door the offer left by. */}
                {canCancelAndRefund ? (
                  <AdminAction
                    path={`/admin/opportunities/${opportunity.id}/cancel-and-refund`}
                    variant="danger"
                    reason={{
                      field: "reason",
                      label: t("cancelAndRefundReasonField"),
                      minLength: 5,
                      maxLength: 2000,
                      hint: t("cancelAndRefundReasonHint"),
                    }}
                    labels={{
                      ...actionLabels,
                      action: t("cancelAndRefund"),
                      prompt: t("cancelAndRefundPrompt"),
                    }}
                  />
                ) : null}

                {/* NOT A CANCEL, AND NOT NAMED LIKE ONE. Cancelling an
                    offer nobody ever bought from leaves a permanent
                    CANCELLED line claiming something was withdrawn from
                    sale — a statement about a thing that was never sold.
                    This is for the duplicate, the test row and the price
                    typed with a zero too many.

                    NO REASON ASKED, as with the product delete beside it
                    — «بدون أن يطلب مني سبب لذلك» — and the confirmation
                    stays, because a permanent delete must never be one
                    mis-aimed click away. */}
                {canDelete ? (
                  <AdminAction
                    path={`/admin/opportunities/${opportunity.id}`}
                    method="DELETE"
                    variant="danger"
                    labels={{
                      ...actionLabels,
                      action: t("deleteForever"),
                      prompt: t("deletePrompt"),
                    }}
                  />
                ) : null}
              </div>
            ) : null}

            {/* WHY THE PLAIN CANCEL IS NOT THERE. Without this an
                operator who came to cancel finds a differently-worded
                button and has to guess whether it is the same act. */}
            {canCancelAndRefund ? (
              <p className="text-sm text-content-muted">{t("cancelNeedsRefundNotice")}</p>
            ) : null}

            {/* A page is never a dead end. When nothing can be done the
                reason is named — and for ACTION_REQUIRED it names who
                CAN act, which is the supplier. */}
            {!canPause &&
            !canResume &&
            !canCancel &&
            !canCancelAndRefund &&
            !canDelete ? (
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
        className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
      >
        {t("backToList")}
      </Link>
    </div>
  );
}
