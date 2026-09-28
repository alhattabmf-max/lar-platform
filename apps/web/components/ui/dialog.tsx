"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Accessible modal dialog.
 *
 * Focus management is the whole point of writing this by hand rather
 * than styling a <div>:
 *
 *   - focus moves into the dialog on open and returns to the invoking
 *     element on close;
 *   - Tab and Shift+Tab are trapped inside;
 *   - Escape closes;
 *   - the backdrop is inert to keyboard users and does not receive focus;
 *   - `aria-modal` + `role="dialog"` + a labelled title.
 *
 * Content arrives entirely through `children` — this component never
 * renders text of its own, and never uses dangerouslySetInnerHTML.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Translated title, also used as the dialog's accessible name. */
  title: ReactNode;
  /** Translated accessible name for the close control. */
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  closeLabel,
  children,
  footer,
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useRef(`dialog-title-${Math.random().toString(36).slice(2)}`).current;

  const focusables = useCallback((): HTMLElement[] => {
    if (!panelRef.current) return [];
    return Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
  }, []);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Focus the panel itself, not the first control: it carries
    // role="dialog" and aria-labelledby, so a screen reader announces
    // the dialog and its title on open. Tab then moves to the first
    // control from a predictable starting point.
    panelRef.current?.focus();

    return () => {
      previouslyFocused.current?.focus();
    };
  }, [open, focusables]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, focusables]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop: presentational only, never focusable. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        // MIXED, NOT DIMMED — see billing-identity-card.tsx. `/40` on
        // a plain-hex `var()` token paints nothing, and a scrim that
        // paints nothing is a dialog with no backdrop at all.
        className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-primary)_40%,transparent)]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative z-10 w-full max-w-lg rounded-lg bg-surface shadow-overlay",
          "max-h-[90vh] overflow-y-auto",
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold text-content">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="inline-flex size-8 min-h-control shrink-0 items-center justify-center rounded-control text-content-muted hover:text-content"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer ? <div className="border-t border-line px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
