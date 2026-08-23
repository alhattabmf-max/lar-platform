import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SupplierReplacementSummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierReplacements } from "@/lib/supplier-data";
import { formatDate } from "@/lib/localized";
import { formatQuantity } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * What this supplier owes as replacements.
 *
 * Until 8E there was no read surface at all: only the three POST actions
 * existed, so `REPLACEMENT_REQUIRED` — an ACTION_REQUIRED notification —
 * pointed nowhere, and a supplier told to send a replacement had no way to
 * see what they owed.
 *
 * `awaitingSupplierAction` is derived server-side from the status, so this
 * page does not re-derive the rule.
 */
export default async function SupplierReplacementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.replacements" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <Replacements locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function Replacements({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.replacements" });
  const states = await getTranslations({ locale, namespace: "states" });

  const replacements = await loadSupplierReplacements({ pageSize: 50 });

  if (!replacements.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={replacements.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  if (replacements.data.total === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  const awaiting = replacements.data.items.filter((item) => item.awaitingSupplierAction);
  const rest = replacements.data.items.filter((item) => !item.awaitingSupplierAction);

  return (
    <div className="flex flex-col gap-6">
      {awaiting.length > 0 ? (
        <Card ariaLabel={t("awaiting.title")} className="border-warning">
          <CardHeader>
            <CardTitle>{t("awaiting.title")}</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-sm text-content-muted">{t("awaiting.description")}</p>
            <ReplacementList locale={locale} replacements={awaiting} />
          </CardBody>
        </Card>
      ) : null}

      <section aria-label={t("allTitle")} className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-content">{t("allTitle")}</h2>
        {rest.length === 0 ? (
          <p className="text-sm text-content-muted">{t("allHandled")}</p>
        ) : (
          <ReplacementList locale={locale} replacements={rest} />
        )}
      </section>

      {replacements.data.total > replacements.data.items.length ? (
        <p className="text-sm text-content-muted">{t("showingRecent")}</p>
      ) : null}
    </div>
  );
}

async function ReplacementList({
  locale,
  replacements,
}: {
  locale: AppLocale;
  replacements: readonly SupplierReplacementSummary[];
}) {
  const t = await getTranslations({ locale, namespace: "supplier.replacements" });
  const status = await getTranslations({ locale, namespace: "supplier.status" });

  return (
    <ul className="grid list-none gap-3 sm:grid-cols-2">
      {replacements.map((replacement) => (
        <li key={replacement.id}>
          <Card>
            <CardBody>
              <div className="flex flex-col gap-2">
                <Link
                  href={`/${locale}/supplier/replacement-obligations/${replacement.id}`}
                  className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                >
                  {t("openDetail")}
                </Link>

                <StatusBadge
                  label={status(`replacement.${replacement.status}`)}
                  tone={
                    // FAILED is on this enum and no other fulfilment one.
                    // A consumer that treats it as unreachable strands the
                    // obligation.
                    replacement.status === "FAILED"
                      ? "attention"
                      : replacement.status === "DELIVERED"
                        ? "done"
                        : "neutral"
                  }
                />

                <dl className="grid gap-1 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("quantity")}</dt>
                    <dd className="text-content">
                      {formatQuantity(replacement.replacementQuantity, locale)}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("createdAt")}</dt>
                    <dd className="text-content">
                      <time dateTime={replacement.createdAt}>
                        {formatDate(replacement.createdAt, locale)}
                      </time>
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("order")}</dt>
                    <dd>
                      <Link
                        href={`/${locale}/supplier/orders/${replacement.orderId}`}
                        className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
                      >
                        {t("openOrder")}
                      </Link>
                    </dd>
                  </div>
                </dl>
              </div>
            </CardBody>
          </Card>
        </li>
      ))}
    </ul>
  );
}
