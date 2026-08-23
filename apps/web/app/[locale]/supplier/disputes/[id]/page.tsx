import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierDispute } from "@/lib/supplier-data";
import { formatDateTime } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Fact, FactList, StatusWithAction } from "@/components/trader/account-panels";
import { ErrorState } from "@/components/ui/states";
import { DisputeRespondForm } from "@/components/supplier/dispute-respond-form";
import { DISPUTE_SUPPLIER_RESPONSE_TYPES } from "@platform/types";

/**
 * One dispute, and the supplier's answer to it.
 *
 * WHAT IS HERE: the trader's own words — the accusation this supplier must
 * answer, without which responding is impossible — the supplier's own
 * evidence as metadata, and the exact decision if one has been made.
 *
 * WHAT IS NOT, by construction rather than by filtering here: any storage
 * key, any uploader identity, the administrator's internal `reasonNote`,
 * and the TRADER's evidence. The API's projection never selects them, and
 * its evidence query filters by the supplier's company inside the SQL.
 *
 * The trader's description is counterparty free text and is rendered as a
 * text node — never as markup.
 */
export default async function SupplierDisputeDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.disputes" });
  const status = await getTranslations({ locale: appLocale, namespace: "supplier.status" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  const result = await loadSupplierDispute(id);
  if (!result.ok && result.notFound) notFound();

  const backHref = `/${appLocale}/supplier/disputes`;

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb href={backHref} label={t("breadcrumbLabel")} back={t("backToList")} />
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      </div>
    );
  }

  const dispute = result.data;
  const awaiting = dispute.status === "OPEN";

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb href={backHref} label={t("breadcrumbLabel")} back={t("backToList")} />

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">
          {status(`disputeReason.${dispute.reasonCode}`)}
        </h1>
        <Link
          href={`/${appLocale}/supplier/orders/${dispute.orderId}`}
          className="inline-flex min-h-11 items-center text-sm text-secondary hover:opacity-90"
        >
          {t("openOrder")}
        </Link>
      </header>

      <Card
        ariaLabel={t("statusTitle")}
        className={awaiting ? "border-warning" : undefined}
      >
        <CardHeader>
          <CardTitle>{t("statusTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <StatusWithAction
            label={t("statusLabel")}
            status={status(`dispute.${dispute.status}`)}
            // Every status resolves to a next step. A status with no next
            // step leaves someone reading a word and guessing.
            action={t(`nextStep.${dispute.status}`)}
            tone={
              awaiting || dispute.status === "RESOLVED_REJECTED"
                ? "warning"
                : dispute.status.startsWith("RESOLVED_")
                  ? "success"
                  : "neutral"
            }
          />
          <div className="mt-4">
            <FactList>
              <Fact
                label={t("openedAt")}
                value={
                  <time dateTime={dispute.openedAt}>
                    {formatDateTime(dispute.openedAt, appLocale)}
                  </time>
                }
              />
              <Fact
                label={t("responseDueAt")}
                value={
                  <time dateTime={dispute.supplierResponseDueAt}>
                    {formatDateTime(dispute.supplierResponseDueAt, appLocale)}
                  </time>
                }
              />
            </FactList>
          </div>
        </CardBody>
      </Card>

      <Card ariaLabel={t("claimTitle")}>
        <CardHeader>
          <CardTitle>{t("claimTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          {/* The trader's own words, as a text node. Counterparty free
              text is never markup. */}
          <p className="whitespace-pre-line text-sm text-content">{dispute.traderDescription}</p>
        </CardBody>
      </Card>

      {dispute.supplierResponse ? (
        <Card ariaLabel={t("responseTitle")}>
          <CardHeader>
            <CardTitle>{t("responseTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <FactList>
              <Fact
                label={t("responseType")}
                value={status(`disputeResponse.${dispute.supplierResponse.responseType}`)}
              />
              <Fact
                label={t("respondedAt")}
                value={formatDateTime(dispute.supplierResponse.respondedAt, appLocale) ?? ""}
              />
            </FactList>
            <p className="mt-3 whitespace-pre-line text-sm text-content">
              {dispute.supplierResponse.description}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {dispute.decisions.length > 0 ? (
        <Card ariaLabel={t("decisionsTitle")}>
          <CardHeader>
            <CardTitle>{t("decisionsTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <ol className="flex list-none flex-col gap-3">
              {dispute.decisions.map((decision) => (
                <li key={decision.sequenceNumber} className="rounded-md border border-line p-3">
                  <FactList>
                    {/* The EXACT outcome. Four different results live
                        under RESOLVED_*, and the administrator's internal
                        note is not on this contract at all. */}
                    <Fact
                      label={t("decisionType")}
                      value={status(`disputeDecision.${decision.decisionType}`)}
                    />
                    <Fact
                      label={t("decidedAt")}
                      value={formatDateTime(decision.decidedAt, appLocale) ?? ""}
                    />
                  </FactList>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}

      <Card ariaLabel={t("evidenceTitle")}>
        <CardHeader>
          <CardTitle>{t("evidenceTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-content-muted">{t("evidenceNotice")}</p>
          {dispute.evidence.length === 0 ? (
            <p className="text-sm text-content-muted">{t("evidenceEmpty")}</p>
          ) : (
            <ul className="flex list-none flex-col gap-2">
              {dispute.evidence.map((item) => (
                <li key={item.id} className="text-sm text-content">
                  {/* Metadata only. There is no storage key on this
                      contract and no authorised delivery endpoint to pair
                      one with, so no file opens from here. */}
                  {item.contentType ?? t("evidenceUnknownType")}
                  {item.sizeBytes !== null ? ` · ${item.sizeBytes}` : ""}
                  {" · "}
                  <time dateTime={item.uploadedAt}>
                    {formatDateTime(item.uploadedAt, appLocale)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {awaiting ? (
        <DisputeRespondForm
          disputeId={dispute.id}
          labels={{
            heading: t("respond.heading"),
            responseType: t("respond.responseType"),
            responseTypeOption: Object.fromEntries(
              DISPUTE_SUPPLIER_RESPONSE_TYPES.map((type) => [
                type,
                status(`disputeResponse.${type}`),
              ])
            ),
            description: t("respond.description"),
            descriptionHint: t("respond.descriptionHint"),
            placeholder: t("respond.placeholder"),
            required: common("required"),
            submit: t("respond.submit"),
            submitting: t("respond.submitting"),
            prompt: t("respond.prompt"),
            confirm: common("confirm"),
            cancel: common("cancel"),
            errorTitle: states("errorTitle"),
            requestIdLabel: states("requestIdLabel"),
            descriptionLength: t.raw("respond.descriptionLength"),
            typeRequired: t("respond.typeRequired"),
          }}
        />
      ) : null}
    </div>
  );
}

function Breadcrumb({ href, label, back }: { href: string; label: string; back: string }) {
  return (
    <nav aria-label={label} className="text-sm">
      <Link href={href} className="inline-flex min-h-11 items-center text-secondary hover:opacity-90">
        {back}
      </Link>
    </nav>
  );
}
