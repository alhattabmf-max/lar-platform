"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Clock,
  UserPlus,
  Users,
} from "lucide-react";
import type { FollowUpCase } from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DataTablePagination } from "@/components/admin/data-table-pagination";

/**
 * The follow-up list, and the two things an administrator may do to a
 * case without resolving it.
 *
 * NEITHER ACTION CLOSES ANYTHING. Assigning a case and marking it in
 * progress both write to a table that has no closed flag; the case is
 * derived from the record it is about and leaves this list only when
 * that record changes. So a case that is opened, read, assigned and
 * started is still here tomorrow — which is the point.
 *
 * THE ACTION COLUMN OPENS THE RECORD. Following that link is not
 * progress either: it is how somebody goes and does the work.
 */

export interface FollowUpTableLabels {
  caseStatus: string;
  priority: string;
  item: string;
  duration: string;
  assignee: string;
  action: string;
  selectRow: string;
  selectAll: string;
  assignAction: string;
  markInProgress: string;
  unassigned: string;
  inProgressBadge: string;
  emptyTitle: string;
  emptyDescription: string;
  tableCaption: string;
  working: string;
  cancel: string;
  confirm: string;
  errorTitle: string;
  requestIdLabel: string;
  // NO FORMATTERS HERE. This component runs in the browser, and React
  // serialises every prop that crosses the server boundary — it refuses
  // a function:
  //
  //     Functions cannot be passed directly to Client Components
  //
  // These two were `(value: string) => string` and made the whole
  // follow-up screen a 500 on every request. Each case's age is
  // formatted on the server instead and arrives in `ages`.
  priorities: Record<string, string>;
  caseNames: Record<string, string>;
  openActions: Record<string, string>;
  rowsPerPage: string;
  rowsPerPageUnit: string;
}

