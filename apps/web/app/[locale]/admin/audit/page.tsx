import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AUDIT_ACTOR_TYPES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAuditActions, loadAuditLogs } from "@/lib/admin-data";
import { formatDateTime } from "@/lib/localized";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ListToolbar } from "@/components/admin/list-toolbar";
import {
  firstParam,
  parseAdminPage,
} from "@/components/admin/admin-pagination";
import { DataTablePagination } from "@/components/admin/data-table-pagination";
import { AUDIT_DEFAULT_PAGE_SIZE, AUDIT_PAGE_SIZES, parsePageSizeFrom } from "@/lib/admin-list-query";

/**
 * The audit log: what changed, who changed it, and why.
 *
 * THE OMISSIONS ARE THE DESIGN. `beforeData` and `afterData` are
 * arbitrary JSON copies of rows — they carry whatever the row carried:
 * a billing name, an email, a masked IBAN, an administrator's private
 * note. Neither is served, and neither is rendered here.
 *
 * WHAT THE «ما تغيّر» COLUMN SHOWS is what the server allowed through:
 * a closed allow-list of field names — status, activation, changing
 * commercial values, a category's parent and order — reduced to
 * scalars and bounded, in `contracts/audit-fields.ts`. This page adds
 * no filtering of its own and could not widen that list if it tried:
 * an unapproved field never arrives. It narrows the list once more, to
 * the fields whose value actually MOVED, because an entry that copied a
 * whole row would otherwise print a column of unchanged values and bury
 * the one that matters.
 *
 * `ipAddress` and `userAgent` are still absent, unchanged: request
 * metadata about a person, retained for forensics, not for routine
 * reading.
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
    namespace: "admin.audit",
  });
  return { title: t("title") };
}

/**
 * An action code, resolved to a name.
 *
 * `t.has` rather than a try/catch, and a fallback to the code rather
 * than to an empty cell: an action emitted by a new feature must read as
 * an untranslated code, which is the prompt to name it — not as a blank
 * that looks like missing data.
 */
function actionName(
  t: { has: (key: string) => boolean; (key: string): string },
  action: string,
): string {
  const key = `auditActions.${action}`;
  return t.has(key) ? t(key) : action;
}

/**
 * A field name, resolved the same way an action code is, and falling
 * back to the field name itself for the same reason.
 */
function fieldName(
  t: { has: (key: string) => boolean; (key: string): string },
  field: string,
): string {
  const key = `auditFields.${field}`;
  return t.has(key) ? t(key) : field;
}

/**
 * How a value reads in the table.
 *
 * A boolean is rendered as a word rather than as "true", and an absent
 * value as an em dash rather than as "null" — the two states a reader
 * most needs to tell apart. Everything else is its own text, and it is
 * a text node: the server already refused anything that is not a
 * scalar, and this adds no markup path of its own.
 */
function auditValue(
  t: (key: string) => string,
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return t(value ? "valueYes" : "valueNo");
  return String(value);
}

/**
 * The allow-listed fields whose value actually MOVED.
 *
 * An entry that copied a whole row carries many fields that did not
 * change; listing them all would bury the one that did. A field present
 * on only one side counts as a change — that is a value appearing or
 * being cleared, which is exactly what a reader is looking for.
 */
