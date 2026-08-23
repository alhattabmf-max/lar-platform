import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierOpportunity } from "@/lib/supplier-data";
import { opportunityActions, opportunityNextStepKey } from "@/lib/opportunity-actions";
import { localized, formatDate, formatDateTime } from "@/lib/localized";
import { formatMoney, formatPercentage, formatQuantity } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Fact, FactList, StatusWithAction } from "@/components/trader/account-panels";
import { ErrorState } from "@/components/ui/states";
import { OpportunityActions } from "@/components/supplier/opportunity-actions";

/**
 * One listing: its state, its terms, where it ships from, and the actions
 * the API will accept.
 *
 * An unknown id and another company's listing both answer 404 from the API —
 * deliberately, so probing reveals nothing — and this renders Next's own 404
 * for either, which preserves that.
 *
 * ACTION_REQUIRED shows the TRANSLATED reason code and a fix written for it.
 * The row's `reasonDetails` is operator-facing English and is not on the
 * contract at all, so there is nothing here to leak.
 *
 * Every amount arrives as a decimal string and is formatted at the edge of
 * rendering. Nothing is summed, multiplied or converted: the tax breakdown
 * shown is the FROZEN one computed at publish time, and recomputing it here
 * would produce a second figure that eventually disagrees with the one
 * traders were charged.
 */
