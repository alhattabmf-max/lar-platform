"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The two documents, in one dialog, over the form that is still there.
 *
 * IT DOES NOT NAVIGATE. The form behind it keeps every value somebody
 * typed, because nothing unmounts: this is an overlay, not a page. That
 * is the whole reason it exists — sending a half-filled registration to
 * a policy page and back is how people give up on registering.
 *
 * OPENING IT IS NOT AGREEING. The checkbox beneath the form is the only
 * thing that records consent, and it is untouched by this dialog.
 *
 * WHAT A DIALOG OWES A KEYBOARD, all of it built here because no
 * library is in play: `Escape` closes, Tab cycles inside and cannot
 * reach the form behind, focus lands on the panel when it opens, and it
 * returns to the button that opened it when it closes — so somebody
 * navigating by keyboard is not dropped at the top of the document.
 */

export interface PolicyDocument {
  /** The VERSION id — what an acceptance references. */
  id: string;
  documentCode: string;
  title: string;
  versionLabel: string;
  text: string;
}

export interface PoliciesDialogLabels {
  title: string;
  close: string;
  version: string;
  unavailable: string;
}

export function PoliciesDialog({
  documents,
  labels,
  onClose,
}: {
  documents: readonly PolicyDocument[];
  labels: PoliciesDialogLabels;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    // Focus moves INTO the dialog, or a screen reader carries on
    // reading the page underneath as though nothing opened.
    panel.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      // TAB IS TRAPPED. Without this the next Tab leaves for the form
      // behind the overlay, which is visible, unreachable by mouse, and
      // still focusable.
      const focusable = panel.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      // A press on the backdrop closes, exactly as Escape does.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid="policies-backdrop"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="policies-dialog-title"
        tabIndex={-1}
        data-testid="policies-dialog"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 rounded-card bg-surface shadow-card px-card-x py-card-y focus-visible:outline focus-visible:outline-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="policies-dialog-title"
            className="text-base font-semibold text-content"
          >
            {labels.title}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="policies-close"
          >
            <X className="size-4" aria-hidden />
            {labels.close}
          </Button>
        </div>

        {documents.length === 0 ? (
          <p
            className="text-sm text-warning-text"
            data-testid="policies-unavailable"
          >
            {labels.unavailable}
          </p>
        ) : (
          <>
            {/* TWO DOCUMENTS, TWO TABS — one dialog. They are separate
                agreements and are recorded separately, so they are read
                separately too. */}
            <div
              role="tablist"
              aria-label={labels.title}
              className="flex gap-1 border-b border-line"
            >
              {documents.map((document, index) => (
                <button
                  key={document.id}
                  type="button"
                  role="tab"
                  id={`policy-tab-${document.documentCode}`}
                  aria-selected={active === index}
                  aria-controls={`policy-panel-${document.documentCode}`}
                  tabIndex={active === index ? 0 : -1}
                  data-testid={`policy-tab-${document.documentCode}`}
                  onClick={() => setActive(index)}
                  onKeyDown={(event) => {
                    // Arrow keys move between tabs, as a tablist does.
                    if (
                      event.key === "ArrowRight" ||
                      event.key === "ArrowLeft"
                    ) {
                      event.preventDefault();
                      const step = event.key === "ArrowRight" ? 1 : -1;
                      setActive(
                        (current) =>
                          (current + step + documents.length) %
                          documents.length,
                      );
                    }
                  }}
                  className={[
                    "rounded-t-md px-3 py-2 text-sm font-medium",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                    active === index
                      ? "border-b-2 border-secondary text-content"
                      : "border-b-2 border-transparent text-content-muted hover:text-content",
                  ].join(" ")}
                >
                  {document.title}
                </button>
              ))}
            </div>

            {documents.map((document, index) => (
              <div
                key={document.id}
                role="tabpanel"
                id={`policy-panel-${document.documentCode}`}
                aria-labelledby={`policy-tab-${document.documentCode}`}
                hidden={active !== index}
                data-testid={`policy-panel-${document.documentCode}`}
                className={
                  active === index ? "flex min-h-0 flex-col gap-2" : "hidden"
                }
              >
                <p className="text-xs text-content-muted">
                  {labels.version} <bdi>{document.versionLabel}</bdi>
                </p>
                <div
                  // The text scrolls INSIDE the panel: the page behind
                  // must not move while a dialog is open.
                  className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-background p-3 text-sm leading-relaxed text-content"
                  tabIndex={0}
                >
                  {document.text}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