function changedFields(
  entry: { before: Record<string, unknown> | null; after: Record<string, unknown> | null },
  t: (key: string) => string,
): { field: string; before: string; after: string }[] {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const fields = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort();

  return fields
    .filter((field) => before[field] !== after[field])
    .map((field) => ({
      field,
      before: auditValue(t, before[field] as never),
      after: auditValue(t, after[field] as never),
    }));
}

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

  const t = await getTranslations({
    locale: appLocale,
    namespace: "admin.audit",
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
  const adminNames = await getTranslations({
    locale: appLocale,
    namespace: "admin",
  });

  const page = parseAdminPage(query.page);
  // FIVE BY DEFAULT. Every other register is scanned; an audit entry is
  // read one at a time — who did what, to which record, and why, with a
  // reason that can run to a paragraph.
  const pageSize = parsePageSizeFrom(
    query.pageSize,
    AUDIT_PAGE_SIZES,
    AUDIT_DEFAULT_PAGE_SIZE,
  );
  const actorType = firstParam(query.actorType);
  const action = firstParam(query.action);
  const entityId = firstParam(query.entityId);
  const requestId = firstParam(query.requestId);

  // The available actions, from the column. A failure here degrades to
  // "no action filter" rather than taking the whole page down — the log
  // is still readable and still filterable by everything else.
  const actions = await loadAuditActions();

  return (
    <div className="flex flex-col gap-6">
      {/* STILL A HEADING, just not a second copy of the sidebar.
          Reading it off the screen was redundant; reading it with a
          screen reader is how somebody knows which page they landed
          on, because they cannot see which sidebar entry is lit. */}
      <h1 className="sr-only">{t("title")}</h1>


      <ListToolbar
        labels={{
          regionLabel: toolbar("regionLabel"),
          openLabel: filters("search"),
          searchLabel: t("entityId"),
          searchPlaceholder: toolbar("searchPlaceholder"),
          filtersPanelLabel: toolbar("filtersPanelLabel"),
          reset: toolbar("reset"),
        }}
        selects={[
          {
            name: "actorType",
            label: t("actorType"),
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
                  options: [
                    { value: "", label: filters("any") },
                    // The action codes as stored. They are machine
                    // vocabularies with no translation, and inventing a
                    // friendly name for each would either drift from the
                    // stored value or need a catalogue entry per action
                    // the moment one is added.
                    // Named for the reader, still filtered by the code.
                  ...actions.data.map((value) => ({
                    value,
                    label: actionName(adminNames, value),
                  })),
                  ],
                },
              ]
            : []),
        ]}
      />

      <Suspense
        key={`${page}:${actorType ?? ""}:${action ?? ""}:${entityId ?? ""}:${requestId ?? ""}`}
        fallback={<LoadingState label={common("loading")} rows={8} />}
      >
        <Entries
          locale={appLocale}
          page={page}
          pageSize={pageSize}
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
  page,
  pageSize,
  actorType,
  action,
  entityId,
  requestId,
}: {
  locale: AppLocale;
  page: number;
  pageSize: number;
  actorType?: string;
  action?: string;
  entityId?: string;
  requestId?: string;
}) {
  const t = await getTranslations({ locale, namespace: "admin.audit" });
  // The action names live one level up, beside every other admin
  // vocabulary, so one namespace serves both the column and the filter.
  const admin = await getTranslations({ locale, namespace: "admin" });
  const vocab = await getTranslations({ locale, namespace: "admin.vocab" });
  const states = await getTranslations({ locale, namespace: "states" });
  const toolbar = await getTranslations({ locale, namespace: "admin.toolbar" });
  const pagination = await getTranslations({ locale, namespace: "pagination" });

  const result = await loadAuditLogs({
    page,
    pageSize,
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
    return (
      <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
    );
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
              <TH>{t("changed")}</TH>
              <TH>{t("reason")}</TH>
              <TH>{t("requestId")}</TH>
            </TR>
          </THead>
          <TBody>
            {result.data.items.map((entry) => (
              <TR key={entry.id}>
                <TD>
                  <time dateTime={entry.createdAt}>
                    {formatDateTime(entry.createdAt, locale)}
                  </time>
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
                <TD>
                  {/* THE NAME, NOT THE CODE. This cell rendered the
                      stored value in monospace — the same fault the
                      settings screen had before its keys were named.
                      The code stays underneath in small text: it is
                      what the filter sends, what the column holds, and
                      what an engineer greps for. */}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-content">
                      {actionName(admin, entry.action)}
                    </span>
                    <span className="font-mono text-[11px] text-content-muted">
                      {entry.action}
                    </span>
                  </div>
                </TD>
                <TD>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-content-muted">
                      {entry.entityType}
                    </span>
                    <span className="break-all font-mono text-xs">
                      {entry.entityId}
                    </span>
                  </div>
                </TD>
                {/*
                  WHAT CHANGED, from the allow-listed fields only.

                  Only fields whose value actually MOVED are listed: an
                  entry that copied a whole row would otherwise print a
                  column of unchanged values and bury the one that
                  matters. Every value is a text node.
                */}
                <TD>
                  {changedFields(entry, t).length === 0 ? (
                    <span className="text-content-muted">—</span>
                  ) : (
                    <ul className="flex list-none flex-col gap-1">
                      {changedFields(entry, t).map((change) => (
                        <li key={change.field} className="text-xs">
                          <span className="text-content-muted">
                            {fieldName(admin, change.field)}
                          </span>
                          <span className="mx-1" dir="ltr">
                            <span className="text-content-muted line-through">
                              {change.before}
                            </span>
                            {" → "}
                            <span className="text-content">{change.after}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TD>
                {/* The administrator's own words, as text. Never HTML. */}
                <TD className="whitespace-pre-wrap">{entry.reason ?? "—"}</TD>
                <TD className="break-all font-mono text-xs">
                  {entry.requestId}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <DataTablePagination
        sizes={AUDIT_PAGE_SIZES}
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
