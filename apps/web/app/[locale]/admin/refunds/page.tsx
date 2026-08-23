import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { REFUND_OBLIGATION_STATUSES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminRefunds } from "@/lib/admin-data";
import { formatDate } from "@/lib/localized";
import { formatMoney } from "@/lib/money";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { AdminFilters } from "@/components/admin/admin-filters";
import {
  AdminPagination,
  adminPaginationLabels,
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";

/**
 * Money owed back to buyers.
 *
 * NOTHING ON THIS PAGE IS SUMMED. Every amount is a decimal string
 * formatted at the edge of rendering, and a client-side total would be a
 * second source of truth that eventually disagrees with the transfers
 * that actually happened.
 *
 * `attemptCount` is on the row because it is the difference between an
 * obligation nobody has touched and one that has failed four times —
 * two states that look identical if you only read the status.
 */
const PAGE_SIZE = 25;

export default async function AdminRefundsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.refunds" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });
  const filters = await getTranslations({ locale: appLocale, namespace: "admin.filters" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });

  const page = parseAdminPage(query.page);
  const status = firstParam(query.status);
  const basePath = `/${appLocale}/admin/refunds`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <AdminFilters
        action={basePath}
        selects={[
          {
            name: "status",
            label: t("status"),
            value: status,
            options: [
              { value: "", label: filters("any") },
              ...REFUND_OBLIGATION_STATUSES.map((value) => ({
                value,
                label: vocab(`refundStatus.${value}`),
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
        key={`${page}:${status ?? ""}`}
        fallback={<LoadingState label={common("loading")} rows={6} />}
      >
        <Refunds locale={appLocale} basePath={basePath} page={page} status={status} />
      </Suspense>
    </div>
  );
}

async function Refunds({
  locale,
  basePath,
  page,
  status,
}: {
  locale: AppLocale;
  basePath: string;
  page: number;
  status?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.refunds" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminRefunds({ page, pageSize: PAGE_SIZE, status });

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
              <TH>{t("createdAt")}</TH>
              <TH>{t("amount")}</TH>
              <TH>{t("status")}</TH>
              <TH>{t("source")}</TH>
              <TH>{t("reason")}</TH>
              <TH>{t("attempts")}</TH>
              <TH>{t("open")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((refund) => (
              <TR key={refund.id}>
                <TD>
                  <time dateTime={refund.createdAt}>{formatDate(refund.createdAt, locale)}</time>
                </TD>
                {/* A malformed amount renders as an em dash with the
                    status still visible, never as "NaN" and never as
                    "0.00" — a zero is a claim about money. */}
                <TD>{formatMoney(refund.amount, refund.currency, locale) ?? "—"}</TD>
                <TD>
                  <StatusBadge
                    label={vocab(`refundStatus.${refund.status}`)}
                    tone={
                      refund.status === "COMPLETED"
                        ? "done"
                        : refund.status === "FAILED"
                          ? "attention"
                          : "neutral"
                    }
                  />
                </TD>
                <TD>{vocab(`refundSource.${refund.source}`)}</TD>
                <TD>{vocab(`refundReason.${refund.reasonCode}`)}</TD>
                <TD>{refund.attemptCount}</TD>
                <TD>
                  <Link
                    href={`/${locale}/admin/refunds/${refund.id}`}
                    className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                  >
                    {t("openDetail")}
                  </Link>
                </TD>
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
        query={{ status }}
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
