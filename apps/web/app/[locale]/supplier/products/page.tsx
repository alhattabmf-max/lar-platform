import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ProductSummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierProducts } from "@/lib/supplier-data";
import { productNeedsAttention } from "@/lib/product-actions";
import { localized } from "@/lib/localized";
import { mediaUrl } from "@/lib/media-url";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * The supplier's catalogue.
 *
 * NOT paginated: `GET /companies/me/products` returns the company's own
 * list, so there is no page control here. A pager over an unpaginated
 * endpoint is a lie about what the next page contains.
 *
 * What needs attention comes first and vanishes when nothing does — DRAFT is
 * unfinished, REJECTED needs a correction, and SUSPENDED means the platform
 * pulled a live product. Everything else is simply the catalogue.
 */
export default async function SupplierProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.products" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      {/* Always available: creating is not gated by any product's state,
          and `POST /companies/me/products` rejects only a non-supplier
          account, which this segment's guard has already established. */}
      <section className="flex flex-wrap gap-3">
        <ButtonLink href={`/${appLocale}/supplier/products/new`} variant="accentInteractive">
          {t("newProduct")}
        </ButtonLink>
      </section>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <Catalogue locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function Catalogue({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.products" });
  const states = await getTranslations({ locale, namespace: "states" });

  const products = await loadSupplierProducts();

  if (!products.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={products.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  if (products.data.length === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  const attention = products.data.filter(productNeedsAttention);
  const rest = products.data.filter((product) => !productNeedsAttention(product));

  return (
    <div className="flex flex-col gap-6">
      {/* Rendered only when it has rows. An empty "needs attention"
          section trains people to stop looking at it. */}
      {attention.length > 0 ? (
        <Card ariaLabel={t("needsAttention.title")} className="border-warning">
          <CardHeader>
            <CardTitle>{t("needsAttention.title")}</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-sm text-content-muted">{t("needsAttention.description")}</p>
            <ProductList locale={locale} products={attention} />
          </CardBody>
        </Card>
      ) : null}

      <section aria-label={t("allTitle")} className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-content">{t("allTitle")}</h2>
        {rest.length === 0 ? (
          <p className="text-sm text-content-muted">{t("allHandled")}</p>
        ) : (
          <ProductList locale={locale} products={rest} />
        )}
      </section>
    </div>
  );
}

async function ProductList({
  locale,
  products,
}: {
  locale: AppLocale;
  products: readonly ProductSummary[];
}) {
  const t = await getTranslations({ locale, namespace: "supplier.products" });
  const status = await getTranslations({ locale, namespace: "supplier.status" });

  return (
    <ul className="grid list-none gap-3 sm:grid-cols-2">
      {products.map((product) => {
        const name = localized(locale, product.nameAr, product.nameEn);
        const archived = product.archivedAt !== null;

        return (
          <li key={product.id}>
            <Card>
              <CardBody>
                <div className="flex gap-3">
                  {product.thumbnailUrl ? (
                    /* A plain <img>: next/image proxies through the
                       optimizer, which fetches server-side without the
                       visitor's session cookie, and this route is
                       private — it would answer 401. */
                    <img
                      src={mediaUrl(product.thumbnailUrl)}
                      alt={t("thumbnailAlt", { name })}
                      className="h-16 w-16 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-line text-xs text-content-muted"
                    >
                      {product.mediaCount}
                    </span>
                  )}

                  <div className="flex min-w-0 flex-col gap-1">
                    <Link
                      href={`/${locale}/supplier/products/${product.id}`}
                      className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                    >
                      {name}
                    </Link>

                    <span className="flex flex-wrap items-center gap-2">
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
                    </span>

                    {product.rejectionReason ? (
                      /* Correspondence a reviewer wrote FOR the supplier,
                         not an internal note. Withholding it leaves
                         someone told they failed without being told why. */
                      <p className="text-sm text-content-muted">{product.rejectionReason}</p>
                    ) : null}
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
