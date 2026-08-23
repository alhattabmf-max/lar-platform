import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadFinancialReadiness } from "@/lib/supplier-data";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusWithAction } from "@/components/trader/account-panels";
import { ErrorState, LoadingState } from "@/components/ui/states";

/**
 * Account overview.
 *
 * READ-ONLY in 8E.3. Every write endpoint under `/companies/me/*`
 * exists, but no editing screen is built yet — so there are
 * deliberately no "Edit" buttons here. A button that opens nothing is
 * worse than no button: it promises an action the product cannot
 * perform.
 *
 * Payout readiness leads, because it is the one thing on this page
 * that can stop money reaching the supplier. It is three separate
 * preconditions rather than one flag, so the page can name the missing
 * one instead of saying "not ready" and leaving someone to guess.
 */
export default async function SupplierAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const session = await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.account" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  const sections = [
    { key: "company", href: `/${appLocale}/supplier/account/company` },
    { key: "bankAccount", href: `/${appLocale}/supplier/account/bank-account` },
    { key: "billing", href: `/${appLocale}/supplier/account/billing` },
    { key: "locations", href: `/${appLocale}/supplier/account/locations` },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{session.company.legalName}</p>
      </header>

      <p className="text-sm text-content-muted">{t("readOnlyNotice")}</p>

      <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
        <ReadinessPanel locale={appLocale} />
      </Suspense>

      <ul className="grid list-none gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <li key={section.key}>
            <Card>
              <CardHeader>
                <CardTitle>
                  <Link href={section.href} className="text-secondary hover:opacity-90">
                    {t(`${section.key}.title`)}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-sm text-content-muted">{t(`${section.key}.description`)}</p>
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Whether this company can be paid, and what is missing if not.
 *
 * Each precondition names the page that resolves it, and every one of
 * those pages exists — a readiness item pointing at an unbuilt screen
 * would tell someone to fix something and then leave them nowhere to
 * fix it.
 */
async function ReadinessPanel({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.account" });
  const states = await getTranslations({ locale, namespace: "states" });

  const readiness = await loadFinancialReadiness();

  if (!readiness.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={readiness.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  const { isReady, hasVerifiedBankAccount, hasTaxProfile, hasInvoicingProfile } = readiness.data;

  const missing = [
    { key: "bankAccount", done: hasVerifiedBankAccount, href: "bank-account" },
    { key: "taxProfile", done: hasTaxProfile, href: "billing" },
    { key: "invoicingProfile", done: hasInvoicingProfile, href: "billing" },
  ] as const;

  return (
    <Card ariaLabel={t("readiness.title")} className={isReady ? undefined : "border-warning"}>
      <CardHeader>
        <CardTitle>{t("readiness.title")}</CardTitle>
      </CardHeader>
      <CardBody>
        {isReady ? (
          <StatusWithAction
            label={t("readiness.label")}
            status={t("readiness.readyStatus")}
            action={t("readiness.readyAction")}
            tone="success"
          />
        ) : (
          <div className="flex flex-col gap-3">
            <StatusWithAction
              label={t("readiness.label")}
              status={t("readiness.notReadyStatus")}
              action={t("readiness.notReadyAction")}
              tone="warning"
            />
            <ul className="flex list-none flex-col gap-2">
              {missing
                .filter((item) => !item.done)
                .map((item) => (
                  <li key={item.key} className="text-sm">
                    <Link
                      href={`/${locale}/supplier/account/${item.href}`}
                      className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                    >
                      {t(`readiness.missing.${item.key}`)}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
