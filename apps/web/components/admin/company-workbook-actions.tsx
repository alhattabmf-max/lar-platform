"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import type {
  CompanyImportPreview,
  CompanyImportResult,
} from "@platform/types";
import { apiClient, uploadFile } from "@/lib/api-client";
import { ExportToExcel } from "@/components/admin/export-to-excel";
import { exportLabelQuery } from "@/lib/admin-export-query";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";

/**
 * Moving companies in and out as a spreadsheet.
 *
 * TWO STEPS, ALWAYS. Choosing a file uploads it for INSPECTION and
 * writes nothing. What comes back is a count of what would happen and a
 * list of every rejected row with its number and its reason. Only a
 * second, deliberate press imports anything.
 *
 * THE PARTIAL IMPORT IS STATED, NOT DISCOVERED. When some rows are
 * rejected, the button says how many will be imported and the sentence
 * above it says the rest are left — so an operator who presses it has
 * been told, and one who would rather fix the file first can take the
 * error report and come back.
 *
 * NOTHING IS EXPLAINED UNTIL SOMETHING HAPPENS. Before a file is
 * chosen the three buttons say what they do and that is all the screen
 * says: a standing paragraph under a toolbar is read once and then
 * becomes furniture. The moment a file IS chosen the preview appears
 * and states, in that panel, that nothing has been saved yet — where it
 * is attached to the decision it governs.
 *
 * THE ERROR REPORT IS BUILT HERE, from the response already on screen.
 * A second round trip to ask the server to re-describe rows it has
 * already described would be a second chance for the two to disagree.
 */

export interface CompanyWorkbookLabels {
  exportAction: string;
  exportEmpty: string;
  templateAction: string;
  importAction: string;

  previewTitle: string;
  previewFile: string;
  previewTotal: string;
  previewValid: string;
  previewRejected: string;
  previewDuplicates: string;
  previewNothing: string;
  previewPartial: string;
  previewAll: string;
  rowsTitle: string;
  rowNumber: string;
  rowReason: string;
  downloadErrors: string;

  commitAction: string;
  cancel: string;
  working: string;
  doneTitle: string;
  doneCreated: string;
  doneSkipped: string;
  doneInvited: string;
  close: string;

  errorTitle: string;
  requestIdLabel: string;
  /** One per rejection reason, already translated. */
  reasons: Record<string, string>;
  unknownReason: string;
}

type Busy = null | "template" | "upload" | "commit";

