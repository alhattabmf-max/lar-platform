import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import {
  loadSupplierLocations,
  loadSupplierOpportunity,
  loadSupplierProducts,
  loadPolicyLimits,
} from "@/lib/supplier-data";
import { referenceFailureRequestId } from "@/lib/reference-data";
import { opportunityActions, opportunityNextStepKey } from "@/lib/opportunity-actions";
import { opportunityFormFromDetail, reasonField } from "@/lib/opportunity-form";
import { localized } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusWithAction } from "@/components/trader/account-panels";
import { ErrorState } from "@/components/ui/states";
import { OpportunityForm } from "@/components/supplier/opportunity-form";
import { opportunityFormLabels } from "@/components/supplier/opportunity-form-labels";

/**
 * Editing a listing.
 *
 * The form is rendered only in the three statuses `EDITABLE_STATUSES`
 * accepts — DRAFT, SCHEDULED, ACTION_REQUIRED. Everything else gets the
 * reason and a way back rather than a form that cannot be saved.
 *
 * When the listing is ACTION_REQUIRED, its blocking reason is carried into
 * the form and shown ON THE FIELD THAT FIXES IT. Six of the ten reasons map
 * to a field; the other four — an unapproved product, an unverified
 * company, incomplete payout details, an unconfigured tax rate — are fixed
 * elsewhere entirely, and the card above says where.
 */
export default async function EditSupplierOpportunityPage({
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

  const result = await loadSupplierOpportunity(id);
  if (!result.ok && result.notFound) notFound();

  const detailHref = `/${appLocale}/supplier/opportunities/${id}`;

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb href={detailHref} label={t("breadcrumbLabel")} back={t("backToOpportunity")} />
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

  if (!gate.canUpdate) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb href={detailHref} label={t("breadcrumbLabel")} back={t("backToOpportunity")} />

        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-content">{t("edit.title")}</h1>
          <p className="text-sm text-content-muted">{name}</p>
        </header>

        <Card ariaLabel={t("edit.lockedTitle")} className="border-warning">
          <CardHeader>
            <CardTitle>{t("edit.lockedTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <StatusWithAction
              label={t("statusLabel")}
              status={status(`opportunity.${opportunity.status}`)}
              action={t(`nextStep.${opportunityNextStepKey(opportunity.status)}`)}
              tone="warning"
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  const [products, locations, policyLimits] = await Promise.all([
    loadSupplierProducts(),
    loadSupplierLocations(),
    loadPolicyLimits(),
  ]);

  const publishable = products.ok
    ? products.data.filter(
        (product) =>
          (product.approvalStatus === "APPROVED" && product.archivedAt === null) ||
          // The currently linked product stays selectable even if it has
          // since been suspended or archived — removing it would silently
          // change the listing's product on the next save.
          product.id === opportunity.productId
      )
    : [];

  // Named only when a FIELD can fix it; the other four reasons are fixed
  // elsewhere and the card above already says so.
  const inlineReason =
    opportunity.status === "ACTION_REQUIRED" && opportunity.reasonCode
      ? opportunity.reasonCode
      : null;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb href={detailHref} label={t("breadcrumbLabel")} back={t("backToOpportunity")} />

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("edit.title")}</h1>
        <p className="text-sm text-content-muted">{name}</p>
      </header>

      {inlineReason ? (
        <Card ariaLabel={t("edit.blockedTitle")} className="border-warning">
          <CardHeader>
            <CardTitle>{t("edit.blockedTitle")}</CardTitle>
          </CardHeader>
          <CardBody>
            <StatusWithAction
              label={t("statusLabel")}
              status={status(`opportunityReason.${inlineReason}`)}
              action={t(`reasonFix.${inlineReason}`)}
              tone="warning"
            />
            {reasonField(inlineReason) === null ? (
              // Nothing on this form fixes it. Said plainly rather than
              // leaving someone to hunt through the fields.
              <p className="mt-3 text-sm text-content-muted">{t("edit.fixedElsewhere")}</p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {!products.ok || !locations.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={referenceFailureRequestId(products, locations)}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : (
        <OpportunityForm
          // Undefined when the policy read failed — the form then
          // states that bounds exist without naming figures.
          limits={policyLimits.ok ? policyLimits.data.opportunity : undefined}
          mode="edit"
          locale={appLocale}
          opportunityId={opportunity.id}
          initialValues={opportunityFormFromDetail(opportunity)}
          products={publishable}
          locations={locations.data}
          backHref={detailHref}
          reasonCode={inlineReason}
          labels={await opportunityFormLabels(appLocale, policyLimits.ok ? policyLimits.data.opportunity : undefined)}
        />
      )}
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