export default async function SupplierOpportunityDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.opportunities" });
  const status = await getTranslations({ locale: appLocale, namespace: "supplier.status" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  const result = await loadSupplierOpportunity(id);

  if (!result.ok && result.notFound) notFound();

  const backHref = `/${appLocale}/supplier/opportunities`;

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

  const opportunity = result.data;
  const gate = opportunityActions(opportunity);
  const name = localized(appLocale, opportunity.productNameAr, opportunity.productNameEn);
  const unit = localized(appLocale, opportunity.salesUnitNameAr, opportunity.salesUnitNameEn);

  const price = formatMoney(opportunity.unitPriceAmount, opportunity.currency, appLocale);
  const exclTax =
    opportunity.unitPriceExclTaxAmount === null
      ? null
      : formatMoney(opportunity.unitPriceExclTaxAmount, opportunity.currency, appLocale);
  const tax =
    opportunity.unitTaxAmount === null
      ? null
      : formatMoney(opportunity.unitTaxAmount, opportunity.currency, appLocale);
  const totalValue =
    opportunity.totalValueInclTaxAmount === null
      ? null
      : formatMoney(opportunity.totalValueInclTaxAmount, opportunity.currency, appLocale);

  // ACTION_REQUIRED resolves per reason code: "something is blocking
  // this" is not a next step — which of the ten things it is, is.
  const nextStep =
    opportunity.status === "ACTION_REQUIRED" && opportunity.reasonCode
      ? t(`reasonFix.${opportunity.reasonCode}`)
      : t(`nextStep.${opportunityNextStepKey(opportunity.status)}`);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb href={backHref} label={t("breadcrumbLabel")} back={t("backToList")} />

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{name}</h1>
        {unit ? <p className="text-sm text-content-muted">{unit}</p> : null}
      </header>

      <Card
        ariaLabel={t("statusTitle")}
        className={opportunity.status === "ACTION_REQUIRED" ? "border-warning" : undefined}
      >
        <CardHeader>
          <CardTitle>{t("statusTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-4">
            <StatusWithAction
              label={t("statusLabel")}
              status={
                opportunity.reasonCode
                  ? // The exact blocking reason, translated. Never the
                    // operator-facing details string, which is not on
                    // this contract.
                    status(`opportunityReason.${opportunity.reasonCode}`)
                  : status(`opportunity.${opportunity.status}`)
              }
              action={nextStep}
              tone={
                opportunity.status === "ACTION_REQUIRED" || opportunity.status === "PAUSED"
                  ? "warning"
                  : opportunity.status === "ACTIVE" || opportunity.status === "FUNDED"
                    ? "success"
                    : "neutral"
              }
            />

            {/* The edit link appears only where `EDITABLE_STATUSES`
                would accept a write. A link into a form that cannot be
                saved is worse than no link. */}
            {gate.canUpdate ? (
              <Link
                href={`/${appLocale}/supplier/opportunities/${opportunity.id}/edit`}
                className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
              >
                {t("actions.edit")}
              </Link>
            ) : null}

            <OpportunityActions
              opportunityId={opportunity.id}
              gate={gate}
              listHref={backHref}
              labels={{
                publish: t("actions.publish"),
                publishPrompt: t("actions.publishPrompt"),
                extend: t("actions.extend"),
                extendPrompt: t("actions.extendPrompt"),
                delete: t("actions.delete"),
                deletePrompt: t("actions.deletePrompt"),
                confirm: common("confirm"),
                cancel: common("cancel"),
                working: t("actions.working"),
                errorTitle: states("errorTitle"),
                requestIdLabel: states("requestIdLabel"),
              }}
            />
          </div>
        </CardBody>
      </Card>

      <Card ariaLabel={t("termsTitle")}>
        <CardHeader>
          <CardTitle>{t("termsTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <FactList>
            {price ? (
              <Fact
                label={t("unitPrice")}
                value={unit ? t("pricePerUnit", { price, unit }) : price}
              />
            ) : null}
            <Fact
              label={t("targetQuantity")}
              value={formatQuantity(opportunity.targetQuantity, appLocale)}
            />
            <Fact
              label={t("funded")}
              value={t("fundedOfTarget", {
                funded: formatQuantity(opportunity.fundedQuantity, appLocale),
                target: formatQuantity(opportunity.targetQuantity, appLocale),
              })}
            />
            {opportunity.shareQuantity !== null ? (
              <Fact
                label={t("shareQuantity")}
                value={formatQuantity(opportunity.shareQuantity, appLocale)}
              />
            ) : null}
            {opportunity.sharePercentage !== null ? (
              <Fact
                label={t("sharePercentage")}
                value={formatPercentage(opportunity.sharePercentage, appLocale) ?? ""}
              />
            ) : null}
            <Fact
              label={t("preparationDays")}
              value={t("days", { count: opportunity.expectedPreparationDays })}
            />
          </FactList>
        </CardBody>
      </Card>

      {/* The tax breakdown is FROZEN at publish time. Before the first
          publish there is none, and a zero would be a claim that no tax
          applies — so the whole card is omitted rather than shown empty. */}
      {exclTax || tax || totalValue ? (
        <Card ariaLabel={t("taxTitle")}>
          <CardHeader>
            <CardTitle>{t("taxTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-sm text-content-muted">{t("taxFrozenNotice")}</p>
            <FactList>
              {exclTax ? <Fact label={t("unitPriceExclTax")} value={exclTax} /> : null}
              {tax ? <Fact label={t("unitTax")} value={tax} /> : null}
              {opportunity.taxRatePercent ? (
                <Fact label={t("taxRate")} value={`${opportunity.taxRatePercent}%`} />
              ) : null}
              {totalValue ? <Fact label={t("totalValue")} value={totalValue} /> : null}
            </FactList>
          </CardBody>
        </Card>
      ) : null}

      <Card ariaLabel={t("scheduleTitle")}>
        <CardHeader>
          <CardTitle>{t("scheduleTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <FactList>
            <Fact
              label={t("startsAt")}
              value={
                <time dateTime={opportunity.startAt}>
                  {formatDateTime(opportunity.startAt, appLocale)}
                </time>
              }
            />
            <Fact
              label={t("endsAt")}
              value={
                <time dateTime={opportunity.endAt}>
                  {formatDateTime(opportunity.endAt, appLocale)}
                </time>
              }
            />
            {opportunity.extendedAt ? (
              <Fact label={t("extendedAt")} value={formatDate(opportunity.extendedAt, appLocale)} />
            ) : null}
            {opportunity.firstActivatedAt ? (
              <Fact
                label={t("firstActivatedAt")}
                value={formatDate(opportunity.firstActivatedAt, appLocale)}
              />
            ) : null}
            {opportunity.pausedAt ? (
              <Fact label={t("pausedAt")} value={formatDate(opportunity.pausedAt, appLocale)} />
            ) : null}
            {opportunity.blockedAt ? (
              <Fact label={t("blockedAt")} value={formatDate(opportunity.blockedAt, appLocale)} />
            ) : null}
          </FactList>
        </CardBody>
      </Card>

      <Card ariaLabel={t("originTitle")}>
        <CardHeader>
          <CardTitle>{t("originTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          {opportunity.fulfillmentCityNameAr || opportunity.fulfillmentCityNameEn ? (
            <FactList>
              <Fact
                label={t("shipsFromCity")}
                value={
                  localized(
                    appLocale,
                    opportunity.fulfillmentCityNameAr,
                    opportunity.fulfillmentCityNameEn
                  ) ?? ""
                }
              />
              <Fact
                label={t("shipsFromRegion")}
                value={
                  localized(
                    appLocale,
                    opportunity.fulfillmentRegionNameAr,
                    opportunity.fulfillmentRegionNameEn
                  ) ?? ""
                }
              />
            </FactList>
          ) : (
            /* The city and region are snapshotted at publish, so a draft
               genuinely has none — that is an answer, not an error. */
            <p className="text-sm text-content-muted">{t("originNotFrozenYet")}</p>
          )}
        </CardBody>
      </Card>

      {localized(appLocale, opportunity.descriptionAr, opportunity.descriptionEn) ? (
        <Card ariaLabel={t("descriptionTitle")}>
          <CardHeader>
            <CardTitle>{t("descriptionTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="whitespace-pre-line text-sm text-content">
              {localized(appLocale, opportunity.descriptionAr, opportunity.descriptionEn)}
            </p>
          </CardBody>
        </Card>
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
