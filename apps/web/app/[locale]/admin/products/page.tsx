import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import {
  loadAdminCompany,
  loadAdminProducts,
} from "@/lib/admin-data";
import { localized, formatDate } from "@/lib/localized";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { AdminAction } from "@/components/admin/admin-action";
import {
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";
import { DataTablePagination } from "@/components/admin/data-table-pagination";
import { parsePageSize } from "@/lib/admin-list-query";

/**
 * The product directory — WATCHED, NOT GATED.
 *
 * A supplier publishes directly; nothing here approves anything. So
 * there is no review queue, no approve or reject button, and no
 * "approval status" column: none of them describe a decision this
 * platform actually makes any more.
 *
 * WHAT REMAINS IS SUPERVISION AFTER THE FACT. Suspend, close and
 * reactivate are still here because they are still real: the platform
 * can stop a product that is already selling.
 *
 * THE STORED FIELD IS STILL `approvalStatus` and is deliberately left
 * alone — renaming a column, a query parameter and an API contract to
 * match a screen's vocabulary is a migration, not a relabel. What the
 * screen does instead is READ that field and name its values for what
 * they mean operationally: APPROVED is a product that is live, not one
 * somebody blessed.
 *
 * `PENDING_REVIEW` and `REJECTED` cannot be produced any more and no
 * row carries them, but a legacy row would still render — as "not
 * published", which is what it would mean, rather than as a review
 * state this console no longer has.
 */

/**
 * The states an operator may filter by.
 *
 * The two review-era values are absent on purpose: offering a filter
 * for a state nothing can enter is offering a filter that always
 * returns nothing.
 */
const PRODUCT_OPERATIONAL_STATES = [
  "APPROVED",
  "SUSPENDED",
  "CLOSED",
  "DRAFT",
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
    namespace: "admin.products",
  });
  return { title: t("title") };
}

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

  const t = await getTranslations({
    locale: appLocale,
    namespace: "admin.products",
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
  const approvalStatus = firstParam(query.approvalStatus);
  const companyId = firstParam(query.companyId);

  // THE NAME BEHIND THE FILTER, and only when there IS one — see the
  // same note on the offers register. The chooser asks the server as
  // the operator types; this page only needs the name for an id that
  // is already in the address, so the box shows a name not a UUID.
  const currentSupplier = companyId ? await loadAdminCompany(companyId) : null;
  const currentSupplierName =
    currentSupplier?.ok ? currentSupplier.data.legalName : undefined;

  return (
    <div className="flex flex-col gap-8">
      {/* STILL A HEADING, just not a second copy of the sidebar.
          Reading it off the screen was redundant; reading it with a
          screen reader is how somebody knows which page they landed
          on, because they cannot see which sidebar entry is lit. */}
      <h1 className="sr-only">{t("title")}</h1>

      {/* NO HEADING OVER THE REGISTER — «في صفحة المنتجات احذف
          العنوان». The row under the orange rule already names the
          screen, and the sidebar entry beside it is lit; a third
          copy of the same word cost a line above every visit. The
          H1 above stays, unseen: a screen reader has neither of the
          other two. */}
      <section className="flex flex-col gap-3">
        <ListToolbar
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
              label: t("company"),
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
              // The QUERY PARAMETER keeps its name — it is the API's,
              // not this screen's, and renaming it here would only
              // break the request. The LABEL is what an operator reads.
              name: "approvalStatus",
              label: t("stateColumn"),
              options: [
                { value: "", label: filters("any") },
                ...PRODUCT_OPERATIONAL_STATES.map((value) => ({
                  value,
                  label: vocab(`productState.${value}`),
                })),
              ],
            },
          ]}
        />

        <Suspense
          key={`${page}:${search ?? ""}:${approvalStatus ?? ""}`}
          fallback={<LoadingState label={common("loading")} rows={6} />}
        >
          <Directory
            locale={appLocale}
            page={page}
            pageSize={pageSize}
            search={search}
            approvalStatus={approvalStatus}
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
  approvalStatus,
}: {
  locale: AppLocale;
  page: number;
  pageSize: number;
  search?: string;
  approvalStatus?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.products" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const actions = await getTranslations({ locale, namespace: "admin.actions" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });
  const toolbar = await getTranslations({ locale, namespace: "admin.toolbar" });

  const result = await loadAdminProducts({
    page,
    pageSize,
    search,
    approvalStatus,
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
              <TH>{t("stateColumn")}</TH>
              <TH>{t("mediaCount")}</TH>
              <TH>{t("dates")}</TH>
              <TH>{t("actionsColumn")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((product) => {
              const name = localized(locale, product.nameAr, product.nameEn);
              const archived = product.archivedAt !== null;

              return (
                <TR key={product.id}>
                  <TD>
                    {/* THE NAME OPENS THE PRODUCT.

                        Until now the console could list products and act
                        on them and could not READ one: the description,
                        the weight, what a package holds and the pictures
                        themselves lived only on the supplier's own screen,
                        which an administrator cannot open. Suspending a
                        product from a name and a status is not reviewing
                        it. */}
                    <Link
                      href={`/${locale}/admin/products/${product.id}`}
                      className="font-medium text-secondary hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {name}
                    </Link>
                  </TD>
                  <TD>
                    {/* THE SUPPLIER'S NAME OPENS THE SUPPLIER.

                        The contract has carried `companyId` all
                        along and this cell printed the name as
                        text. Whoever stops a product wants that
                        company's record next — how many other
                        products it has, whether it is verified,
                        what else was reported — and typing the
                        name into the register is the same journey
                        with three more steps. */}
                    <Link
                      href={`/${locale}/admin/companies/${product.companyId}`}
                      className="text-secondary hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {product.companyLegalName}
                    </Link>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {/* The value is the stored `approvalStatus`; the
                          WORD is operational. A live product reads as
                          live, and a stopped one as stopped — neither
                          as a verdict somebody handed down. */}
                      <StatusBadge
                        label={vocab(`productState.${product.approvalStatus}`)}
                        tone={
                          product.approvalStatus === "APPROVED"
                            ? "done"
                            : product.approvalStatus === "SUSPENDED"
                              ? "attention"
                              : "neutral"
                        }
                      />
                      {/* Archived is an independent flag, not a state,
                          so it is shown as its own badge rather than
                          replacing the operational one. */}
                      {archived ? <StatusBadge label={t("archived")} /> : null}
                    </div>

                    {/* AND WHY, WHERE ONE WAS RECORDED.

                        The contract carries `rejectionReason` and
                        this screen never drew it: a legacy row
                        read as «غير منشور» with the reason sitting
                        in the database. Nothing can be rejected any
                        more — a supplier publishes directly — so
                        this only ever speaks for a row from before
                        that, which is exactly the row an operator
                        cannot otherwise explain. */}
                    {product.rejectionReason ? (
                      <p className="mt-1 text-xs text-content-muted">
                        {product.rejectionReason}
                      </p>
                    ) : null}
                  </TD>
                  <TD>{product.mediaCount}</TD>
                  <TD>
                    {/* BOTH DATES, EACH NAMED — the contract has
                        carried `createdAt` all along and only the
                        second was drawn. «When did this reach the
                        platform» is a question a supervision screen
                        is asked, and «آخر تحديث» alone cannot
                        answer it.

                        SIDE BY SIDE AND LABELLED, for the same
                        reason the listing window is: two bare dates
                        are two dates. */}
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                      <span className="text-content-muted">{t("createdAt")}</span>
                      <time dateTime={product.createdAt}>
                        {formatDate(product.createdAt, locale)}
                      </time>
                      <span className="text-content-muted">{t("updatedAt")}</span>
                      <time dateTime={product.updatedAt}>
                        {formatDate(product.updatedAt, locale)}
                      </time>
                    </span>
                  </TD>
                  <TD>
                    {/* «إغلاق» IS GONE FROM THIS SCREEN.

                        «زر الإغلاق وخصائصه — إذا فيه مشكلة في
                         المنتج أوقفه مؤقتًا، وإذا كان الحل ليس في
                         الإيقاف المؤقت خلاص يُحذف نهائيًّا.»

                        TWO DOORS, NOT THREE. Suspend is the
                        reversible one — the product leaves the
                        market and its offers wait in ACTION
                        REQUIRED until somebody fixes what was
                        wrong. Delete is the final one. Close sat
                        between them as a THIRD irreversible act
                        whose name did not say so, beside a button
                        whose name did.

                        THE ROUTE AND THE STATE STAY. `POST
                        :id/close` still exists, rows already
                        carrying CLOSED still render and still
                        filter, and the state's own word is still
                        translated — removing a service, its outbox
                        event and its audit action is a migration,
                        not a screen change. What went is the way
                        an operator reaches it from here.

                        AND ONE CASE IS LEFT WITHOUT A FINAL ANSWER,
                        which is the owner's to accept: a product
                        with orders cannot be deleted — an invoice
                        and a ledger entry stand on it — so it can
                        now only be suspended, indefinitely.

                        THE ACTIONS LIE ACROSS, EACH AT ITS OWN WIDTH —
                        «الأزرار الثلاثة فوق بعض وعريضة، اجعلها صفًّا
                         واحدًا موازية لبعض بنفس حجم زر حذف نهائي».

                        A COLUMN STRETCHED THEM: `flex-col` aligns its
                        children on the cross axis, which for a column
                        is the WIDTH, so each button took the whole
                        cell and the row grew three controls tall.
                        Laid across they are the width of their own
                        words, as the lone «حذف نهائي» always was —
                        and they WRAP, so a narrow window drops one
                        under the others rather than pushing the
                        table sideways.

                        Gated on the SERVICE's own guards, transcribed
                        exactly: suspend claims APPROVED, close claims
                        APPROVED or SUSPENDED, reactivate claims
                        SUSPENDED. Neither checks `archivedAt`, so
                        neither does this — a button the server would
                        accept must not be missing, just as one it would
                        refuse must not be drawn. */}
                    <div className="flex flex-wrap items-center gap-2">
                    {product.approvalStatus === "APPROVED" ? (
                      <>
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
                      </>
                    ) : product.approvalStatus === "SUSPENDED" ? (
                      <>
                        <AdminAction
                          path={`/admin/products/${product.id}/reactivate`}
                          labels={{
                            ...actionLabels,
                            action: t("reactivate"),
                            prompt: t("reactivatePrompt", { name }),
                          }}
                        />
                      </>
                    ) : null}

                    {/* AND THE ERASE, ON EVERY ROW — «طلبت أني أقدر أحذف
                        المنتج نهائيًّا ولا لقيت إلا خيار إغلاق».
                        NOT GATED ON STATUS, because the server's guard
                        is not about status: it refuses when a buyer has
                        reached the product and allows it otherwise. A
                        draft, a rejected listing and a closed duplicate
                        are exactly the rows somebody wants gone, and
                        those are the three this column used to answer
                        with a dash.
                        THE REFUSAL IS THE SERVER'S TO GIVE. Drawing the
                        button and letting a 409 explain beats hiding it
                        and leaving a reader to guess why: the message
                        names how many orders and sessions stand in the
                        way, and says to close it instead. */}
                    {/* AND THE ERASE STANDS WITH THEM, NOT UNDER A
                        RULE — «ما زال زر حذف نهائي تحت، خلّه موازي
                         الإيقاف المؤقت عشان تقلّل ارتفاع الصف».

                        THE RULE WAS DRAWN FOR A ROW THAT NO LONGER
                        EXISTS. The owner had reported finding no
                        delete at all — «جيت ما لقيت حذف» — because
                        it stood under TWO red buttons in one stack
                        and the eye stops at the first red thing.
                        Close is gone; two buttons on one line need
                        no rule to be told apart, and that rule was
                        costing every row its own height. */}
                      {/* NO REASON ASKED — «بدون أن يطلب مني سبب لذلك؛
                          حذف بس، يعطيني بعد ما أضغط حذف تأكيد الحذف».
                          Every other action here demands a written note
                          because somebody ELSE reads it afterwards: the
                          supplier whose listing stopped, the operator
                          who inherits the case. This is the owner
                          removing his own row, and there is no second
                          reader. The confirmation stays — a permanent
                          delete must never be one mis-aimed click away
                          — and the audit entry still records who, when,
                          and the product's own name, status and offer
                          count. Only the WHY is now his to leave blank;
                          the route still accepts one if it is sent. */}
                      <AdminAction
                        path={`/admin/products/${product.id}`}
                        method="DELETE"
                        variant="danger"
                        labels={{
                          ...actionLabels,
                          action: t("deleteForever"),
                          prompt: t("deletePrompt", { name }),
                        }}
                      />
                    </div>
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