export function CompanyWorkbookActions({
  accountType,
  query,
  exportColumns,
  exportFileLabel,
  statusLabels,
  empty = false,
  labels,
}: {
  /** Which tab is open. Everything here follows it, nothing crosses it. */
  accountType: "TRADER" | "SUPPLIER";
  /** The list's current filters, so an export matches what is on screen. */
  query: string;
  /** The open tab's column headings, in the table's own order. */
  exportColumns: readonly string[];
  /** The reader's word for this register, used in the filename. */
  exportFileLabel: string;
  /** Translated verification statuses, for the suppliers' file. */
  statusLabels: Record<string, string>;
  /** True when the open tab has no rows at all. */
  empty?: boolean;
  labels: CompanyWorkbookLabels;
}) {
  const router = useRouter();
  const root = useTranslations();
  const fileInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [preview, setPreview] = useState<CompanyImportPreview | null>(null);
  const [done, setDone] = useState<CompanyImportResult | null>(null);

  async function run(kind: Exclude<Busy, null>, action: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setFailure(null);
    try {
      await action();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(null);
    }
  }

  function reasonText(reason: string) {
    return labels.reasons[reason] ?? labels.unknownReason;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* THE SHARED EXPORT, pointed at this tab. The path already
            carries `accountType`, so the buyers' button can only ever
            produce a buyers' file. */}
        <ExportToExcel
          path={`/admin/companies/export${query}&${exportLabelQuery({
            columns: exportColumns,
            fileLabel: exportFileLabel,
            date: today(),
            statuses: statusLabels,
          }).toString()}`}
          disabled={empty}
          testId={`export-companies-${accountType.toLowerCase()}`}
          labels={{
            action: labels.exportAction,
            working: labels.working,
            empty: labels.exportEmpty,
            errorTitle: labels.errorTitle,
            requestIdLabel: labels.requestIdLabel,
          }}
        />

        <Button
          type="button"
          variant="secondary"
          disabled={busy !== null}
          onClick={() =>
            run("template", () =>
              downloadTemplate(accountType, exportFileLabel),
            )
          }
        >
          <FileSpreadsheet className="size-4" aria-hidden />
          {busy === "template" ? labels.working : labels.templateAction}
        </Button>

        <Button
          type="button"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="size-4" aria-hidden />
          {busy === "upload" ? labels.working : labels.importAction}
        </Button>

        {/* Hidden because the button above IS the control. It is a real
            input all the same, so the file picker, keyboard and screen
            reader behave as they do everywhere else. */}
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared immediately so choosing the SAME file again after
            // a correction still fires a change event.
            event.target.value = "";
            if (!file) return;
            setDone(null);
            setPreview(null);
            void run("upload", async () => {
              const result = await uploadFile<CompanyImportPreview>(
                // THE TAB DECIDES THE KIND. A file uploaded on the
                // suppliers tab creates suppliers; the type is never
                // taken from a column an operator could mistype.
                `/admin/companies/import?accountType=${accountType}`,
                file,
              );
              setPreview(result);
            });
          }}
        />
      </div>

      {failure ? (
        <div
          role="alert"
          className="rounded-md border border-danger bg-danger-subtle p-4 text-sm text-danger"
        >
          <p className="font-medium">{labels.errorTitle}</p>
          <p>{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="mt-1 font-mono text-xs">
              {labels.requestIdLabel}{" "}
              <span className="select-all">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {preview ? (
        <div className="flex flex-col gap-4 rounded-card bg-surface shadow-card px-card-x py-card-y">
          <h2 className="text-base font-semibold text-content">
            {labels.previewTitle}
          </h2>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label={labels.previewFile} value={preview.fileName} />
            <Stat label={labels.previewTotal} value={String(preview.total)} />
            <Stat label={labels.previewValid} value={String(preview.valid)} />
            <Stat
              label={labels.previewRejected}
              value={String(preview.rejected)}
            />
            <Stat
              label={labels.previewDuplicates}
              value={String(preview.duplicates)}
            />
          </dl>

          {/* SAID BEFORE THE BUTTON, in the words of what will happen —
              a partial import an operator was not told about is the
              failure this whole two-step shape exists to prevent. */}
          <p className="text-sm text-content-muted">
            {preview.valid === 0
              ? labels.previewNothing
              : preview.rejected > 0
                ? labels.previewPartial
                : labels.previewAll}
          </p>

          {preview.errors.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-content">
                  {labels.rowsTitle}
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    downloadErrorReport(preview, reasonText, labels)
                  }
                >
                  <Download className="size-4" aria-hidden />
                  {labels.downloadErrors}
                </Button>
              </div>

              <div className="max-h-64 overflow-y-auto rounded-md border border-line">
                <table className="w-full text-start text-sm">
                  <thead className="sticky top-0 bg-surface-muted">
                    <tr>
                      <th
                        scope="col"
                        className="px-3 py-2 text-start font-medium"
                      >
                        {labels.rowNumber}
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2 text-start font-medium"
                      >
                        {labels.rowReason}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.errors.map((error) => (
                      <tr
                        key={error.rowNumber}
                        className="border-t border-line"
                      >
                        <td className="px-3 py-2 font-mono" dir="ltr">
                          {error.rowNumber}
                        </td>
                        <td className="px-3 py-2">
                          {reasonText(error.reason)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy !== null || preview.valid === 0}
              onClick={() =>
                void run("commit", async () => {
                  const result = await apiClient.post<CompanyImportResult>(
                    `/admin/companies/import/${encodeURIComponent(preview.importId)}/commit`,
                  );
                  setPreview(null);
                  setDone(result);
                  router.refresh();
                })
              }
            >
              {busy === "commit"
                ? labels.working
                : `${labels.commitAction} (${preview.valid})`}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setPreview(null)}
            >
              {labels.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      {done ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-card bg-surface shadow-card px-card-x py-card-y"
        >
          <h2 className="text-base font-semibold text-content">
            {labels.doneTitle}
          </h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label={labels.doneCreated} value={String(done.created)} />
            <Stat label={labels.doneSkipped} value={String(done.skipped)} />
            <Stat label={labels.doneInvited} value={String(done.invited)} />
          </dl>

          {done.errors.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm text-content-muted">
              {done.errors.map((error) => (
                <li key={error.rowNumber}>
                  <span dir="ltr" className="font-mono">
                    {error.rowNumber}
                  </span>{" "}
                  — {reasonText(error.reason)}
                </li>
              ))}
            </ul>
          ) : null}

          <div>
            <Button type="button" variant="ghost" onClick={() => setDone(null)}>
              {labels.close}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-content-muted">{label}</dt>
      <dd className="truncate text-sm font-medium text-content">{value}</dd>
    </div>
  );
}

/**
 * The rejected rows as a file the operator can work from.
 *
 * A CSV with a BOM, not an .xlsx: it is built in the browser from data
 * already on screen, and Excel opens a BOM-prefixed UTF-8 CSV with the
 * Arabic intact. Every field is quoted and any value that would read as
 * a formula is prefixed, exactly as the server does on the way out.
 */
function downloadErrorReport(
  preview: CompanyImportPreview,
  reasonText: (reason: string) => string,
  labels: CompanyWorkbookLabels,
) {
  const escape = (value: string) =>
    `"${(/^[=+\-@]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;

  const lines = [
    [labels.rowNumber, labels.rowReason].map(escape).join(","),
    ...preview.errors.map((error) =>
      [String(error.rowNumber), reasonText(error.reason)].map(escape).join(","),
    ),
  ];

  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "import-errors.csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The reader's own day, as the filename should say it. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The blank for THIS tab, named for it. */
async function downloadTemplate(accountType: string, label: string) {
  const { downloadFile } = await import("@/lib/api-client");
  await downloadFile(
    `/admin/companies/import-template?accountType=${accountType}`,
    `${label}-template.xlsx`,
  );
}
