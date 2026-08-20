"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Toasts.
 *
 * The live region is `aria-live="polite"` with `role="status"`, so
 * announcements never interrupt what a screen reader is currently
 * reading. Errors use `role="alert"` (assertive) because they change
 * what the user should do next.
 *
 * Variant colours follow §14.4: the `warning` toast uses the warning
 * SURFACE with `warning-text` (#B45309 on #FFFBEB, 4.84:1) — white on
 * #D97706 measures 3.19:1 and is never used.
 */

export type ToastVariant = "info" | "success" | "warning" | "danger";

export interface Toast {
  id: string;
  variant: ToastVariant;
  /** Already-translated message. This component never translates. */
  message: string;
  /** Optional request id, shown verbatim so a user can quote it to support. */
  requestId?: string | null;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  info: "border-line bg-surface text-content",
  success: "border-success bg-surface text-content",
  warning: "border-warning bg-warning-surface text-warning-text",
  danger: "border-danger bg-surface text-content",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { ...toast, id }]);
    return id;
  }, []);

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside a ToastProvider");
  return context;
}

export function ToastViewport() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed inset-block-end-0 inset-inline-end-0 z-50 flex flex-col gap-2 p-4"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.variant === "danger" ? "alert" : "status"}
          onClick={() => dismiss(toast.id)}
          className={cn(
            "min-w-64 max-w-sm rounded-md border px-4 py-3 text-sm shadow-md",
            VARIANT_CLASSES[toast.variant]
          )}
        >
          <p>{toast.message}</p>
          {toast.requestId ? (
            <p className="mt-1 font-mono text-xs text-content-muted">{toast.requestId}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
