import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadMyProductReports } from "@/lib/trader-data";
import { formatDate } from "@/lib/localized";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * Product reports this company has raised.
 *
 * Read from `GET /trader/product-reports/mine`, which returns the
 * company's own list and is NOT paginated. So there is no pager here:
 * a page control over an unpaginated endpoint is a lie about what the
 * next page contains.
 *
 * The moderation side — an administrator's clarification requests and
 * internal notes — is not on this contract and does not appear. What a
 * reporter sees is what they reported and where it stands.
 *
 * There is no "report a product" form on this page. Creating a report
 * needs a product id, which a trader reaches from a product they are
 * looking at, not from a list of their past reports; the create
 * endpoint exists and is wired for that screen when it is built.
 */
export default async function TraderProductReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.productReports" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const result = await loadMyProductReports();

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
      ) : result.data.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <ul className="flex list-none flex-col gap-3">
          {result.data.map((report) => {
            const created = formatDate(report.createdAt, appLocale);

            return (
              <li
                key={report.id}
                className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  {/* Closed vocabularies, translated. A raw
                      `COUNTERFEIT_SUSPECTED` asks a reader to decode an
                      enum. Unknown values fall back to the code itself
                      rather than rendering an empty cell. */}
                  <h2 className="min-w-0 flex-1 text-base font-semibold text-content">
                    {t.has(`reason.${report.reasonCode}`)
                      ? t(`reason.${report.reasonCode}`)
                      : report.reasonCode}
                  </h2>
                  <StatusBadge
                    label={
                      t.has(`status.${report.status}`)
                        ? t(`status.${report.status}`)
                        : report.status
                    }
                    tone={
                      report.status === "CLARIFICATION_REQUESTED"
                        ? "attention"
                        : report.status === "OPEN"
                          ? "neutral"
                          : "done"
                    }
                  />
                </div>

                {created ? (
                  <p className="text-sm text-content-muted">
                    {t("reportedAt")}: <time dateTime={report.createdAt}>{created}</time>
                  </p>
                ) : null}

                <p className="text-sm text-content">
                  {t.has(`next.${report.status}`) ? t(`next.${report.status}`) : t("next.default")}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
