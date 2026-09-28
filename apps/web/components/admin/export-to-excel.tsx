"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileSpreadsheet } from "lucide-react";
import { downloadFile } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";

/**
 * "Export to Excel", for any register in this console.
 *
 * THE SERVER BUILDS THE FILE. Gathering the rows on screen would export
 * one page of twenty-five and call it the result — and it would export
 * whatever the browser happened to hold rather than what the reader's
 * session is allowed to read. This asks the API, with the same search
 * and filters the table is showing, and the API decides both the rows
 * and the ceiling.
 *
 * THE HEADINGS TRAVEL WITH THE REQUEST. A file whose columns differ
 * from the table it came from is a file nobody can check. The screen is
 * the only place that knows both the column order and the reader's
 * language, so it sends them; the API treats them as decoration and
 * never as selection.
 *
 * NOTHING NAVIGATES. The download is a fetch and a blob, so the reader
 * keeps their search, their filters and their scroll position — and the
 * session cookie travels explicitly rather than depending on how a
 * given browser treats a cross-site top-level navigation.
 */

export interface ExportToExcelLabels {
  action: string;
  working: string;
  /** Shown instead of enabling the button when there is nothing to take. */
  empty: string;
  errorTitle: string;
  requestIdLabel: string;
}

export function ExportToExcel({
  path,
  labels,
  disabled = false,
  testId = "export-to-excel",
}: {
  /** API path including the query string, e.g. `/admin/companies/export?...`. */
  path: string;
  labels: ExportToExcelLabels;
  /** True when the current result set is empty. */
  disabled?: boolean;
  testId?: string;
}) {
  const root = useTranslations();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="secondary"
        // Two reasons to be unpressable, and they are different: one
        // says "already running", the other "there is nothing here".
        disabled={busy || disabled}
        aria-busy={busy}
        title={disabled ? labels.empty : undefined}
        data-testid={testId}
        onClick={async () => {
          if (busy || disabled) return;
          setBusy(true);
          setFailure(null);
          try {
            await downloadFile(path, "export.xlsx");
          } catch (error) {
            setFailure(toUserFacingError(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <FileSpreadsheet className="size-4" aria-hidden />
        {busy ? labels.working : labels.action}
      </Button>

      {failure ? (
        <p
          role="alert"
          className="text-xs text-danger"
          data-testid={`${testId}-error`}
        >
          {labels.errorTitle}: {root(failure.messageKey)}
          {failure.requestId ? (
            <>
              {" "}
              <span className="select-all font-mono">
                {labels.requestIdLabel} {failure.requestId}
              </span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
