import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierLocations, loadSupplierProducts } from "@/lib/supplier-data";
import { referenceFailureRequestId } from "@/lib/reference-data";
import { EMPTY_OPPORTUNITY_FORM } from "@/lib/opportunity-form";
import { ErrorState } from "@/components/ui/states";
import { OpportunityForm } from "@/components/supplier/opportunity-form";
import { opportunityFormLabels } from "@/components/supplier/opportunity-form-labels";

/**
 * Creating a listing.
 *
 * SAVING IS NOT PUBLISHING. The listing is created as a DRAFT and traders
 * see nothing: publishing is a separate action that runs the eligibility
 * checks — a verified company, an approved product, an active location, a
 * configured tax rate, a quantity that divides into whole shares — and any
 * one of them can refuse it. The steps stay separate because they are.
 *
 * The product picker offers APPROVED, unarchived products ONLY. Publishing
 * requires an approved snapshot, so a listing built on anything else could
 * be saved and never published — and the picker would have been the thing
 * that suggested it.
 */
export default async function NewSupplierOpportunityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.opportunities" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const [products, locations] = await Promise.all([
    loadSupplierProducts(),
    loadSupplierLocations(),
  ]);

  const backHref = `/${appLocale}/supplier/opportunities`;

  // Only what can actually be published on.
  const publishable = products.ok
    ? products.data.filter(
        (product) => product.approvalStatus === "APPROVED" && product.archivedAt === null
      )
    : [];

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumbLabel")} className="text-sm">
        <Link
          href={backHref}
          className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
        >
          {t("backToList")}
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("new.title")}</h1>
        <p className="text-sm text-content-muted">{t("new.description")}</p>
      </header>

      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-content">{t("new.nextStepsTitle")}</h2>
        <ol className="mt-2 flex list-decimal flex-col gap-1 ps-5 text-sm text-content-muted">
          <li>{t("new.step1")}</li>
          <li>{t("new.step2")}</li>
          <li>{t("new.step3")}</li>
        </ol>
      </div>

      {!products.ok || !locations.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={referenceFailureRequestId(products, locations)}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : (
        <OpportunityForm
          mode="create"
          locale={appLocale}
          initialValues={EMPTY_OPPORTUNITY_FORM}
          products={publishable}
          locations={locations.data}
          backHref={backHref}
          labels={await opportunityFormLabels(appLocale)}
        />
      )}
    </div>
  );
}
