import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierBankAccounts } from "@/lib/supplier-data";
import { formatDate } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Fact, FactList, MaskedValue, StatusWithAction } from "@/components/trader/account-panels";
import { EmptyState, ErrorState } from "@/components/ui/states";

/**
 * Where FORSA sends this supplier's settlement transfers.
 *
 * Unlike the trader's equivalent, this is a REAL read:
 * `supplier_bank_accounts` exists precisely to pay suppliers out, so a
 * supplier has one and needs to see its verification state.
 *
 * The IBAN is never here in full, and not because this page trims it —
 * the endpoint sends `ibanLast4` and nothing else. The stored value is
 * encrypted, and its ciphertext and fingerprint appear in no
 * supplier-facing response. `MaskedValue` takes the suffix ONLY, so a
 * full value cannot be passed to it and relied upon to be hidden.
 *
 * The table is append-only history: a superseded row is kept, so this
 * lists every submission rather than pretending only the current one
 * ever existed.
 */
export default async function SupplierBankAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.account" });
  const status = await getTranslations({ locale: appLocale, namespace: "supplier.status" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const accounts = await loadSupplierBankAccounts();

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
        <h1 className="text-2xl font-semibold text-content">{t("bankAccount.title")}</h1>
        <p className="text-sm text-content-muted">{t("bankAccount.description")}</p>
      </header>

      {!accounts.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={accounts.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : accounts.data.length === 0 ? (
        <EmptyState
          title={t("bankAccount.emptyTitle")}
          description={t("bankAccount.emptyDescription")}
        />
      ) : (
        <ul className="flex list-none flex-col gap-4">
          {accounts.data.map((account) => {
            const verified = account.verifiedAt ? formatDate(account.verifiedAt, appLocale) : null;

            return (
              <li key={account.id}>
                <Card>
                  <CardHeader>
                    <CardTitle>{account.bankName}</CardTitle>
                  </CardHeader>
                  <CardBody>
                    <div className="flex flex-col gap-4">
                      <StatusWithAction
                        label={t("bankAccount.statusLabel")}
                        status={status(`bankAccount.${account.verificationStatus}`)}
                        // Never a bare status. Each one says what happens
                        // next, or what the supplier has to do.
                        action={t(`bankAccount.action.${account.verificationStatus}`)}
                        tone={
                          account.verificationStatus === "VERIFIED"
                            ? "success"
                            : account.verificationStatus === "REJECTED"
                              ? "warning"
                              : "neutral"
                        }
                      />

                      <FactList>
                        <Fact
                          label={t("bankAccount.holder")}
                          value={account.accountHolderName}
                        />
                        <Fact
                          label={t("bankAccount.iban")}
                          value={
                            <MaskedValue
                              last4={account.ibanLast4}
                              srLabel={t("bankAccount.ibanSrLabel")}
                            />
                          }
                        />
                        {verified ? (
                          <Fact label={t("bankAccount.verifiedAt")} value={verified} />
                        ) : null}
                        {account.rejectionReason ? (
                          <Fact
                            label={t("bankAccount.rejectionReason")}
                            value={account.rejectionReason}
                          />
                        ) : null}
                      </FactList>
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
