import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadTraderTaxProfile } from "@/lib/trader-data";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { Fact, FactList, StatusWithAction } from "@/components/trader/account-panels";

/**
 * The billing identity that appears on documents issued to this trader.
 *
 * Read-only in 8D. `PUT /trader/settings/tax-profile` exists, but no
 * editing screen is built yet.
 *
 * Nothing here claims to be a tax invoice, and no VAT status shown on
 * this page is presented as verified or certified — it is what the
 * trader themselves declared, and it is labelled as such.
 */
export default async function TraderTaxProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.account" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const profile = await loadTraderTaxProfile();

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumbLabel")} className="text-sm">
        <Link href={`/${appLocale}/trader/account`} className="text-secondary hover:opacity-90">
          {t("backToAccount")}
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("taxProfile.title")}</h1>
        <p className="text-sm text-content-muted">{t("taxProfile.description")}</p>
      </header>

      {!profile.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={profile.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : profile.data === null ? (
        // Not an error and not an empty list — a real state with a real
        // consequence, so it says what is missing and what it blocks.
        <StatusWithAction
          label={t("taxProfile.statusLabel")}
          status={t("taxProfile.missingStatus")}
          action={t("taxProfile.missingAction")}
          tone="warning"
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t("taxProfile.billingIdentity")}</CardTitle>
          </CardHeader>
          <CardBody>
            <FactList>
              <Fact
                label={t("taxProfile.billingLegalName")}
                value={profile.data.billingLegalName}
              />
              <Fact
                label={t("taxProfile.vatRegistration")}
                value={
                  profile.data.isVatRegistered
                    ? t("taxProfile.vatRegistered")
                    : t("taxProfile.vatNotRegistered")
                }
              />
              {profile.data.isVatRegistered && profile.data.vatNumber ? (
                <Fact
                  label={t("taxProfile.vatNumber")}
                  value={<span dir="ltr">{profile.data.vatNumber}</span>}
                />
              ) : null}
            </FactList>
            <p className="mt-4 text-sm text-content-muted">{t("taxProfile.selfDeclaredNotice")}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
