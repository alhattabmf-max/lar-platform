import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PRODUCT_APPROVAL_STATUSES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminProducts, loadPendingProducts } from "@/lib/admin-data";
import { localized, formatDate } from "@/lib/localized";
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
 * The product review queue, then the whole catalogue.
 *
 * THE QUEUE COMES FIRST because it is the only part with someone
 * waiting: a supplier cannot sell a product sitting in
 * `PENDING_REVIEW`. The directory below it is for looking things up,
 * and looking things up is never urgent.
 *
 * The queue is its own endpoint rather than the directory filtered,
 * because the two answer different questions: the queue is ordered by
 * how long each product has waited and carries the decision buttons,
 * while the directory is searchable and carries none.
 *
 * Approve takes no reason — it is the outcome a supplier is hoping for.
 * Reject, suspend and close all require one: each is written back to
 * the product where the supplier reads it as the thing to fix.
 */
const PAGE_SIZE = 25;

export default async function AdminProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.products" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });
  const filters = await getTranslations({ locale: appLocale, namespace: "admin.filters" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });

  const page = parseAdminPage(query.page);
  const search = firstParam(query.search);
  const approvalStatus = firstParam(query.approvalStatus);

  const basePath = `/${appLocale}/admin/products`;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("queueTitle")}</h2>
        <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
          <ReviewQueue locale={appLocale} />
        </Suspense>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("directoryTitle")}</h2>

        <AdminFilters
          action={basePath}
          search={{ name: "search", label: filters("search"), value: search }}
          selects={[
            {
              name: "approvalStatus",
              label: t("approvalStatus"),
              value: approvalStatus,
              options: [
                { value: "", label: filters("any") },
                ...PRODUCT_APPROVAL_STATUSES.map((value) => ({
                  value,
                  label: vocab(`productApproval.${value}`),
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
          key={`${page}:${search ?? ""}:${approvalStatus ?? ""}`}
          fallback={<LoadingState label={common("loading")} rows={6} />}
        >
          <Directory
            locale={appLocale}
            basePath={basePath}
            page={page}
            search={search}
            approvalStatus={approvalStatus}
          />
        </Suspense>
      </section>
    </div>
  );
}

async function ReviewQueue({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.products" });
  const states = await getTranslations({ locale, namespace: "states" });
  const actions = await getTranslations({ locale, namespace: "admin.actions" });

  const result = await loadPendingProducts();

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
      {result.data.map((product) => {
        const name = localized(locale, product.nameAr, product.nameEn);

        return (
          <li key={product.id}>
            <Card>
              <CardBody>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <p className="text-base font-medium text-content">{name}</p>
                    <p className="text-sm text-content-muted">{product.companyLegalName}</p>
                  </div>

                  <dl className="grid gap-1 text-sm sm:grid-cols-3">
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-content-muted">{t("mediaCount")}</dt>
                      <dd className="text-content">{product.mediaCount}</dd>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-content-muted">{t("mainImage")}</dt>
                      {/* Whether a main image was chosen, not where it is
                          stored. The storage key is selected by no query
                          behind this screen. */}
                      <dd className="text-content">
                        {product.hasMainImage ? t("mainImageYes") : t("mainImageNo")}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-content-muted">{t("submittedAt")}</dt>
                      <dd className="text-content">
                        <time dateTime={product.updatedAt}>
                          {formatDate(product.updatedAt, locale)}
                        </time>
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap gap-2">
                    <AdminAction
                      path={`/admin/products/${product.id}/approve`}
                      labels={{
                        ...actionLabels,
                        action: t("approve"),
                        prompt: t("approvePrompt", { name }),
                      }}
                    />
                    <AdminAction
                      path={`/admin/products/${product.id}/reject`}
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
                        prompt: t("rejectPrompt", { name }),
                      }}
                    />
                  </div>
                </div>
              </CardBody>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

async function Directory({
  locale,
  basePath,
  page,
  search,
  approvalStatus,
}: {
  locale: AppLocale;
  basePath: string;
  page: number;
  search?: string;
  approvalStatus?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.products" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const actions = await getTranslations({ locale, namespace: "admin.actions" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAdminProducts({ page, pageSize: PAGE_SIZE, search, approvalStatus });

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

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <Table caption={t("tableCaption")}>
          <THead>
            <TR>
              <TH>{t("name")}</TH>
              <TH>{t("company")}</TH>
              <TH>{t("approvalStatus")}</TH>
              <TH>{t("mediaCount")}</TH>
              <TH>{t("updatedAt")}</TH>
              <TH>{t("actionsColumn")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((product) => {
              const name = localized(locale, product.nameAr, product.nameEn);
              const archived = product.archivedAt !== null;

              return (
                <TR key={product.id}>
                  <TD>{name}</TD>
                  <TD>{product.companyLegalName}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge
                        label={vocab(`productApproval.${product.approvalStatus}`)}
                        tone={
                          product.approvalStatus === "APPROVED"
                            ? "done"
                            : product.approvalStatus === "PENDING_REVIEW"
                              ? "attention"
                              : "neutral"
                        }
                      />
                      {/* Archived is an independent flag, not a status,
                          so it is shown as its own badge rather than
                          replacing the approval state. */}
                      {archived ? <StatusBadge label={t("archived")} /> : null}
                    </div>
                  </TD>
                  <TD>{product.mediaCount}</TD>
                  <TD>
                    <time dateTime={product.updatedAt}>
                      {formatDate(product.updatedAt, locale)}
                    </time>
                  </TD>
                  <TD>
                    {/* Gated on the SERVICE's own guards, transcribed
                        exactly: suspend claims APPROVED, close claims
                        APPROVED or SUSPENDED, reactivate claims
                        SUSPENDED. Neither checks `archivedAt`, so
                        neither does this — a button the server would
                        accept must not be missing, just as one it would
                        refuse must not be drawn. */}
                    {product.approvalStatus === "APPROVED" ? (
                      <div className="flex flex-col gap-2">
                        <AdminAction
                          path={`/admin/products/${product.id}/suspend`}
                          variant="secondary"
                          reason={{
                            field: "reason",
                            label: t("suspendReason"),
                            minLength: 5,
                            maxLength: 2000,
                            hint: t("cascadeHint"),
                          }}
                          labels={{
                            ...actionLabels,
                            action: t("suspend"),
                            prompt: t("suspendPrompt", { name }),
                          }}
                        />
                        <AdminAction
                          path={`/admin/products/${product.id}/close`}
                          variant="danger"
                          reason={{
                            field: "reason",
                            label: t("closeReason"),
                            minLength: 5,
                            maxLength: 2000,
                            hint: t("cascadeHint"),
                          }}
                          labels={{
                            ...actionLabels,
                            action: t("close"),
                            prompt: t("closePrompt", { name }),
                          }}
                        />
                      </div>
                    ) : product.approvalStatus === "SUSPENDED" ? (
                      <div className="flex flex-col gap-2">
                        <AdminAction
                          path={`/admin/products/${product.id}/reactivate`}
                          labels={{
                            ...actionLabels,
                            action: t("reactivate"),
                            prompt: t("reactivatePrompt", { name }),
                          }}
                        />
                        <AdminAction
                          path={`/admin/products/${product.id}/close`}
                          variant="danger"
                          reason={{
                            field: "reason",
                            label: t("closeReason"),
                            minLength: 5,
                            maxLength: 2000,
                            hint: t("cascadeHint"),
                          }}
                          labels={{
                            ...actionLabels,
                            action: t("close"),
                            prompt: t("closePrompt", { name }),
                          }}
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-content-muted">—</span>
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
        query={{ search, approvalStatus }}
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
