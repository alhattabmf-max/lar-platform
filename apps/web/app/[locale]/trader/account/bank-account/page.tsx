import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Payment and refund destination.
 *
 * FORSA holds NO bank account for a trader, and this page says so
 * plainly rather than showing an empty "add a bank account" form.
 *
 * That is not a gap in the build — it follows from how money moves.
 * `supplier_bank_accounts` exists to pay SUPPLIERS out at settlement.
 * A trader is on the paying side: they are charged by the payment
 * provider at checkout, and `RefundObligation` is keyed to the
 * `PaymentAttempt` that took the money, so a refund is reversed back
 * to that same payment, never transferred to an IBAN we store.
 *
 * The route exists because the account index links to it, and because
 * "where would my refund go?" is a real question this answers. There
 * is no read here: with nothing stored, there is nothing to fetch, and
 * an endpoint call that always returns an empty list would only make
 * this page able to fail.
 */
export default async function TraderBankAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.account" });

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumbLabel")} className="text-sm">
        <Link href={`/${appLocale}/trader/account`} className="text-secondary hover:opacity-90">
          {t("backToAccount")}
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("bankAccount.title")}</h1>
        <p className="text-sm text-content-muted">{t("bankAccount.description")}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("bankAccount.howPaymentWorks")}</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="flex list-none flex-col gap-3 text-sm text-content">
            <li>{t("bankAccount.paymentPoint")}</li>
            <li>{t("bankAccount.refundPoint")}</li>
            <li>{t("bankAccount.noStoredDetailsPoint")}</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
