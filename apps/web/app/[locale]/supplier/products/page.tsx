import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ProductSummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import {
  loadSupplierOpportunities,
  loadSupplierProducts,
} from "@/lib/supplier-data";
import { productActions, productNeedsAttention } from "@/lib/product-actions";
import { opportunityIsLive } from "@/lib/opportunity-actions";
import { localized, formatDate } from "@/lib/localized";
import { mediaUrl } from "@/lib/media-url";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { ProductActions } from "@/components/supplier/product-actions";
import { CatalogueSearch } from "@/components/supplier/catalogue-search";
import { buttonClasses } from "@/components/ui/button";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.products");



/**
 * ONE PAGE NUMBER AND ONE SEARCH TERM, read from the address.
 *
 * Anything that is not a page number is page one: a pager that trusts
 * `?page=abc` renders `NaN` into its own links and strands whoever
 * follows one.
 */
export interface CatalogueQuery {
  page: number;
  search: string;
}

const PAGE_SIZE = 20;

/** How many of the «needs attention» rows are drawn above the list. */
const ATTENTION_SHOWN = 50;

function parseCatalogueQuery(
  params: Record<string, string | string[] | undefined>,
): CatalogueQuery {
  const one = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };

  const page = Number.parseInt(one("page"), 10);
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    search: one("q").trim(),
  };
}

/**
 * One row of the catalogue: what the list returned, and whether an offer
 * is running on the product.
 *
 * THERE IS NO SECOND READ. The summary carries everything the card
 * draws — the description, the weight, the dimensions and the package
 * content are all columns of the product row — so a row can no longer
 * be half-drawn because one of N requests failed.
 */
interface CatalogueRow {
  summary: ProductSummary;
  hasLiveOffer: boolean;
}

/**
 * The supplier's own catalogue — the THINGS, not the selling of them.
 *
 * A product recorded here is visible to nobody but its owner. What a
 * trader sees is an OFFER made on it, which is a separate act with its
 * own list under «عروضي»; the two were merged into one list for a while
 * and the merge is what this undoes.
 *
 * PAGED AND SEARCHED BY THE SERVER, and it had to become so. The
 * endpoint used to answer with the whole catalogue under a
 * five-hundred ceiling and this page drew every row of it: measured at
 * the ceiling, 6.4 MB of HTML in 1.1 seconds, and a supplier past it
 * never saw their oldest products at all.
 *
 * WHAT NARROWS, NARROWS IN SQL. The page number and the search term
 * are in the URL and go to the API; nothing here filters a list it was
 * given, because narrowing one page of a paged list hides every match
 * on the others.
 *
 * THE TWO SECTIONS ARE TWO QUERIES NOW. «What needs attention» used to
 * be a split made in the browser over a list this page had all of.
 * Under a pager that stops being possible — half a page is not half a
 * catalogue — so each section asks the server for its own half.
 *
 * What needs attention comes first and vanishes when nothing does —
 * DRAFT is unfinished, REJECTED needs a correction, and SUSPENDED means
 * the platform pulled a product. Everything else is simply the
 * catalogue.
 */
export default async function SupplierProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const query = parseCatalogueQuery(await searchParams);

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.products" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      {/* THE TAB ABOVE IS THIS PAGE'S TITLE — «نكتفي باسم القسم في
          اللسان كعنوان للصفحة». The heading stays for the document
          outline and for anyone reading by structure; a tab is a link
          and can never stand in for it. */}
      <header className="sr-only">
        <h1>{t("title")}</h1>
      </header>
      <Link href={`/${appLocale}/supplier/products/import`} className="self-start text-sm font-medium text-secondary underline underline-offset-4">{t("bulkImport.title")}</Link>

      <Suspense
        key={`${query.page}:${query.search}`}
        fallback={<LoadingState label={common("loading")} rows={4} />}
      >
        <Catalogue locale={appLocale} query={query} />
      </Suspense>
    </div>
  );
}