export function FollowUpTable({
  locale,
  cases,
  ages,
  assignees,
  page,
  pageSize,
  total,
  labels,
  pagination,
}: {
  locale: string;
  cases: readonly FollowUpCase[];
  /**
   * How old each case is, ALREADY WORDED, keyed by the case id.
   *
   * Built on the server, where the message catalogue lives. A formatter
   * passed in here instead would be a function crossing the client
   * boundary, which React refuses to serialise.
   */
  ages: Record<string, string>;
  assignees: readonly { id: string; name: string }[];
  page: number;
  pageSize: number;
  total: number;
  labels: FollowUpTableLabels;
  pagination: {
    navLabel: string;
    first: string;
    previous: string;
    next: string;
    last: string;
    range: string;
  };
}) {
  const router = useRouter();
  const root = useTranslations();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const chosen = cases.filter((row) => selected.has(row.id));

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await action();
      setSelected(new Set());
      setAssigning(false);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  function assign(assigneeId: string | null) {
    return run(async () => {
      // One request per case: the API is scoped to a single case, and a
      // bulk endpoint would need its own partial-failure story.
      for (const row of chosen) {
        await apiClient.post(
          `/admin/follow-up/${row.kind}/${encodeURIComponent(row.caseRef)}/assign`,
          { assigneeId },
        );
      }
    });
  }

  function markInProgress() {
    return run(async () => {
      for (const row of chosen) {
        await apiClient.post(
          `/admin/follow-up/${row.kind}/${encodeURIComponent(row.caseRef)}/in-progress`,
          { inProgress: true },
        );
      }
    });
  }

  if (cases.length === 0) {
    return (
      <div
        className="rounded-md border border-line bg-surface p-6 text-center"
        data-testid="follow-up-empty"
      >
        <p className="text-sm font-medium text-content">{labels.emptyTitle}</p>
        <p className="text-sm text-content-muted">{labels.emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {failure ? (
        <div
          role="alert"
          className="rounded-md border border-danger bg-surface p-3 text-sm text-danger"
          data-testid="follow-up-error"
        >
          <span className="font-medium">{labels.errorTitle}:</span>{" "}
          {root(failure.messageKey)}
          {failure.requestId ? (
            <span className="ms-2 select-all font-mono text-xs">
              {labels.requestIdLabel} {failure.requestId}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* THE BULK CONTROLS, shown only when something is selected: two
          buttons that do nothing are two buttons in the way. */}
      {chosen.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="bulk-actions"
        >
          <Button
            type="button"
            size="sm"
            disabled={busy}
            data-testid="open-assign"
            onClick={() => setAssigning((open) => !open)}
            aria-expanded={assigning}
          >
            <UserPlus className="size-4" aria-hidden />
            {labels.assignAction}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            data-testid="mark-in-progress"
            onClick={() => void markInProgress()}
          >
            <CheckCircle2 className="size-4" aria-hidden />
            {busy ? labels.working : labels.markInProgress}
          </Button>

          {assigning ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label={labels.assignee}
                data-testid="assign-select"
                defaultValue=""
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "") return;
                  void assign(value === "UNASSIGNED" ? null : value);
                }}
              >
                <option value="">—</option>
                <option value="UNASSIGNED">{labels.unassigned}</option>
                {assignees.map((admin) => (
                  <option key={admin.id} value={admin.id}>
                    {admin.name}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setAssigning(false)}
              >
                {labels.cancel}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <Table caption={labels.tableCaption}>
          <THead>
            <TR>
              <TH>
                <input
                  type="checkbox"
                  aria-label={labels.selectAll}
                  data-testid="select-all"
                  checked={selected.size === cases.length && cases.length > 0}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? new Set(cases.map((row) => row.id))
                        : new Set(),
                    )
                  }
                />
              </TH>
              <TH>{labels.caseStatus}</TH>
              <TH>{labels.priority}</TH>
              <TH>{labels.item}</TH>
              <TH>{labels.duration}</TH>
              <TH>{labels.assignee}</TH>
              <TH>{labels.action}</TH>
            </TR>
          </THead>
          <TBody>
            {cases.map((row) => (
              <TR key={row.id}>
                <TD>
                  <input
                    type="checkbox"
                    aria-label={labels.selectRow}
                    data-testid={`select-${row.caseRef}`}
                    checked={selected.has(row.id)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(row.id);
                      else next.delete(row.id);
                      setSelected(next);
                    }}
                  />
                </TD>
                <TD>
                  <span className="inline-flex items-center gap-1.5">
                    <KindIcon kind={row.kind} />
                    <span className="text-sm">
                      {labels.caseNames[row.kind] ?? row.kind}
                    </span>
                    {row.inProgress ? (
                      <span
                        className="rounded-full border border-line px-2 py-0.5 text-xs text-content-muted"
                        data-testid={`in-progress-${row.caseRef}`}
                      >
                        {labels.inProgressBadge}
                      </span>
                    ) : null}
                  </span>
                </TD>
                <TD>
                  <PriorityTag
                    priority={row.priority}
                    label={labels.priorities[row.priority] ?? row.priority}
                  />
                </TD>
                <TD className="max-w-[16rem] truncate">{row.subject}</TD>
                <TD className="whitespace-nowrap text-xs text-content-muted">
                  <bdi>{ages[row.id] ?? "—"}</bdi>
                </TD>
                <TD>
                  {/* The id lives on a span: `TD` renders a cell and
                      passes nothing else through. */}
                  <span data-testid={`assignee-${row.caseRef}`}>
                    {row.assigneeName ?? (
                      <span className="text-content-muted">
                        {labels.unassigned}
                      </span>
                    )}
                  </span>
                </TD>
                <TD>
                  {/* OPENING THE RECORD IS NOT PROGRESS. It is how the
                      work gets done; the case stays until it is. */}
                  <Link
                    href={`/${locale}${row.actionHref}`}
                    data-testid={`action-${row.caseRef}`}
                    className={[
                      "inline-flex items-center rounded-md border px-control-x py-control-y text-sm",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                      row.priority === "CRITICAL"
                        ? "border-danger text-danger"
                        : row.priority === "OVERDUE"
                          ? "border-warning text-warning-text"
                          : "border-line text-content",
                    ].join(" ")}
                  >
                    {labels.openActions[row.kind] ?? labels.action}
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <DataTablePagination
        page={page}
        pageSize={pageSize}
        total={total}
        labels={{
          navLabel: pagination.navLabel,
          first: pagination.first,
          previous: pagination.previous,
          next: pagination.next,
          last: pagination.last,
          rowsPerPage: labels.rowsPerPage,
          rowsPerPageUnit: labels.rowsPerPageUnit,
          range: pagination.range,
        }}
      />
    </div>
  );
}

function KindIcon({ kind }: { kind: string }) {
  if (kind === "SETTLEMENT_OVERDUE" || kind === "PAYMENT_REPEATEDLY_FAILED") {
    return <AlertCircle className="size-4 shrink-0 text-danger" aria-hidden />;
  }
  if (kind === "DISPUTE_OPEN" || kind === "BANK_ACCOUNT_REVIEW") {
    return <Clock className="size-4 shrink-0 text-warning" aria-hidden />;
  }
  if (kind === "SUPPLIER_VERIFICATION") {
    return <Users className="size-4 shrink-0 text-content-muted" aria-hidden />;
  }
  return (
    <ClipboardList className="size-4 shrink-0 text-content-muted" aria-hidden />
  );
}

function PriorityTag({ priority, label }: { priority: string; label: string }) {
  const tone =
    priority === "CRITICAL"
      ? "border-danger text-danger"
      : priority === "OVERDUE"
        ? "border-warning text-warning-text"
        : "border-line text-content-muted";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${tone}`}
    >
      {priority === "CRITICAL" ? (
        <AlertCircle className="size-3" aria-hidden />
      ) : priority === "OVERDUE" ? (
        <Clock className="size-3" aria-hidden />
      ) : (
        <Users className="size-3" aria-hidden />
      )}
      {label}
    </span>
  );
}
