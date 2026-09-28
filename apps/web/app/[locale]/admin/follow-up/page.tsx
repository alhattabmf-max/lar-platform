import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { AlertCircle, ClipboardList, Clock, Users } from "lucide-react";
import {
  DASHBOARD_PERIODS,
  FOLLOW_UP_CASE_KINDS,
  FOLLOW_UP_PRIORITIES,
} from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadFollowUpBoard } from "@/lib/admin-data";
import { formatDateTime } from "@/lib/localized";
import { ErrorState } from "@/components/ui/states";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { PeriodPicker, MetricCard } from "@/components/admin/dashboard-chrome";
import { FollowUpTable } from "@/components/admin/follow-up-table";
import { ExportToExcel } from "@/components/admin/export-to-excel";
import { exportLabelQuery } from "@/lib/admin-export-query";
import { parsePageSize } from "@/lib/admin-list-query";
import {
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";

/**
 * The cases that need an administrator.
 *
 * NOT A NOTIFICATION CENTRE. Every row here is an operational state
 * derived from a record — an unresolved dispute, a delivered allocation
 * nobody settled, a supplier waiting on verification — and it leaves
 * this list only when that record changes. Opening it, assigning it, or
 * marking it in progress does not close it, because there is no closed
 * flag anywhere for those actions to set.
 *
 * THE FOUR CARDS ARE COUNTED FROM THE SAME LIST the table renders, so a
 * heading and the rows under it cannot disagree.
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
    namespace: "admin.followUp",
  });
  return { title: t("title") };
}

export default async function FollowUpPage({
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
    namespace: "admin.followUp",
  });
  const overview = await getTranslations({
    locale: appLocale,
    namespace: "admin.overview",
  });
  const filters = await getTranslations({
    locale: appLocale,
    namespace: "admin.filters",
  });
  const toolbar = await getTranslations({
    locale: appLocale,
    namespace: "admin.toolbar",
  });
  const states = await getTranslations({
    locale: appLocale,
    namespace: "states",
  });
  const actions = await getTranslations({
    locale: appLocale,
    namespace: "admin.actions",
  });

  const raw = firstParam(query.period);
  const period = (DASHBOARD_PERIODS as readonly string[]).includes(raw ?? "")
    ? (raw as string)
    : "30d";

  const result = await loadFollowUpBoard({
    period,
    search: firstParam(query.search),
    priority: firstParam(query.priority),
    kind: firstParam(query.kind),
    assignee: firstParam(query.assignee),
    page: parseAdminPage(query.page),
    pageSize: parsePageSize(query.pageSize),
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

  const data = result.data;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* NO TRAIL — see the orders screen. */}
      <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>

      {/* COUNTED FROM THE LIST BELOW, never from a separate query. */}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          testId="card-total"
          icon={<ClipboardList className="size-5" />}
          label={t("total")}
          value={String(data.summary.total)}
        />
        <MetricCard
          testId="card-review"
          icon={<Users className="size-5" />}
          label={t("review")}
          value={String(data.summary.review)}
        />
        <MetricCard
          testId="card-overdue"
          icon={<Clock className="size-5" />}
          label={t("overdue")}
          value={String(data.summary.overdue)}
          accent="accent"
        />
        <MetricCard
          testId="card-critical"
          icon={<AlertCircle className="size-5" />}
          label={t("critical")}
          value={String(data.summary.critical)}
        />
      </div>

      <ListToolbar
        // ON THE SEARCH ROW, at the opposite end. These stood in a
        // header row of their own, which cost a row of the page for
        // two controls.
        actions={
          <div className="flex flex-wrap items-center gap-3">
              <PeriodPicker
                period={period}
                generatedAt={formatDateTime(data.generatedAt, appLocale) ?? "—"}
                labels={{
                  label: overview("periodLabel"),
                  comparison: overview("comparison"),
                  lastUpdated: overview("lastUpdated"),
                  refresh: overview("refresh"),
                  options: Object.fromEntries(
                    DASHBOARD_PERIODS.map((value) => [
                      value,
                      overview(`period.${value}`),
                    ]),
                  ),
                }}
              />
              <ExportToExcel
                path={`/admin/follow-up/export?period=${period}&${exportLabelQuery({
                  columns: [
                    t("caseStatus"),
                    t("priorityLabel"),
                    t("item"),
                    t("duration"),
                    t("assigneeLabel"),
                    t("inProgressBadge"),
                  ],
                  fileLabel: t("exportFile"),
                  date: today,
                  actions: Object.fromEntries(
                    FOLLOW_UP_CASE_KINDS.map((kind) => [
                      kind,
                      t(`caseName.${kind}`),
                    ]),
                  ),
                  statuses: Object.fromEntries(
                    FOLLOW_UP_PRIORITIES.map((value) => [
                      value,
                      overview(`priority.${value}`),
                    ]),
                  ),
                  passwordSet: t("inProgressBadge"),
                  passwordPending: "—",
                }).toString()}`}
                disabled={data.total === 0}
                testId="export-follow-up"
                labels={{
                  action: filters("export"),
                  working: actions("working"),
                  empty: t("emptyTitle"),
                  errorTitle: states("errorTitle"),
                  requestIdLabel: states("requestIdLabel"),
                }}
              />
            </div>
        }
        labels={{
          regionLabel: toolbar("regionLabel"),
          openLabel: filters("search"),
          searchLabel: filters("search"),
          searchPlaceholder: t("searchPlaceholder"),
          filtersPanelLabel: toolbar("filtersPanelLabel"),
          reset: toolbar("reset"),
        }}
        selects={[
          {
            name: "priority",
            label: t("priorityLabel"),
            options: [
              { value: "", label: t("all") },
              ...FOLLOW_UP_PRIORITIES.map((value) => ({
                value,
                label: overview(`priority.${value}`),
              })),
            ],
          },
          {
            name: "kind",
            label: t("kindLabel"),
            options: [
              { value: "", label: t("all") },
              ...FOLLOW_UP_CASE_KINDS.map((value) => ({
                value,
                label: t(`caseName.${value}`),
              })),
            ],
          },
          {
            name: "assignee",
            label: t("assigneeLabel"),
            options: [
              { value: "", label: t("all") },
              { value: "UNASSIGNED", label: t("unassigned") },
              ...data.assignees.map((admin) => ({
                value: admin.id,
                label: admin.name,
              })),
            ],
          },
        ]}
      />

      <FollowUpTable
        locale={appLocale}
        cases={data.cases}
        // WORDED HERE, ON THE SERVER. Two days or more reads in days,
        // anything shorter in hours — the same rule as before, moved to
        // the side of the boundary that holds the message catalogue.
        ages={Object.fromEntries(
          data.cases.map((row) => [
            row.id,
            row.ageHours >= 48
              ? t("sinceDays", { days: String(Math.floor(row.ageHours / 24)) })
              : t("sinceHours", { hours: String(row.ageHours) }),
          ]),
        )}
        assignees={data.assignees}
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        labels={{
          caseStatus: t("caseStatus"),
          priority: t("priorityLabel"),
          item: t("item"),
          duration: t("duration"),
          assignee: t("assigneeLabel"),
          action: t("action"),
          selectRow: t("selectRow"),
          selectAll: t("selectAll"),
          assignAction: t("assignAction"),
          markInProgress: t("markInProgress"),
          unassigned: t("unassigned"),
          inProgressBadge: t("inProgressBadge"),
          emptyTitle: t("emptyTitle"),
          emptyDescription: t("emptyDescription"),
          tableCaption: t("tableCaption"),
          working: actions("working"),
          cancel: actions("cancel"),
          confirm: actions("confirm"),
          errorTitle: states("errorTitle"),
          requestIdLabel: states("requestIdLabel"),
          priorities: Object.fromEntries(
            FOLLOW_UP_PRIORITIES.map((value) => [
              value,
              overview(`priority.${value}`),
            ]),
          ),
          caseNames: Object.fromEntries(
            FOLLOW_UP_CASE_KINDS.map((value) => [
              value,
              t(`caseName.${value}`),
            ]),
          ),
          openActions: Object.fromEntries(
            FOLLOW_UP_CASE_KINDS.map((value) => [
              value,
              t(`openAction.${value}`),
            ]),
          ),
          rowsPerPage: toolbar("rowsPerPage"),
          rowsPerPageUnit: toolbar("rowsPerPageUnit"),
        }}
        pagination={{
          navLabel: (
            await getTranslations({
              locale: appLocale,
              namespace: "pagination",
            })
          )("navLabel"),
          first: (
            await getTranslations({
              locale: appLocale,
              namespace: "pagination",
            })
          )("first"),
          previous: (
            await getTranslations({
              locale: appLocale,
              namespace: "pagination",
            })
          )("previous"),
          next: (
            await getTranslations({
              locale: appLocale,
              namespace: "pagination",
            })
          )("next"),
          last: (
            await getTranslations({
              locale: appLocale,
              namespace: "pagination",
            })
          )("last"),
          range: (
            await getTranslations({
              locale: appLocale,
              namespace: "pagination",
            })
          )("range", {
            from: data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1,
            to: Math.min(data.page * data.pageSize, data.total),
            total: data.total,
          }),
        }}
      />
    </div>
  );
}