async function Catalogue({
  locale,
  query,
}: {
  locale: AppLocale;
  query: CatalogueQuery;
}) {
  const t = await getTranslations({ locale, namespace: "supplier.products" });
  const states = await getTranslations({ locale, namespace: "states" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  // THREE READS, SIDE BY SIDE, AND EACH NARROWED BY THE SERVER.
  //
  // The two halves of the catalogue are two queries because the split
  // can no longer be made here: this page holds one page of products,
  // and deciding «needs attention» over a page would describe the page
  // rather than the catalogue. The counts in each answer are the
  // catalogue's, which is what the pager and the headings need.
  //
  // The offers are wanted only to know which products already have one
  // running, and a failed read there is not an error page: the
  // catalogue loaded, and a missing badge is a smaller lie than a page
  // that refuses to draw.
  const [attention, rest, offers] = await Promise.all([
    loadSupplierProducts({
      needsAttention: true,
      search: query.search || undefined,
      pageSize: ATTENTION_SHOWN,
    }),
    loadSupplierProducts({
      needsAttention: false,
      search: query.search || undefined,
      page: query.page,
      pageSize: PAGE_SIZE,
    }),
    loadSupplierOpportunities(),
  ]);

  if (!rest.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={rest.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  const path = `/${locale}/supplier/products`;
  const searchBox = (
    <CatalogueSearch
      path={path}
      current={query.search}
      labels={{
        label: t("search.label"),
        placeholder: t("search.placeholder"),
        apply: t("search.apply"),
        clear: t("search.clear"),
      }}
    />
  );

  const attentionRows = attention.ok ? attention.data.items : [];
  const attentionTotal = attention.ok ? attention.data.total : 0;
  const total = rest.data.total + attentionTotal;

  // THE WAY TO ADD A FIRST ONE IS IN THE STRIP ABOVE, which is drawn
  // by the layout on every page — so an empty list needs nothing of
  // its own here, and a supplier with nothing yet still has the button.
  //
  // AN EMPTY SEARCH IS NOT AN EMPTY CATALOGUE, and the two must not
  // read the same: one says «add your first product», the other says
  // «nothing matched». Offering the first to somebody with four
  // hundred products would be nonsense.
  if (total === 0) {
    return (
      <div className="flex flex-col gap-6">
        {query.search ? searchBox : null}
        {query.search ? (
          <EmptyState
            title={t("search.emptyTitle")}
            description={t("search.emptyDescription", { term: query.search })}
          />
        ) : (
          <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        )}
      </div>
    );
  }

  const liveProductIds = new Set(
    (offers.ok ? offers.data : [])
      .filter((offer) => opportunityIsLive(offer.status))
      .map((offer) => offer.productId)
  );

  // EVERYTHING THE PRODUCT HAS — «اعرض لي المنتج بكل معلوماته» — AND
  // THE LIST ALREADY CARRIES IT.
  //
  // This page used to fetch the DETAIL of every product it had just
  // listed, one HTTP request per row, on the stated assumption that a
  // supplier's catalogue is small. A supplier with five hundred
  // products opened this screen with five hundred and two requests.
  //
  // The note left here said what to do about it: «the fix is to widen
  // the LIST endpoint, not to fetch here in batches». That is what was
  // done — the description, the weight, the three dimensions and the
  // package content are columns of the product row, so the summary now
  // carries them and the list costs exactly what it cost before.
  const toRows = (items: readonly ProductSummary[]): CatalogueRow[] =>
    items.map((summary) => ({
      summary,
      hasLiveOffer: liveProductIds.has(summary.id),
    }));

  const lastPage = Math.max(1, Math.ceil(rest.data.total / rest.data.pageSize));

  return (
    <div className="flex flex-col gap-6">
      {searchBox}

      {/* Rendered only when it has rows. An empty "needs attention"
          section trains people to stop looking at it. */}
      {attentionRows.length > 0 ? (
        <Card ariaLabel={t("needsAttention.title")} className="border-warning">
          <CardHeader>
            <CardTitle>{t("needsAttention.title")}</CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <ProductList locale={locale} rows={toRows(attentionRows)} />
            {/* SAID, NOT SILENTLY CUT. This section is drawn whole and
                bounded; when the backlog is deeper than the bound the
                reader is told how much is not on screen rather than
                left to assume they have seen it all. */}
            {attentionTotal > attentionRows.length ? (
              <p className="text-sm text-content-muted">
                {t("needsAttention.more", {
                  count: attentionTotal - attentionRows.length,
                })}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <section aria-label={t("allTitle")} className="flex flex-col gap-3">
        {/* THE NAME OF THE LIST, FOR A READER WHO CANNOT SEE THE TAB.
            The lit tab above says it on screen and the strip beside it
            carries the one action — «احذف الشريط اللي حطيته أنت
            سابقًا» — so nothing is printed here twice. The heading
            stays for the document outline and for anyone reading by
            structure. */}
        <h2 className="sr-only">{t("allTitle")}</h2>

        {/* THE COUNT IS THE CATALOGUE'S, NOT THE PAGE'S. A reader
            looking at twenty rows needs to know whether that is all of
            them. */}
        <p role="status" aria-live="polite" className="text-sm text-content-muted">
          {t("resultCount", { count: rest.data.total })}
        </p>

        {rest.data.items.length === 0 ? (
          <p className="text-sm text-content-muted">{t("allHandled")}</p>
        ) : (
          <ProductList locale={locale} rows={toRows(rest.data.items)} />
        )}

        <CataloguePagination
          path={path}
          search={query.search}
          page={rest.data.page}
          lastPage={lastPage}
          labels={{
            navLabel: pagination("navLabel"),
            previous: pagination("previous"),
            next: pagination("next"),
            status: pagination("status", { page: rest.data.page, lastPage }),
          }}
        />
      </section>
    </div>
  );
}

/**
 * The catalogue's pager, AS LINKS.
 *
 * The button-based `components/ui/pagination.tsx` drives in-place state
 * on an interactive list. This one moves between URLs, so it renders
 * anchors: they work without JavaScript, open in a new tab on
 * middle-click, and are announced as links rather than as buttons that
 * mysteriously change the address bar. The same reasoning, and the
 * same shape, as the marketplace's own pager.
 *
 * THE SEARCH TERM TRAVELS WITH THE PAGE. Dropping it on «next» would
 * page out of the result set and into the catalogue without saying so.
 */
function CataloguePagination({
  path,
  search,
  page,
  lastPage,
  labels,
}: {
  path: string;
  search: string;
  page: number;
  lastPage: number;
  labels: { navLabel: string; previous: string; next: string; status: string };
}) {
  // One page of results needs no pager at all.
  if (lastPage <= 1) return null;

  const href = (target: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (target > 1) params.set("page", String(target));
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  // There is no such thing as a disabled anchor — an `<a>` with
  // `aria-disabled` is still focusable and still activates — so an
  // unavailable direction renders as a span.
  const inactive =
    "inline-flex items-center rounded-md px-control-x py-control-y text-sm text-content-muted opacity-50";

  return (
    <nav aria-label={labels.navLabel} className="flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={buttonClasses("ghost", "sm")}>
          {labels.previous}
        </Link>
      ) : (
        <span className={inactive}>{labels.previous}</span>
      )}

      <span aria-current="page" className="text-sm text-content-muted">
        {labels.status}
      </span>

      {page < lastPage ? (
        <Link href={href(page + 1)} className={buttonClasses("ghost", "sm")}>
          {labels.next}
        </Link>
      ) : (
        <span className={inactive}>{labels.next}</span>
      )}
    </nav>
  );
}

/**
 * ONE FACT, ON ITS OWN COLUMN.
 *
 * NOT `Fact` FROM THE ACCOUNT PANELS. That one is built for a two-up
 * `<dl>` inside a narrow card, and in a row that runs the width of the
 * screen it left half the card empty — «هذي البطاقة غير احترافية».
 * These sit in one band that divides the full measure evenly, so the
 * card has no dead middle at any width.
 *
 * THE LABEL IS SMALL AND QUIET, THE VALUE IS THE THING. A reader scans
 * the numbers and reads a label only when one of them surprises them,
 * so the value takes the weight and the label takes the tint.
 */
function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {/* NO CAPS AND NO EXTRA TRACKING. Small caps with letters pushed
          apart is a Latin idiom for a label; Arabic has no case, so the
          rule does nothing to «الوزن لكل وحدة» and the tracking pulls
          its joined letters apart. And NO TRUNCATION — a clipped label
          leaves a number nobody can name. It wraps instead. */}
      <dt className="text-[11px] font-medium leading-tight text-content-muted">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-content">{value}</dd>
    </div>
  );
}

async function ProductList({
  locale,
  rows,
}: {
  locale: AppLocale;
  rows: readonly CatalogueRow[];
}) {
  const t = await getTranslations({ locale, namespace: "supplier.products" });
  const status = await getTranslations({ locale, namespace: "supplier.status" });
  const common = await getTranslations({ locale, namespace: "common" });
  const states = await getTranslations({ locale, namespace: "states" });

  return (
    <ul className="grid list-none gap-3">
      {rows.map(({ summary: product, hasLiveOffer }) => {
        const name = localized(locale, product.nameAr, product.nameEn);
        const archived = product.archivedAt !== null;
        const created = formatDate(product.createdAt, locale);
        const description = localized(locale, product.descriptionAr, product.descriptionEn);

        // THE SAME GATE THE DETAIL PAGE USES, transcribed from the
        // service's own guards: a closed or archived product cannot be
        // sold at all. A RUNNING OFFER IS A DIFFERENT MATTER — it stops
        // the next one being PUBLISHED, not written — so the button
        // still opens the form, which says so at its head and offers to
        // save a draft.
        const canOffer = !archived && product.approvalStatus !== "CLOSED";

        // BUILT, THEN DRAWN. A conditional `<Spec>` inside the band
        // would leave a hole in the grid where a product has no package
        // content; a list built first divides the width by what is
        // actually there.
        const specs: { label: string; value: string }[] = [
              { label: t("weightPerUnit"), value: product.weightPerUnit },
              {
                label: t("dimensions"),
                value: `${product.lengthCm} × ${product.widthCm} × ${product.heightCm}`,
              },
              ...(product.packageContentQuantity
                ? [
                    {
                      label: t("packageContent"),
                      value: `${product.packageContentQuantity} ${
                        localized(
                          locale,
                          product.packageContentUnitNameAr,
                          product.packageContentUnitNameEn
                        ) ?? ""
                      }`.trim(),
                    },
                  ]
                : []),
              { label: t("mediaCount"), value: String(product.mediaCount) },
              ...(created ? [{ label: t("createdAt"), value: created }] : []),
        ];

        return (
          <li key={product.id}>
            <Card>
              <CardBody>
                {/* THREE PARTS, AND THE MIDDLE ONE TAKES WHAT IS LEFT:
                    the picture, everything the product IS, and the two
                    things to do about it. */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  {product.thumbnailUrl ? (
                    /* A plain <img>: next/image proxies through the
                       optimizer, which fetches server-side without the
                       visitor's session cookie, and this route is
                       private — it would answer 401. */
                    <img
                      src={mediaUrl(product.thumbnailUrl)}
                      alt={t("thumbnailAlt", { name })}
                      className="size-28 shrink-0 rounded-card object-cover ring-1 ring-line"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-28 shrink-0 items-center justify-center rounded-card border border-dashed border-line-control bg-field-fill text-sm font-semibold text-content-muted"
                    >
                      {product.mediaCount}
                    </span>
                  )}

                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    {/* THE NAME, WITH EVERYTHING THAT QUALIFIES IT ON ONE
                        LINE UNDER IT. The unit and the states were three
                        separate rows and read as three separate facts;
                        they are all answers to "what is this, and where
                        is it". */}
                    <div className="flex flex-col gap-1.5">
                      {/* NOT A LINK. There is a button for that, and a
                          name that is also a link gives a reader two
                          ways to one page and two affordances for one
                          action. */}
                      <h3 className="truncate text-lg font-semibold leading-tight text-content">
                        {name}
                      </h3>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-content-muted">
                          {localized(locale, product.salesUnitNameAr, product.salesUnitNameEn)}
                        </span>
                        <span aria-hidden className="h-3 w-px bg-line" />
                        {/* Always the translated status, never the raw enum. */}
                        <StatusBadge
                          label={status(`product.${product.approvalStatus}`)}
                          tone={
                            archived
                              ? "neutral"
                              : productNeedsAttention(product)
                                ? "attention"
                                : product.approvalStatus === "APPROVED"
                                  ? "done"
                                  : "neutral"
                          }
                        />
                        {archived ? (
                          <StatusBadge label={status("productArchived")} tone="neutral" />
                        ) : null}
                        {/* WHY THE OFFER BUTTON MAY REFUSE, said before
                            it is pressed rather than after. */}
                        {hasLiveOffer ? (
                          <StatusBadge label={t("hasLiveOffer")} tone="done" />
                        ) : null}
                      </div>
                    </div>

                    {description ? (
                      /* TWO LINES AT MOST. A description is a paragraph
                         the supplier wrote for a product page; left
                         whole it decides the height of every row in the
                         catalogue. The whole of it is one button away. */
                      <p className="line-clamp-2 text-sm leading-relaxed text-content-muted">
                        {description}
                      </p>
                    ) : null}

                    {product.rejectionReason ? (
                      /* Correspondence a reviewer wrote FOR the supplier,
                         not an internal note. Withholding it leaves
                         someone told they failed without being told why.
                         IT IS TONED, because it is the one thing on this
                         card that needs an answer. */
                      <p className="rounded-control border border-warning bg-warning-surface px-3 py-2 text-sm text-warning-text">
                        {product.rejectionReason}
                      </p>
                    ) : null}

                    {/* WHAT THE SUPPLIER ENTERED, in one band across the
                        full measure. Decimal strings at the precision
                        the API sent them: these are measurements, not
                        money, and no arithmetic happens here.

                        DRAWN ONLY WHEN THE DETAIL READ CAME BACK — a row
                        survives losing it with its name, its states and
                        its two buttons. */}
                    {specs.length > 0 ? (
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-3 lg:grid-cols-5">
                        {specs.map((spec) => (
                          <Spec key={spec.label} label={spec.label} value={spec.value} />
                        ))}
                      </dl>
                    ) : null}
                  </div>

                  {/* THE TWO ACTIONS, ONE ABOVE THE OTHER — «زرّين فوق
                      بعض: عرض التفاصيل وإنشاء عرض».

                      ONE OF THEM IS THE LOUD ONE. Two filled buttons of
                      equal weight ask a reader to choose between two
                      equally important things, and they are not: making
                      an offer is the act, and reading the record is
                      where you go when you are not ready to. So the
                      offer keeps the fill and the other wears the
                      boundary. */}
                  <div className="flex shrink-0 flex-col gap-2 self-start sm:w-44">
                    <ButtonLink
                      href={`/${locale}/supplier/products/${product.id}`}
                      variant="ghost"
                      className="w-full"
                    >
                      {t("viewDetails")}
                    </ButtonLink>

                    {canOffer ? (
                      /* TWO WAYS TO SELL THE SAME PRODUCT, side by
                         side — «بجانب المنتج خياران واضحان: بيع مباشر
                         وإنشاء عرض».

                         BOTH AT ONCE IS ALLOWED. The one-live-listing
                         rule is per sale mode, so a product may carry a
                         running direct sale AND a running group offer;
                         neither button hides because the other was
                         used. */
                      <>
                        <ButtonLink
                          href={`//supplier/products//direct/new`}
                          variant="secondary"
                          className="w-full"
                        >
                          {t("newDirectShort")}
                        </ButtonLink>
                        <ButtonLink
                          href={`//supplier/products//offers/new`}
                          variant="ghost"
                          className="w-full"
                        >
                          {t("newOfferShort")}
                        </ButtonLink>
                      </>
                    ) : (
                      /* NOT A DISABLED BUTTON. A control that cannot be
                         used is still a control a reader has to test;
                         a sentence saying why is shorter to read and
                         reaches a screen reader in the same words. */
                      <p className="text-sm text-content-muted">{t("offerNotSellable")}</p>
                    )}

                    {/* AND THE DELETE, HERE — «ما يجيني حذف المنتج في
                        صفحة المورّد».

                        IT LIVED ON THE DETAIL PAGE ONLY, one click
                        away from the list where somebody actually
                        looks at what they own, and an archived
                        product — which is what a deleted draft offer
                        used to leave behind — showed no action there
                        at all.

                        ONLY THE DELETE. Submitting and archiving are
                        decisions about ONE product and belong on that
                        product's page; the gate is narrowed rather
                        than a second component written, so the
                        confirmation, the refusal and the wording are
                        the same ones the detail page uses. */}
                    <ProductActions
                      productId={product.id}
                      gate={{
                        ...productActions(product),
                        canSubmit: false,
                        canArchive: false,
                      }}
                      afterDeleteHref={`/${locale}/supplier/products`}
                      labels={{
                        submit: t("actions.submit"),
                        submitPrompt: t("actions.submitPrompt"),
                        archive: t("actions.archive"),
                        archivePrompt: t("actions.archivePrompt"),
                        remove: t("actions.delete"),
                        removePrompt: t("actions.deletePrompt"),
                        removing: t("actions.deleting"),
                        confirm: common("confirm"),
                        cancel: common("cancel"),
                        submitting: t("actions.working"),
                        errorTitle: states("errorTitle"),
                        requestIdLabel: states("requestIdLabel"),
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
