import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { OUTBOX_STATUSES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadIntegrations, loadOutboxStats } from "@/lib/admin-data";
import { formatDateTime } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * Notification delivery, and the integrations behind it.
 *
 * COUNTS ONLY. There is no payload, no recipient address, no subject and
 * no last-error text anywhere on this page, because none of that is on
 * the contract — an outbox payload carries the email address a message
 * was addressed to, and a health screen has no business holding one.
 *
 * `PUBLISHED` MEANS THE PROVIDER ACCEPTED THE REQUEST. It does not mean
 * anything arrived. The relay is at-least-once delivery with a stable
 * provider idempotency key, not exactly-once, and no count here can
 * report a delivery. The page says so rather than letting a column of
 * green numbers imply it.
 *
 * `providerMode` is stated FIRST. While it is a simulated mode nothing
 * reaches anyone at all, and a dashboard of healthy counts that does not
 * say so is a lie told in numbers.
 *
 * `oldestPendingAt` is the real backlog signal — the age of the oldest
 * row the relay still has to send, counted only over event types the
 * relay actually handles. The table holds three dozen other event-type
 * literals it never reads; counting one of those as backlog would report
 * a permanent delay that nothing could ever clear.
 */
export default async function AdminOutboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.outbox" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={3} />}>
        <Relay locale={appLocale} />
      </Suspense>

      <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
        <Integrations locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function Relay({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.outbox" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });

  const result = await loadOutboxStats();

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

  const stats = result.data;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-content">{t("relayTitle")}</h2>

      <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-content">
        {t("providerMode", { mode: stats.providerMode })}
      </p>

      <p className="rounded-md border border-warning bg-warning-surface px-3 py-2 text-sm text-warning-text">
        {t("publishedMeaning")}
      </p>

      <ul className="grid list-none gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {OUTBOX_STATUSES.map((status) => (
          <li key={status}>
            <Card>
              <CardBody>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-content-muted">
                    {vocab(`outboxStatus.${status}`)}
                  </span>
                  <span
                    className={
                      status === "FAILED" && stats.counts[status] > 0
                        ? "text-2xl font-semibold text-danger-text"
                        : "text-2xl font-semibold text-content"
                    }
                  >
                    {stats.counts[status]}
                  </span>
                </div>
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>

      <Card>
        <CardBody>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("deferred")}</dt>
              <dd className="text-content">{stats.deferred}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("leased")}</dt>
              <dd className="text-content">{stats.leased}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("total")}</dt>
              <dd className="text-content">{stats.total}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{t("lastPublished")}</dt>
              <dd className="text-content">
                {stats.lastPublishedAt ? (
                  <time dateTime={stats.lastPublishedAt}>
                    {formatDateTime(stats.lastPublishedAt, locale)}
                  </time>
                ) : (
                  t("never")
                )}
              </dd>
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <dt className="text-content-muted">{t("oldestPending")}</dt>
              <dd className="text-content">
                {stats.oldestPendingAt ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <time dateTime={stats.oldestPendingAt}>
                      {formatDateTime(stats.oldestPendingAt, locale)}
                    </time>
                    <StatusBadge label={t("backlog")} tone="attention" />
                  </span>
                ) : (
                  t("noBacklog")
                )}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </section>
  );
}

async function Integrations({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.outbox" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });

  const result = await loadIntegrations();

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

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-content">{t("integrationsTitle")}</h2>

      {/* No provider reports HEALTHY, because no connectivity check
          exists yet for any of them. The screen states that rather than
          showing an unqualified status that would read as "tested". */}
      <p className="text-sm text-content-muted">{t("healthNotice")}</p>

      <Card>
        <CardHeader>
          <CardTitle>{t("integrationsTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <Table caption={t("integrationsCaption")}>
              <THead>
                <TR>
                  <TH>{t("integration")}</TH>
                  <TH>{t("provider")}</TH>
                  <TH>{t("mode")}</TH>
                  <TH>{t("configState")}</TH>
                  <TH>{t("healthState")}</TH>
                </TR>
              </THead>
              <TBody>
                {result.data.map((integration) => (
                  <TR key={integration.name}>
                    <TD>{integration.name}</TD>
                    <TD>{integration.provider}</TD>
                    <TD>{vocab(`integrationMode.${integration.mode}`)}</TD>
                    <TD>{vocab(`configState.${integration.configState}`)}</TD>
                    <TD>
                      <StatusBadge
                        label={vocab(`healthState.${integration.healthState}`)}
                        tone={integration.healthState === "HEALTHY" ? "done" : "neutral"}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </CardBody>
      </Card>
    </section>
  );
}
