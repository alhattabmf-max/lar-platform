import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ADMIN_USER_STATUSES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminUsers } from "@/lib/admin-data";
import { formatDate } from "@/lib/localized";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { AdminAction } from "@/components/admin/admin-action";
import { AdminOwnAccount } from "@/components/admin/admin-own-account";
import {
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";
import { DataTablePagination } from "@/components/admin/data-table-pagination";
import { parsePageSize } from "@/lib/admin-list-query";

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


/**
 * The tab's name. The layout supplies « | لوحة التحكم ».
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as AppLocale,
    namespace: "admin.adminUsers",
  });
  return { title: t("title") };
}

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

  const t = await getTranslations({
    locale: appLocale,
    namespace: "admin.adminUsers",
  });
  const common = await getTranslations({
    locale: appLocale,
    namespace: "common",
  });
  const toolbar = await getTranslations({
    locale: appLocale,
    namespace: "admin.toolbar",
  });
  const filters = await getTranslations({
    locale: appLocale,
    namespace: "admin.filters",
  });
  const vocab = await getTranslations({
    locale: appLocale,
    namespace: "admin.vocab",
  });

  const page = parseAdminPage(query.page);
  const pageSize = parsePageSize(query.pageSize);
  const search = firstParam(query.search);
  const status = firstParam(query.status);

  return (
    <div className="flex flex-col gap-8">
      {/* STILL A HEADING, just not a second copy of the sidebar.
          Reading it off the screen was redundant; reading it with a
          screen reader is how somebody knows which page they landed
          on, because they cannot see which sidebar entry is lit. */}
      <h1 className="sr-only">{t("title")}</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">
          {t("ownAccountTitle")}
        </h2>
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
        <h2 className="text-lg font-semibold text-content">
          {t("directoryTitle")}
        </h2>

        <ListToolbar
          labels={{
            regionLabel: toolbar("regionLabel"),
          openLabel: filters("search"),
            searchLabel: filters("searchEmail"),
            searchPlaceholder: toolbar("searchPlaceholder"),
            filtersPanelLabel: toolbar("filtersPanelLabel"),
            reset: toolbar("reset"),
          }}
          selects={[
            {
              name: "status",
              label: t("status"),
              options: [
                { value: "", label: filters("any") },
                ...ADMIN_USER_STATUSES.map((value) => ({
                  value,
                  label: vocab(`adminStatus.${value}`),
                })),
              ],
            },
          ]}
        />

        <Suspense
          key={`${page}:${search ?? ""}:${status ?? ""}`}
          fallback={<LoadingState label={common("loading")} rows={5} />}
        >
          <Directory
            locale={appLocale}
            page={page}
            pageSize={pageSize}
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
  page,
  pageSize,
  search,
  status,
  selfId,
}: {
  locale: AppLocale;
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  selfId: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.adminUsers" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const actions = await getTranslations({ locale, namespace: "admin.actions" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });
  const toolbar = await getTranslations({ locale, namespace: "admin.toolbar" });

  const result = await loadAdminUsers({ page, pageSize, search, status });

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
    return (
      <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
    );
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
                    <time dateTime={admin.createdAt}>
                      {formatDate(admin.createdAt, locale)}
                    </time>
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
                            reason={reason(
                              t("disableReason"),
                              t("disableHint"),
                            )}
                            labels={{
                              ...actionLabels,
                              action: t("disable"),
                              prompt: t("disablePrompt", {
                                email: admin.email,
                              }),
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

      <DataTablePagination
        page={result.data.page}
        pageSize={result.data.pageSize}
        total={result.data.total}
        labels={{
          navLabel: pagination("navLabel"),
          first: pagination("first"),
          previous: pagination("previous"),
          next: pagination("next"),
          last: pagination("last"),
          rowsPerPage: toolbar("rowsPerPage"),
          rowsPerPageUnit: toolbar("rowsPerPageUnit"),
          range: pagination("range", {
            from: (result.data.page - 1) * result.data.pageSize + 1,
            to: Math.min(
              result.data.page * result.data.pageSize,
              result.data.total,
            ),
            total: result.data.total,
          }),
        }}
      />
    </div>
  );
}
