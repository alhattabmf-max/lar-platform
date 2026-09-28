import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadProductReports } from "@/lib/admin-data";
import { formatDate, formatDateTime } from "@/lib/localized";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { AdminAction } from "@/components/admin/admin-action";
import { firstParam } from "@/components/admin/admin-pagination";

/**
 * Reports traders have filed about products.
 *
 * FILING A REPORT CHANGES NOTHING ABOUT THE PRODUCT. It stays live,
 * purchasable and unpaused; only this report's own lifecycle moves.
 * Suspending or closing the product is a separate, deliberate act on the
 * products screen. The page says so, because "reported" reads like
 * "taken down" to anyone who has not been told otherwise.
 *
 * EVERY DECISION REQUIRES A NOTE. It is written onto the report as
 * `adminDecisionNote` and is the only thing the trader who filed it is
 * told — a dismissal with no explanation answers nothing.
 *
 * Evidence is listed as metadata: type, size and when it arrived. The
 * storage key is not on the contract and is selected by no query behind
 * this screen.
 */
const REPORT_STATUSES = [
  "OPEN",
  "CLARIFICATION_REQUESTED",
  "DISMISSED",
  "RESOLVED",
] as const;


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
    namespace: "admin.reports",
  });
  return { title: t("title") };
}

export default async function AdminProductReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({
    locale: appLocale,
    namespace: "admin.reports",
  });
  const common = await getTranslations({
    locale: appLocale,
    namespace: "common",
  });
  const filters = await getTranslations({
    locale: appLocale,
    namespace: "admin.filters",
  });
  const toolbar = await getTranslations({
    locale: appLocale,
    namespace: "admin.toolbar",
  });
  const vocab = await getTranslations({
    locale: appLocale,
    namespace: "admin.vocab",
  });

  const status = firstParam(query.status);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
      </header>


      <ListToolbar
        searchable={false}
        labels={{
          regionLabel: toolbar("regionLabel"),
          openLabel: filters("search"),
          searchLabel: filters("search"),
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
              ...REPORT_STATUSES.map((value) => ({
                value,
                label: vocab(`reportStatus.${value}`),
              })),
            ],
          },
        ]}
      />

      <Suspense
        key={status ?? ""}
        fallback={<LoadingState label={common("loading")} rows={5} />}
      >
        <Reports locale={appLocale} status={status} />
      </Suspense>
    </div>
  );
}

async function Reports({
  locale,
  status,
}: {
  locale: AppLocale;
  status?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.reports" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const actions = await getTranslations({ locale, namespace: "admin.actions" });

  const result = await loadProductReports(status);

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

  const note = (label: string, hint: string) => ({
    field: "note",
    label,
    minLength: 5,
    maxLength: 2000,
    hint,
  });

  return (
    <ul className="grid list-none gap-3">
      {result.data.map((report) => {
        // Transcribed from the service's own transitions:
        //   OPEN                    → clarification, dismiss, resolve
        //   CLARIFICATION_REQUESTED → dismiss, resolve
        //   DISMISSED / RESOLVED    → terminal
        const open = report.status === "OPEN";
        const awaiting = report.status === "CLARIFICATION_REQUESTED";
        const decidable = open || awaiting;

        return (
          <li key={report.id}>
            <Card>
              <CardBody>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={vocab(`reportStatus.${report.status}`)}
                      tone={
                        report.status === "OPEN"
                          ? "attention"
                          : report.status === "RESOLVED"
                            ? "done"
                            : "neutral"
                      }
                    />
                    <span className="text-sm text-content-muted">
                      {vocab(`reportReason.${report.reasonCode}`)}
                    </span>
                    <time
                      dateTime={report.createdAt}
                      className="text-sm text-content-muted"
                    >
                      {formatDate(report.createdAt, locale)}
                    </time>
                  </div>

                  {/* The reporter's own words, as text. Never HTML. */}
                  {report.reasonDetails ? (
                    <p className="whitespace-pre-wrap text-sm text-content">
                      {report.reasonDetails}
                    </p>
                  ) : null}

                  {report.evidence.length > 0 ? (
                    <ul className="flex list-none flex-col gap-1">
                      {report.evidence.map((item) => (
                        <li
                          key={item.id}
                          className="text-xs text-content-muted"
                        >
                          {item.contentType} ·{" "}
                          {t("bytes", { size: item.sizeBytes })} ·{" "}
                          <time dateTime={item.createdAt}>
                            {formatDateTime(item.createdAt, locale)}
                          </time>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-content-muted">
                      {t("noEvidence")}
                    </p>
                  )}

                  {report.adminDecisionNote ? (
                    <p className="rounded-md border border-line p-2 text-sm text-content">
                      <span className="text-content-muted">
                        {t("decisionNote")}:{" "}
                      </span>
                      {report.adminDecisionNote}
                    </p>
                  ) : null}

                  {decidable ? (
                    <div className="flex flex-wrap gap-2">
                      {/* Clarification is offered only from OPEN — the
                          service accepts it from nowhere else. */}
                      {open ? (
                        <AdminAction
                          path={`/admin/products/reports/${report.id}/request-clarification`}
                          variant="secondary"
                          reason={note(
                            t("clarificationNote"),
                            t("clarificationHint"),
                          )}
                          labels={{
                            ...actionLabels,
                            action: t("requestClarification"),
                            prompt: t("clarificationPrompt"),
                          }}
                        />
                      ) : null}
                      <AdminAction
                        path={`/admin/products/reports/${report.id}/resolve`}
                        reason={note(t("resolveNote"), t("resolveHint"))}
                        labels={{
                          ...actionLabels,
                          action: t("resolve"),
                          prompt: t("resolvePrompt"),
                        }}
                      />
                      <AdminAction
                        path={`/admin/products/reports/${report.id}/dismiss`}
                        variant="danger"
                        reason={note(t("dismissNote"), t("dismissHint"))}
                        labels={{
                          ...actionLabels,
                          action: t("dismiss"),
                          prompt: t("dismissPrompt"),
                        }}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-content-muted">
                      {t("terminalNotice")}
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
