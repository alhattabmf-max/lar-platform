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
 */
export default async function TraderCompanyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const session = await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.account" });
  const status = await getTranslations({ locale: appLocale, namespace: "trader.status" });

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumbLabel")} className="text-sm">
        <Link href={`/${appLocale}/trader/account`} className="text-secondary hover:opacity-90">
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
