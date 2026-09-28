import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SUPPLIER_OPPORTUNITY_STATUSES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import {
  loadAdminCompany,
  loadAdminOpportunities,
} from "@/lib/admin-data";
import { formatDate } from "@/lib/localized";
import { formatQuantity } from "@/lib/money";
import { Money } from "@/components/ui/money";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { ListToolbar } from "@/components/admin/list-toolbar";
import {
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";
import { DataTablePagination } from "@/components/admin/data-table-pagination";
import { parsePageSize } from "@/lib/admin-list-query";

/**
 * Every opportunity, for monitoring.
 *
 * MONITOR-ONLY. There is no create and no edit anywhere in the admin
 * service — price, target quantity, share fields and every snapshot are
 * structurally unreachable from here, not merely blocked by a check.
 * The three actions that exist (pause, resume, cancel) live on the
 * detail page, where the operator has opened one listing on purpose.
 *
 * The status filter offers all eight values from the domain's own
 * transition table, so it cannot drift from what the lifecycle actually
 * produces.
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
    namespace: "admin.opportunities",
  });
  return { title: t("title") };
}

export default async function AdminOpportunitiesPage({
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
    namespace: "admin.opportunities",
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
  const status = firstParam(query.status);
  const companyId = firstParam(query.companyId);

  // THE NAME BEHIND THE FILTER, and only when there IS one.
  //
  // The chooser used to be filled with every supplier on the platform —
  // 5.8 MB at 70,000 companies, on a page nobody had typed into yet. It
  // asks the server as the operator types now, so the only thing this
  // page still needs is the name behind an id already in the address,
  // so the box shows a name rather than a UUID. One row, and only while
  // the filter is set.
  const currentSupplier = companyId ? await loadAdminCompany(companyId) : null;
  const currentSupplierName =
    currentSupplier?.ok ? currentSupplier.data.legalName : undefined;

  return (
    <div className="flex flex-col gap-6">
      {/* STILL A HEADING, just not a second copy of the sidebar.
          Reading it off the screen was redundant; reading it with a
          screen reader is how somebody knows which page they landed
          on, because they cannot see which sidebar entry is lit. */}
      <h1 className="sr-only">{t("title")}</h1>


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
          // WHOSE PRODUCTS — «أضف خيار اختيار اسم المورّد في بطاقة
          // البحث»، وبنفس نظام الحالة: يُختار ولا يُكتب.
          //
          // It writes `companyId`, which both this list and the offers
          // list have always accepted and nothing could reach: the
          // register could be narrowed to one supplier only by arriving
          // from that supplier's own page.
          {
            name: "companyId",
            label: t("supplier"),
            // THE SUPPLIER LIST IS NOT SHIPPED. It was every supplier on
            // the platform — 5.8 MB at 70,000 — to fill a dropdown.
            options: [],
            remote: {
              path: "/admin/companies/names?accountType=SUPPLIER",
              hint: filters("any"),
              valueKey: "id",
              currentLabel: currentSupplierName,
            },
          },
          {
            name: "status",
            label: t("status"),
            options: [
              { value: "", label: filters("any") },
              // The same eight values the domain's transition table
              // uses, declared once in the contracts package as the wire
              // vocabulary. The web app does not depend on @platform/domain.
              ...SUPPLIER_OPPORTUNITY_STATUSES.map((value) => ({
                value,
                label: vocab(`opportunityStatus.${value}`),
              })),
            ],
          },
        ]}
      />

      <Suspense
        key={`${page}:${status ?? ""}`}
        fallback={<LoadingState label={common("loading")} rows={6} />}
      >
        <Opportunities
          locale={appLocale}
          page={page}
          pageSize={pageSize}
          status={status}
          companyId={companyId}
        />
      </Suspense>
    </div>
  );
}

async function Opportunities({
  locale,
  page,
  pageSize,
  status,
  companyId,
}: {
  locale: AppLocale;
  page: number;
  pageSize: number;
  status?: string;
  /** One supplier, chosen from the card above. */
  companyId?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.opportunities" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const toolbar = await getTranslations({ locale, namespace: "admin.toolbar" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminOpportunities({
    page,
    pageSize,
    status,
    companyId,
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
    return (
      <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <Table caption={t("tableCaption")}>
          <THead>
            <TR>
              <TH>{t("createdAt")}</TH>
              <TH>{t("statusColumn")}</TH>
              <TH>{t("unitPrice")}</TH>
              <TH>{t("funding")}</TH>
              <TH>{t("window")}</TH>
              <TH>{t("open")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((opportunity) => (
              <TR key={opportunity.id}>
                <TD>
                  <time dateTime={opportunity.createdAt}>
                    {formatDate(opportunity.createdAt, locale)}
                  </time>
                </TD>
                <TD>
                  <StatusBadge
                    label={vocab(`opportunityStatus.${opportunity.status}`)}
                    tone={
                      opportunity.status === "FUNDED"
                        ? "done"
                        : opportunity.status === "ACTION_REQUIRED" ||
                            opportunity.status === "PAUSED"
                          ? "attention"
                          : "neutral"
                    }
                  />
                </TD>
                <TD>
                  <Money
                    amount={opportunity.unitPriceAmount}
                    currency={opportunity.currency}
                    locale={locale}
                    fallback={<span className="text-content-muted">—</span>}
                  />
                </TD>
                {/* Funded of target, as the two figures the server sent.
                    No percentage is computed here — a share of a
                    campaign is money-adjacent, and a rounded client-side
                    ratio is a second number nobody can reconcile. */}
                <TD>
                  {t("fundedOfTarget", {
                    funded: formatQuantity(opportunity.fundedQuantity, locale),
                    target: formatQuantity(opportunity.targetQuantity, locale),
                  })}
                </TD>
                <TD>
                  {/* SIDE BY SIDE, AND EACH SAYS WHICH IT IS — «حاط
                       فترة العرض وتحتها تاريخين فوق بعض، خلّهم
                       موازيين لبعض وأضف كلمة من وكلمة إلى».

                      TWO BARE DATES STACKED are two dates: nothing
                      said which one opened the offer and which
                      closed it, and a reader had to know the order
                      they were written in. The words cost less than
                      the line they save. */}
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                    <span className="text-content-muted">{t("windowFrom")}</span>
                    <time dateTime={opportunity.startAt}>
                      {formatDate(opportunity.startAt, locale)}
                    </time>
                    <span className="text-content-muted">{t("windowTo")}</span>
                    <time dateTime={opportunity.endAt}>
                      {formatDate(opportunity.endAt, locale)}
                    </time>
                  </span>
                </TD>
                <TD>
                  <Link
                    href={`/${locale}/admin/opportunities/${opportunity.id}`}
                    className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
                  >
                    {t("openDetail")}
                  </Link>
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
