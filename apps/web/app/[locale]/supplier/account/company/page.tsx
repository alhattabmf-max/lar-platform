import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Fact, FactList } from "@/components/trader/account-panels";

/**
 * Company identity, read from the session's own `/me` response.
 *
 * No extra request: `/me` already carries every field shown here, and
 * fetching the same data twice would only add a way for the two to
 * disagree.
 *
 * The panels come from `components/trader/account-panels` — shared
 * presentation, not shared data. The rules they encode (a masked
 * identifier can only ever be a suffix; a status must carry its next
 * step) are the same rules on both sides of the marketplace.
 */
export default async function SupplierCompanyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const session = await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.account" });
  const status = await getTranslations({ locale: appLocale, namespace: "supplier.status" });

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

      <h1 className="text-2xl font-semibold text-content">{t("company.title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("company.identity")}</CardTitle>
        </CardHeader>
        <CardBody>
          <FactList>
            <Fact label={t("company.legalName")} value={session.company.legalName} />
            <Fact label={t("company.crNumber")} value={session.company.crNumber} />
            <Fact
              label={t("company.verification")}
              value={status(`companyVerification.${session.company.verificationStatus}`)}
            />
            <Fact label={t("company.email")} value={session.email} />
            <Fact
              label={t("company.emailVerification")}
              value={status(`emailVerification.${session.emailVerificationStatus}`)}
            />
          </FactList>
        </CardBody>
      </Card>
    </div>
  );
}
