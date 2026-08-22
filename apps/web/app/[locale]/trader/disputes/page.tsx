import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { DisputeSummary } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadDisputes } from "@/lib/trader-data";
import { formatDate, formatDateTime } from "@/lib/localized";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatusBadge, disputeTone } from "@/components/trader/status-badge";
import { TraderPagination, parsePage } from "@/components/trader/trader-pagination";

/**
 * The trader's disputes.
 *
 * A dispute where the trader is waiting on nobody — where the ball is
 * back with them — is what needs attention, so `awaitingCounterparty`
 * drives the ordering: the ones NOT waiting on a counterparty come
 * first, because those are the ones with something to read or do.
 *
 * Statuses are never collapsed. The four `RESOLVED_*` outcomes are
 * four different results, and each is translated to a sentence that
 * says which one happened.
 */
export default async function TraderDisputesPage({
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

  const t = await getTranslations({ locale: appLocale, namespace: "trader.disputes" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const pagination = await getTranslations({ locale: appLocale, namespace: "pagination" });

  const result = await loadDisputes({ page });

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
            {/* Waiting-on-you first. A dispute where the counterparty
                still owes a response needs nothing from the trader. */}
            {[...result.data.items]
              .sort((a, b) => Number(a.awaitingCounterparty) - Number(b.awaitingCounterparty))
              .map((dispute) => (
                <li key={dispute.id}>
                  <DisputeRow dispute={dispute} locale={appLocale} />
                </li>
              ))}
          </ul>
        </>
      )}

      {result.ok ? (
        <TraderPagination
          basePath={`/${appLocale}/trader/disputes`}
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

async function DisputeRow({ dispute, locale }: { dispute: DisputeSummary; locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "trader.disputes" });
  const statuses = await getTranslations({ locale, namespace: "trader.status" });

  const opened = formatDate(dispute.openedAt, locale);
  const due = formatDateTime(dispute.supplierResponseDueAt, locale);

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="min-w-0 flex-1 text-base font-semibold text-content">
          <Link
            href={`/${locale}/trader/disputes/${dispute.id}`}
            className="hover:text-secondary focus-visible:underline"
          >
            {t(`reason.${dispute.reasonCode}`)}
          </Link>
        </h2>
        {/* The EXACT outcome, translated into a sentence. Never
            "Resolved" — which of the four happened is the whole point. */}
        <StatusBadge
          label={statuses(`dispute.${dispute.status}`)}
          tone={disputeTone(dispute.status)}
        />
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {opened ? (
          <div className="flex gap-2">
            <dt className="text-content-muted">{t("openedAt")}:</dt>
            <dd className="text-content">
              <time dateTime={dispute.openedAt}>{opened}</time>
            </dd>
          </div>
        ) : null}
        {due && dispute.awaitingCounterparty ? (
          <div className="flex gap-2">
            <dt className="text-content-muted">{t("responseDue")}:</dt>
            <dd className="text-content">
              <time dateTime={dispute.supplierResponseDueAt}>{due}</time>
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="text-sm text-content-muted">
        {dispute.awaitingCounterparty ? t("waitingOnThem") : t("waitingOnYou")}
      </p>

      <Link
        href={`/${locale}/trader/orders/${dispute.orderId}`}
        className="self-start text-sm text-secondary hover:opacity-90"
      >
        {t("viewOrder")}
      </Link>
    </article>
  );
}
