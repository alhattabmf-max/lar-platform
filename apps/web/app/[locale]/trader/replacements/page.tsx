import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReplacementSummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadReplacements } from "@/lib/trader-data";
import { formatDate } from "@/lib/localized";
import { formatQuantity } from "@/lib/money";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatusBadge, replacementTone } from "@/components/trader/status-badge";
import { TraderPagination, parsePage } from "@/components/trader/trader-pagination";

/**
 * Replacements the trader is owed.
 *
 * A `FAILED` replacement is the only state here that needs chasing —
 * the supplier could not send one — so those come first. Everything
 * else is a shipment in progress, and marking routine progress as
 * urgent would devalue the marker.
 */
export default async function TraderReplacementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "TRADER");

  const page = parsePage((await searchParams).page);

  const t = await getTranslations({ locale: appLocale, namespace: "trader.replacements" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const pagination = await getTranslations({ locale: appLocale, namespace: "pagination" });

  const result = await loadReplacements({ page });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      {!result.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : result.data.items.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <>
          <p className="text-sm text-content-muted">
            {t("resultCount", { count: result.data.total })}
          </p>
          <ul className="flex list-none flex-col gap-3">
            {[...result.data.items]
              .sort((a, b) => Number(b.status === "FAILED") - Number(a.status === "FAILED"))
              .map((replacement) => (
                <li key={replacement.id}>
                  <ReplacementRow replacement={replacement} locale={appLocale} />
                </li>
              ))}
          </ul>
        </>
      )}

      {result.ok ? (
        <TraderPagination
          basePath={`/${appLocale}/trader/replacements`}
          page={result.data.page}
          pageSize={result.data.pageSize}
          total={result.data.total}
          labels={{
            navLabel: pagination("navLabel"),
            previous: pagination("previous"),
            next: pagination("next"),
            status: pagination("status", {
              page: result.data.page,
              lastPage: Math.max(1, Math.ceil(result.data.total / result.data.pageSize)),
            }),
          }}
        />
      ) : null}
    </div>
  );
}

async function ReplacementRow({
  replacement,
  locale,
}: {
  replacement: ReplacementSummary;
  locale: AppLocale;
}) {
  const t = await getTranslations({ locale, namespace: "trader.replacements" });
  const statuses = await getTranslations({ locale, namespace: "trader.status" });

  const created = formatDate(replacement.createdAt, locale);

  return (
    <article
      className={`flex flex-col gap-2 rounded-lg border p-4 ${
        replacement.status === "FAILED"
          ? "border-warning bg-warning-surface"
          : "border-line bg-surface"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="min-w-0 flex-1 text-base font-semibold text-content">
          <Link
            href={`/${locale}/trader/replacements/${replacement.id}`}
            className="hover:text-secondary focus-visible:underline"
          >
            {t("itemTitle", {
              quantity: formatQuantity(replacement.replacementQuantity, locale),
            })}
          </Link>
        </h2>
        <StatusBadge
          label={statuses(`replacement.${replacement.status}`)}
          tone={replacementTone(replacement.status)}
        />
      </div>

      {created ? (
        <p className="text-sm text-content-muted">
          {t("createdAt")}: <time dateTime={replacement.createdAt}>{created}</time>
        </p>
      ) : null}

      <p className="text-sm text-content">{t(`next.${replacement.status}`)}</p>

      <Link
        href={`/${locale}/trader/orders/${replacement.orderId}`}
        className="self-start text-sm text-secondary hover:opacity-90"
      >
        {t("viewOrder")}
      </Link>
    </article>
  );
}
