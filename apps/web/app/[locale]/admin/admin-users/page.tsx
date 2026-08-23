import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ADMIN_USER_STATUSES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminUsers } from "@/lib/admin-data";
import { formatDate } from "@/lib/localized";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { AdminFilters } from "@/components/admin/admin-filters";
import { AdminAction } from "@/components/admin/admin-action";
import { AdminOwnAccount } from "@/components/admin/admin-own-account";
import {
  AdminPagination,
  adminPaginationLabels,
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";

/**
 * Administrator accounts, and the operator's own credentials.
 *
 * THERE IS NO "CREATE ADMINISTRATOR" BUTTON, and that is deliberate.
 * Admin accounts are created by the bootstrap CLI, on the machine, by
 * someone with shell access — not over HTTP by whoever is currently
 * signed in. A self-service creation endpoint would make one
 * compromised admin session enough to mint a permanent second one, and
 * the page says so rather than leaving the absence to be read as an
 * oversight.
 *
 * `recoveryCodesRemaining` is a COUNT and never the codes. The
 * plaintext exists exactly once, at the moment it is issued; only
 * hashes are stored, so no screen can show them again.
 *
 * The operator's OWN row carries no disable button. The server refuses
 * self-disable — locking yourself out of the console is not a recoverable
 * mistake — so the control is not drawn.
 */
const PAGE_SIZE = 25;

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const appLocale = locale as AppLocale;
  const session = await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.adminUsers" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });
  const filters = await getTranslations({ locale: appLocale, namespace: "admin.filters" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });

  const page = parseAdminPage(query.page);
  const search = firstParam(query.search);
  const status = firstParam(query.status);
  const basePath = `/${appLocale}/admin/admin-users`;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("ownAccountTitle")}</h2>
        <AdminOwnAccount
          email={session.email}
          twoFactorEnabled={session.twoFactorEnabled}
          labels={{
            email: t("email"),
            twoFactor: t("twoFactor"),
            twoFactorOn: t("twoFactorOn"),
            twoFactorOff: t("twoFactorOff"),

            changePassword: t("changePassword"),
            currentPassword: t("currentPassword"),
            newPassword: t("newPassword"),
            passwordHint: t("passwordHint"),
            passwordSaved: t("passwordSaved"),
            signedOutElsewhere: t("signedOutElsewhere"),

            regenerate: t("regenerate"),
            regenerateWarning: t("regenerateWarning"),
            regeneratedTitle: t("regeneratedTitle"),
            regeneratedWarning: t("regeneratedWarning"),

            submit: t("submit"),
            cancel: t("cancel"),
            working: t("working"),
            required: t("required"),
            errorTitle: t("errorTitle"),
            requestIdLabel: t("requestIdLabel"),
          }}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("directoryTitle")}</h2>
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-content-muted">
          {t("creationNotice")}
        </p>

        <AdminFilters
          action={basePath}
          search={{ name: "search", label: filters("searchEmail"), value: search }}
          selects={[
            {
              name: "status",
              label: t("status"),
              value: status,
              options: [
                { value: "", label: filters("any") },
                ...ADMIN_USER_STATUSES.map((value) => ({
                  value,
                  label: vocab(`adminStatus.${value}`),
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
          key={`${page}:${search ?? ""}:${status ?? ""}`}
          fallback={<LoadingState label={common("loading")} rows={5} />}
        >
          <Directory
            locale={appLocale}
            basePath={basePath}
            page={page}
            search={search}
            status={status}
            selfId={session.id}
          />
        </Suspense>
      </section>
    </div>
  );
}

async function Directory({
  locale,
  basePath,
  page,
  search,
  status,
  selfId,
}: {
  locale: AppLocale;
  basePath: string;
  page: number;
  search?: string;
  status?: string;
  selfId: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.adminUsers" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const actions = await getTranslations({ locale, namespace: "admin.actions" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminUsers({ page, pageSize: PAGE_SIZE, search, status });

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

  const actionLabels = {
    confirm: actions("confirm"),
    cancel: actions("cancel"),
    working: actions("working"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
  };

  const reason = (label: string, hint: string) => ({
    field: "reason",
    label,
    minLength: 5,
    maxLength: 2000,
    hint,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <Table caption={t("tableCaption")}>
          <THead>
            <TR>
              <TH>{t("email")}</TH>
              <TH>{t("status")}</TH>
              <TH>{t("twoFactor")}</TH>
              <TH>{t("recoveryCodes")}</TH>
              <TH>{t("createdAt")}</TH>
              <TH>{t("actionsColumn")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((admin) => {
              const isSelf = admin.id === selfId;

              return (
                <TR key={admin.id}>
                  <TD className="break-all">
                    <span className="flex flex-wrap items-center gap-2">
                      {admin.email}
                      {isSelf ? <StatusBadge label={t("you")} /> : null}
                    </span>
                  </TD>
                  <TD>
                    <StatusBadge
                      label={vocab(`adminStatus.${admin.status}`)}
                      tone={admin.status === "ACTIVE" ? "done" : "attention"}
                    />
                  </TD>
                  <TD>
                    {admin.twoFactorEnabled ? (
                      <StatusBadge label={t("twoFactorOn")} tone="done" />
                    ) : (
                      // Not enrolled is a finding, not a neutral fact:
                      // this account signs in with a password alone
                      // until it enrols.
                      <StatusBadge label={t("twoFactorOff")} tone="attention" />
                    )}
                  </TD>
                  {/* A count. The codes themselves exist once, at
                      issue; only hashes are stored. */}
                  <TD>{admin.recoveryCodesRemaining}</TD>
                  <TD>
                    <time dateTime={admin.createdAt}>{formatDate(admin.createdAt, locale)}</time>
                  </TD>
                  <TD>
                    {isSelf ? (
                      // The server refuses self-disable and self-2FA
                      // reset. Drawing them would be drawing controls
                      // that cannot work.
                      <span className="text-sm text-content-muted">—</span>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {admin.status === "ACTIVE" ? (
                          <AdminAction
                            path={`/admin/admin-users/${admin.id}/disable`}
                            variant="danger"
                            reason={reason(t("disableReason"), t("disableHint"))}
                            labels={{
                              ...actionLabels,
                              action: t("disable"),
                              prompt: t("disablePrompt", { email: admin.email }),
                            }}
                          />
                        ) : (
                          <AdminAction
                            path={`/admin/admin-users/${admin.id}/enable`}
                            reason={reason(t("enableReason"), t("enableHint"))}
                            labels={{
                              ...actionLabels,
                              action: t("enable"),
                              prompt: t("enablePrompt", { email: admin.email }),
                            }}
                          />
                        )}

                        {/* Offered only where there is 2FA to reset.
                            Resetting it means the next sign-in enrols a
                            new authenticator, so it is how a colleague
                            who lost their phone gets back in. */}
                        {admin.twoFactorEnabled ? (
                          <AdminAction
                            path={`/admin/admin-users/${admin.id}/reset-2fa`}
                            variant="secondary"
                            reason={reason(t("resetReason"), t("resetHint"))}
                            labels={{
                              ...actionLabels,
                              action: t("resetTwoFactor"),
                              prompt: t("resetPrompt", { email: admin.email }),
                            }}
                          />
                        ) : null}
                      </div>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>

      <AdminPagination
        basePath={basePath}
        page={result.data.page}
        pageSize={result.data.pageSize}
        total={result.data.total}
        query={{ search, status }}
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
