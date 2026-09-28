"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * Help for the screen the reader is on.
 *
 * IT CARRIES ONLY HELP THAT EXISTS. There is no approved help content
 * for the control panel yet, so this shows the honest empty state rather
 * than operating instructions written here — a panel that explains a
 * screen in words nobody reviewed is a second, unversioned manual that
 * goes stale the first time the screen changes.
 *
 * It is NOT where the removed page descriptions went. Those were generic
 * restatements of the page title and were deleted, not relocated.
 *
 * A FOCUS TRAP, because it is a dialog: Tab must not walk out of it into
 * a page the reader cannot see behind it, Escape must close it, and
 * focus must return to the control that opened it — landing back at the
 * top of the document instead loses the reader's place.
 */

export interface ContextualHelpPanelLabels {
  title: string;
  close: string;
  /** Shown when no approved guide exists for this screen. */
  empty: string;
}

export function ContextualHelpPanel({
  open,
  onClose,
  labels,
  pageName,
  body,
}: {
  open: boolean;
  onClose: () => void;
  labels: ContextualHelpPanelLabels;
  /** The screen this help is about, already translated. */
  pageName: string;
  /** Approved help for this screen, or null when there is none. */
  body?: string | null;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
        data-testid="help-scrim"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        data-testid="contextual-help-panel"
        className="fixed inset-y-0 z-50 flex w-full max-w-sm flex-col gap-4 border-line bg-surface shadow-card px-card-x py-card-y"
        style={{ insetInlineEnd: 0 }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold text-content">
              {labels.title}
            </h2>
            <p className="text-sm text-content-muted">{pageName}</p>
          </div>

          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label={labels.close}
            data-testid="help-close"
            className="inline-flex size-8 min-h-control shrink-0 items-center justify-center rounded-control text-content hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        {body ? (
          <p
            className="whitespace-pre-wrap text-sm text-content"
            data-testid="help-body"
          >
            {body}
          </p>
        ) : (
          <p className="text-sm text-content-muted" data-testid="help-empty">
            {labels.empty}
          </p>
        )}
      </div>
    </>
  );
}
