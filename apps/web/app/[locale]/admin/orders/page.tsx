import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertCircle, CheckCircle2, Clock, CreditCard } from "lucide-react";
import { ADMIN_ORDER_STAGES, DASHBOARD_PERIODS } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadOrderInsights, loadOrderRows } from "@/lib/admin-data";
import { formatDateTime } from "@/lib/localized";
import { Money } from "@/components/ui/money";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { DataTablePagination } from "@/components/admin/data-table-pagination";
import { PeriodPicker } from "@/components/admin/dashboard-chrome";
import { OrderStagePath } from "@/components/admin/order-stage-path";
import { ExportToExcel } from "@/components/admin/export-to-excel";
import { exportLabelQuery } from "@/lib/admin-export-query";
import { parsePageSize } from "@/lib/admin-list-query";
import {
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";

/**
 * Every order in the window, and the four stages they sit in.
 *
 * THE STAGES ARE DERIVED. `MasterOrderStatus` has two values and this
 * screen shows four, because "troubled" is not a fulfilment status: an
 * order can be perfectly in fulfilment and still need an administrator.
 * The API's mapper owns that, and it is tested against every
 * combination the enum can produce.
 *
 * `paid` IS THE TOTAL, not a fourth slice. `master_orders` cannot be
 * written without a successful payment, so every row here is paid —
 * which is also why there is no "unpaid" to show. Repeatedly failed
 * payments are cases in the follow-up centre, not orders.
 *
 * NO METRIC CARDS ABOVE THE FILTERS. The approved design starts with
 * the filters, then the path, then the table.
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
    namespace: "admin.ordersDetail",
  });
  return { title: t("title") };
}

export default async function AdminOrdersPage({
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
    namespace: "admin.ordersDetail",
  });
  const overview = await getTranslations({
    locale: appLocale,
    namespace: "admin.overview",
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
  const stage = firstParam(query.stage);
  const search = firstParam(query.search);
  const page = parseAdminPage(query.page);
  const pageSize = parsePageSize(query.pageSize);

  const insights = await loadOrderInsights(period);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* NO TRAIL — «ألغِ التعليمات ذي لأنها شرح ولا أحتاج شرح».
          The row under the rule says which section is open and which
          of its screens this is. */}
            {/* STILL A HEADING, just not a second copy of the sidebar. */}
      <h1 className="sr-only">{t("title")}</h1>

      <ListToolbar
        // A FILTER, SO IT SITS WITH THE FILTERS. Pressing a stage
        // narrows the table, exactly like the selects above it —
        // and between the button row and the table it was a block
        // of chrome above the first order on every visit.
        extra={
          insights.ok ? (
            <OrderStagePath
              insight={insights.data}
              activeStage={stage ?? null}
              labels={{
                title: t("pathTitle"),
                hint: t("pathHint"),
                stages: {
                  paid: overview("stage.paid"),
                  inFulfilment: overview("stage.inFulfilment"),
                  completed: overview("stage.completed"),
                  troubled: overview("stage.troubled"),
                },
                notes: {
                  paid: t("stageNote.paid"),
                  inFulfilment: t("stageNote.inFulfilment"),
                  completed: t("stageNote.completed"),
                  troubled: t("stageNote.troubled"),
                },
                change: overview("comparison"),
              }}
              // FORMATTED HERE, ON THE SERVER, because this component runs
              // in the browser and React serialises every prop that crosses
              // the boundary — it refuses a function. These arrived as
              // `(value) => t("hours", { value })` and made the whole screen
              // a 500 on every request, silently: TypeScript was satisfied
              // and the build passed.
              figures={{
                paid:
                  insights.data.paymentSuccessRate === null
                    ? "—"
                    : `${insights.data.paymentSuccessRate}%`,
                inFulfilment:
                  insights.data.averageStartHours === null
                    ? "—"
                    : t("hours", {
                        value: String(insights.data.averageStartHours),
                      }),
                completed:
                  insights.data.averageCompletionDays === null
                    ? "—"
                    : t("days", {
                        value: String(insights.data.averageCompletionDays),
                      }),
                troubled:
                  insights.data.troubledRatePercent === null
                    ? "—"
                    : `${insights.data.troubledRatePercent}%`,
              }}
              icons={{
                paid: <CreditCard className="size-5" />,
                inFulfilment: <Clock className="size-5" />,
                completed: <CheckCircle2 className="size-5" />,
                troubled: <AlertCircle className="size-5" />,
              }}
            />
          ) : null
        }
        // ON THE SEARCH ROW, at the opposite end. These stood in a
        // header row of their own, which cost a row of the page for
        // two controls.
        actions={
          <div className="flex flex-wrap items-center gap-3">
              <PeriodPicker
                period={period}
                generatedAt={
                  formatDateTime(new Date().toISOString(), appLocale) ?? "—"
                }
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
                path={`/admin/follow-up/export?${exportLabelQuery({
                  columns: [
                    t("orderNumber"),
                    t("buyer"),
                    t("supplier"),
                    t("value"),
                    t("orderStatus"),
                    t("orderDate"),
                  ],
                  fileLabel: t("exportFile"),
                  date: new Date().toISOString().slice(0, 10),
                }).toString()}&period=${period}`}
                testId="export-orders"
                labels={{
                  action: overview("refresh") === "" ? "" : filters("export"),
                  working: actions("working"),
                  empty: states("emptyTitle"),
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
            name: "stage",
            label: t("orderStatus"),
            options: [
              { value: "", label: filters("any") },
              ...ADMIN_ORDER_STAGES.filter((value) => value !== "paid").map(
                (value) => ({
                  value,
                  label: overview(`stage.${value}`),
                }),
              ),
            ],
          },
        ]}
      />


      <Suspense
        key={`${period}:${stage ?? ""}:${search ?? ""}:${page}:${pageSize}`}
        fallback={<LoadingState label={common("loading")} rows={6} />}
      >
        <Orders
          locale={appLocale}
          period={period}
          stage={stage}
          search={search}
          page={page}
          pageSize={pageSize}
        />
      </Suspense>
    </div>
  );
}

