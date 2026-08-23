import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { BANK_ACCOUNT_VERIFICATION_STATUSES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminBankAccounts, loadPendingBankAccounts } from "@/lib/admin-data";
import { formatDate } from "@/lib/localized";
import { Card, CardBody } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { AdminFilters } from "@/components/admin/admin-filters";
import { AdminAction } from "@/components/admin/admin-action";
import {
  AdminPagination,
  adminPaginationLabels,
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";

/**
 * Supplier bank accounts: the review queue, then the whole history.
 *
 * `ibanLast4` AND NOTHING MORE. The stored IBAN is encrypted, and
 * neither its ciphertext nor its blind-index fingerprint is selected by
 * any query behind these screens. The decryption service is reachable
 * from no HTTP path at all — an operator approving an account checks the
 * holder's name, the bank and the last four digits, which is what the
 * submitted evidence shows.
 *
 * Approving one account DEACTIVATES the company's previous active
 * account, because a company has exactly one account payouts go to. That
 * consequence is stated in the confirmation, before the operator
 * commits.
 *
 * Rejection requires a written reason: the supplier receives it, and it
 * is the only thing telling them whether to resubmit with a different
 * document or a different account.
 */
const PAGE_SIZE = 25;

export default async function AdminBankAccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.bankAccounts" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });
  const filters = await getTranslations({ locale: appLocale, namespace: "admin.filters" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });

  const page = parseAdminPage(query.page);
  const search = firstParam(query.search);
  const verificationStatus = firstParam(query.verificationStatus);
  const basePath = `/${appLocale}/admin/bank-accounts`;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("queueTitle")}</h2>
        <Suspense fallback={<LoadingState label={common("loading")} rows={3} />}>
          <ReviewQueue locale={appLocale} />
        </Suspense>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("historyTitle")}</h2>

        <AdminFilters
          action={basePath}
          search={{ name: "search", label: filters("searchSupplier"), value: search }}
          selects={[
            {
              name: "verificationStatus",
              label: t("status"),
              value: verificationStatus,
              options: [
                { value: "", label: filters("any") },
                ...BANK_ACCOUNT_VERIFICATION_STATUSES.map((value) => ({
                  value,
                  label: vocab(`bankStatus.${value}`),
                })),
              ],
            },
          ]}
          labels={{
            regionLabel: filters("regionLabel"),
            apply: filters("apply"),
            clear: filters("clear"),
          }}
        />

        <Suspense
          key={`${page}:${search ?? ""}:${verificationStatus ?? ""}`}
          fallback={<LoadingState label={common("loading")} rows={6} />}
        >
          <History
            locale={appLocale}
            basePath={basePath}
            page={page}
            search={search}
            verificationStatus={verificationStatus}
          />
        </Suspense>
      </section>
    </div>
  );
}

async function ReviewQueue({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.bankAccounts" });
  const states = await getTranslations({ locale, namespace: "states" });
  const actions = await getTranslations({ locale, namespace: "admin.actions" });

  const result = await loadPendingBankAccounts();

  if (!result.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={result.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  if (result.data.length === 0) {
    return <EmptyState title={t("queueEmptyTitle")} description={t("queueEmptyDescription")} />;
  }

  const actionLabels = {
    confirm: actions("confirm"),
    cancel: actions("cancel"),
    working: actions("working"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
  };

  return (
    <ul className="grid list-none gap-3">
      {result.data.map((account) => (
        <li key={account.id}>
          <Card>
            <CardBody>
              <div className="flex flex-col gap-3">
                <p className="text-base font-medium text-content">{account.companyLegalName}</p>

                <dl className="grid gap-1 text-sm sm:grid-cols-3">
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("accountHolder")}</dt>
                    <dd className="text-content">{account.accountHolderName}</dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("bank")}</dt>
                    <dd className="text-content">{account.bankName}</dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("ibanLast4")}</dt>
                    {/* The last four digits. The full IBAN is encrypted
                        and is not selected by any query behind this
                        page. */}
                    <dd className="font-mono text-content">{account.ibanLast4}</dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("submittedAt")}</dt>
                    <dd className="text-content">
                      <time dateTime={account.createdAt}>
                        {formatDate(account.createdAt, locale)}
                      </time>
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-wrap gap-2">
                  <AdminAction
                    path={`/admin/bank-accounts/${account.id}/approve`}
                    labels={{
                      ...actionLabels,
                      action: t("approve"),
                      // States the consequence: approving replaces the
                      // company's current payout destination.
                      prompt: t("approvePrompt", { company: account.companyLegalName }),
                    }}
                  />
                  <AdminAction
                    path={`/admin/bank-accounts/${account.id}/reject`}
                    variant="danger"
                    reason={{
                      field: "reason",
                      label: t("rejectReason"),
                      minLength: 5,
                      maxLength: 2000,
                      hint: t("rejectReasonHint"),
                    }}
                    labels={{
                      ...actionLabels,
                      action: t("reject"),
                      prompt: t("rejectPrompt", { company: account.companyLegalName }),
                    }}
                  />
                </div>
              </div>
            </CardBody>
          </Card>
        </li>
      ))}
    </ul>
  );
}

async function History({
  locale,
  basePath,
  page,
  search,
  verificationStatus,
}: {
  locale: AppLocale;
  basePath: string;
  page: number;
  search?: string;
  verificationStatus?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.bankAccounts" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminBankAccounts({
    page,
    pageSize: PAGE_SIZE,
    search,
    verificationStatus,
  });

  if (!result.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={result.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  if (result.data.total === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <Table caption={t("tableCaption")}>
          <THead>
            <TR>
              <TH>{t("submittedAt")}</TH>
              <TH>{t("company")}</TH>
              <TH>{t("accountHolder")}</TH>
              <TH>{t("bank")}</TH>
              <TH>{t("ibanLast4")}</TH>
              <TH>{t("status")}</TH>
              <TH>{t("rejectionReason")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((account) => (
              <TR key={account.id}>
                <TD>
                  <time dateTime={account.createdAt}>
                    {formatDate(account.createdAt, locale)}
                  </time>
                </TD>
                <TD>{account.companyLegalName}</TD>
                <TD>{account.accountHolderName}</TD>
                <TD>{account.bankName}</TD>
                <TD className="font-mono">{account.ibanLast4}</TD>
                <TD>
                  <StatusBadge
                    label={vocab(`bankStatus.${account.verificationStatus}`)}
                    tone={
                      account.verificationStatus === "VERIFIED"
                        ? "done"
                        : account.verificationStatus === "PENDING_VERIFICATION"
                          ? "attention"
                          : "neutral"
                    }
                  />
                </TD>
                <TD className="whitespace-pre-wrap">{account.rejectionReason ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <AdminPagination
        basePath={basePath}
        page={result.data.page}
        pageSize={result.data.pageSize}
        total={result.data.total}
        query={{ search, verificationStatus }}
        labels={adminPaginationLabels(
          pagination,
          result.data.page,
          result.data.pageSize,
          result.data.total
        )}
      />
    </div>
  );
}
