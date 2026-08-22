import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Account overview.
 *
 * READ-ONLY in 8D. Every write endpoint under `/companies/me/*` exists,
 * but no editing screen is built yet — so there are deliberately no
 * "Edit" buttons here. A button that opens nothing is worse than no
 * button: it promises an action the product cannot perform.
 */
export default async function TraderAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const session = await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.account" });

  const sections = [
    { key: "company", href: `/${appLocale}/trader/account/company` },
    { key: "locations", href: `/${appLocale}/trader/account/locations` },
    { key: "bankAccount", href: `/${appLocale}/trader/account/bank-account` },
    { key: "taxProfile", href: `/${appLocale}/trader/account/tax-profile` },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{session.company.legalName}</p>
      </header>

      <p className="text-sm text-content-muted">{t("readOnlyNotice")}</p>

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