async function Orders({
  locale,
  period,
  stage,
  search,
  page,
  pageSize,
}: {
  locale: AppLocale;
  period: string;
  stage?: string;
  search?: string;
  page: number;
  pageSize: number;
}) {
  const t = await getTranslations({ locale, namespace: "admin.ordersDetail" });
  const overview = await getTranslations({
    locale,
    namespace: "admin.overview",
  });
  const states = await getTranslations({ locale, namespace: "states" });
  const toolbar = await getTranslations({ locale, namespace: "admin.toolbar" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });
  const money = await getTranslations({ locale, namespace: "admin.money" });
  const currency = money("platformCurrency");

  const result = await loadOrderRows({ period, stage, search, page, pageSize });

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

  const from = (result.data.page - 1) * result.data.pageSize + 1;
  const to = Math.min(
    result.data.page * result.data.pageSize,
    result.data.total,
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <Table caption={t("tableCaption")}>
          <THead>
            <TR>
              <TH>{t("orderNumber")}</TH>
              <TH>{t("buyer")}</TH>
              <TH>{t("supplier")}</TH>
              <TH>{t("value")}</TH>
              <TH>{t("orderStatus")}</TH>
              <TH>{t("paymentStatus")}</TH>
              <TH>{t("orderDate")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((order) => (
              <TR key={order.id}>
                <TD>
                  <span
                    className="font-mono text-xs text-primary"
                    data-testid={`order-${order.id}`}
                  >
                    <bdi>{order.reference}</bdi>
                  </span>
                </TD>
                <TD>
                  <Link
                    href={`/${locale}/admin/companies/${order.buyerCompanyId}`}
                    className="rounded-sm underline underline-offset-2 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    data-testid={`order-buyer-${order.id}`}
                  >
                    {order.buyerName}
                  </Link>
                </TD>
                <TD>
                  <Link
                    href={`/${locale}/admin/companies/${order.supplierCompanyId}`}
                    className="rounded-sm underline underline-offset-2 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    data-testid={`order-supplier-${order.id}`}
                  >
                    {order.supplierName}
                  </Link>
                </TD>
                <TD className="tabular-nums">
                  <bdi>
                    <Money amount={order.totalAmount} currency={currency} locale={locale} fallback={<span className="text-content-muted">—</span>} />
                  </bdi>
                </TD>
                <TD>
                  <StatusBadge
                    label={overview(`stage.${order.stage}`)}
                    tone={
                      order.stage === "completed"
                        ? "done"
                        : order.stage === "troubled"
                          ? "attention"
                          : "neutral"
                    }
                  />
                </TD>
                <TD>
                  {/* EVERY ROW IS PAID. There is no unpaid order in this
                      table, because there is none in the database. */}
                  <StatusBadge label={t("paid")} tone="done" />
                </TD>
                <TD>
                  <time dateTime={order.createdAt}>
                    {formatDateTime(order.createdAt, locale) ?? "—"}
                  </time>
                </TD>
              </TR>
            ))}
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
          range: pagination("range", { from, to, total: result.data.total }),
        }}
      />
    </div>
  );
}
