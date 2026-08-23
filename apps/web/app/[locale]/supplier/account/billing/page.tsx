import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierInvoicingProfile, loadSupplierTaxProfile } from "@/lib/supplier-data";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Fact, FactList } from "@/components/trader/account-panels";
import { EmptyState, ErrorState } from "@/components/ui/states";

/**
 * Billing identity and VAT registration.
 *
 * Two of the three payout preconditions live here, so they are shown
 * together: a supplier told they are "missing an invoicing profile"
 * needs one place to go, not two pages that each hold half the answer.
 *
 * A missing profile is a REAL answer, not an error. Null renders as an
 * empty state naming what is absent; an error state would imply
 * something is broken when nothing is.
 *
 * Nothing here is a tax invoice, claims to be one, or carries a QR
 * code, a PDF or a clearance reference. This page records who the
 * platform's own internal commission documents are addressed to, and
 * says so.
 */
export default async function SupplierBillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.account" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const [invoicing, tax] = await Promise.all([
    loadSupplierInvoicingProfile(),
    loadSupplierTaxProfile(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumbLabel")} className="text-sm">
        <Link
          href={`/${appLocale}/supplier/account`}
          className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
        >
          {t("backToAccount")}
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("billing.title")}</h1>
        <p className="text-sm text-content-muted">{t("billing.description")}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("billing.invoicingTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          {!invoicing.ok ? (
            <ErrorState
              title={states("errorTitle")}
              description={states("errorDescription")}
              requestId={invoicing.error.requestId}
              requestIdLabel={states("requestIdLabel")}
            />
          ) : !invoicing.data ? (
            <EmptyState
              title={t("billing.invoicingEmptyTitle")}
              description={t("billing.invoicingEmptyDescription")}
            />
          ) : (
            <FactList>
              <Fact
                label={t("billing.invoicingLegalName")}
                value={invoicing.data.invoicingLegalName}
              />
            </FactList>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("billing.taxTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          {!tax.ok ? (
            <ErrorState
              title={states("errorTitle")}
              description={states("errorDescription")}
              requestId={tax.error.requestId}
              requestIdLabel={states("requestIdLabel")}
            />
          ) : !tax.data ? (
            <EmptyState
              title={t("billing.taxEmptyTitle")}
              description={t("billing.taxEmptyDescription")}
            />
          ) : (
            <FactList>
              <Fact
                label={t("billing.vatRegistered")}
                value={
                  tax.data.isVatRegistered ? t("billing.vatYes") : t("billing.vatNo")
                }
              />
              {tax.data.vatNumber ? (
                <Fact label={t("billing.vatNumber")} value={tax.data.vatNumber} />
              ) : null}
            </FactList>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
