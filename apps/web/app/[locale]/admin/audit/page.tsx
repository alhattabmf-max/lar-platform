import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AUDIT_ACTOR_TYPES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAuditActions, loadAuditLogs } from "@/lib/admin-data";
import { formatDateTime } from "@/lib/localized";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { AdminFilters } from "@/components/admin/admin-filters";
import {
  AdminPagination,
  adminPaginationLabels,
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";

/**
 * The audit log: what changed, who changed it, and why.
 *
 * NINE FIELDS, and the omissions are the design. `beforeData` and
 * `afterData` are arbitrary JSON copies of rows — they carry whatever
 * the row carried: a billing name, an email, a masked IBAN, an
 * administrator's private note. A viewer needs to know that something
 * changed and why; a replay of the values is a database question with
 * its own authorisation, not a page in a portal. `ipAddress` and
 * `userAgent` are absent for the same reason: request metadata about a
 * person, retained for forensics, not for routine reading.
 *
 * `reason` IS here. It is written deliberately by an administrator to
 * explain a decision, which is the opposite of incidental capture.
 *
 * THE ACTION FILTER IS BUILT FROM THE COLUMN ITSELF, through
 * `/admin/audit-logs/actions`. A hardcoded list in the browser drifts
 * the day a new action is emitted, and the drift is silent: the filter
 * keeps working and simply never offers the new value, so nobody can
 * search for the thing that just started happening.
 *
 * READING WRITES NOTHING. Viewing the audit log does not create an audit
 * entry — otherwise the table would grow every time somebody looked at
 * it, and the noise would bury the entries that matter.
 */
const PAGE_SIZE = 50;

export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.audit" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });
  const filters = await getTranslations({ locale: appLocale, namespace: "admin.filters" });
  const vocab = await getTranslations({ locale: appLocale, namespace: "admin.vocab" });

  const page = parseAdminPage(query.page);
  const actorType = firstParam(query.actorType);
  const action = firstParam(query.action);
  const entityId = firstParam(query.entityId);
  const requestId = firstParam(query.requestId);

  const basePath = `/${appLocale}/admin/audit`;

  // The available actions, from the column. A failure here degrades to
  // "no action filter" rather than taking the whole page down — the log
  // is still readable and still filterable by everything else.
  const actions = await loadAuditActions();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-content-muted">
        {t("scopeNotice")}
      </p>

      <AdminFilters
        action={basePath}
        search={{ name: "entityId", label: t("entityId"), value: entityId }}
        selects={[
          {
            name: "actorType",
            label: t("actorType"),
            value: actorType,
            options: [
              { value: "", label: filters("any") },
              ...AUDIT_ACTOR_TYPES.map((value) => ({
                value,
                label: vocab(`actorType.${value}`),
              })),
            ],
          },
          ...(actions.ok && actions.data.length > 0
            ? [
                {
                  name: "action",
                  label: t("action"),
                  value: action,
                  options: [
                    { value: "", label: filters("any") },
                    // The action codes as stored. They are machine
                    // vocabularies with no translation, and inventing a
                    // friendly name for each would either drift from the
                    // stored value or need a catalogue entry per action
                    // the moment one is added.
                    ...actions.data.map((value) => ({ value, label: value })),
                  ],
                },
              ]
            : []),
        ]}
        labels={{
          regionLabel: filters("regionLabel"),
          apply: filters("apply"),
          clear: filters("clear"),
        }}
      />

      <Suspense
        key={`${page}:${actorType ?? ""}:${action ?? ""}:${entityId ?? ""}:${requestId ?? ""}`}
        fallback={<LoadingState label={common("loading")} rows={8} />}
      >
        <Entries
          locale={appLocale}
          basePath={basePath}
          page={page}
          actorType={actorType}
          action={action}
          entityId={entityId}
          requestId={requestId}
        />
      </Suspense>
    </div>
  );
}

async function Entries({
  locale,
  basePath,
  page,
  actorType,
  action,
  entityId,
  requestId,
}: {
  locale: AppLocale;
  basePath: string;
  page: number;
  actorType?: string;
  action?: string;
  entityId?: string;
  requestId?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.audit" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAuditLogs({
    page,
    pageSize: PAGE_SIZE,
    actorType,
    action,
    entityId,
    requestId,
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
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <Table caption={t("tableCaption")}>
          <THead>
            <TR>
              <TH>{t("createdAt")}</TH>
              <TH>{t("actorType")}</TH>
              <TH>{t("action")}</TH>
              <TH>{t("entity")}</TH>
              <TH>{t("reason")}</TH>
              <TH>{t("requestId")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((entry) => (
              <TR key={entry.id}>
                <TD>
                  <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt, locale)}</time>
                </TD>
                <TD>
                  <div className="flex flex-col gap-1">
                    <span>{vocab(`actorType.${entry.actorType}`)}</span>
                    {/* SYSTEM actions have no actor — an em dash, not an
                        empty cell that reads as missing data. */}
                    <span className="break-all font-mono text-xs text-content-muted">
                      {entry.actorId ?? "—"}
                    </span>
                  </div>
                </TD>
                <TD className="font-mono text-xs">{entry.action}</TD>
                <TD>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-content-muted">{entry.entityType}</span>
                    <span className="break-all font-mono text-xs">{entry.entityId}</span>
                  </div>
                </TD>
                {/* The administrator's own words, as text. Never HTML. */}
                <TD className="whitespace-pre-wrap">{entry.reason ?? "—"}</TD>
                <TD className="break-all font-mono text-xs">{entry.requestId}</TD>
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
        query={{ actorType, action, entityId, requestId }}
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
