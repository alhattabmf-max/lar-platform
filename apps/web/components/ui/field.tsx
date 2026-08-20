import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Label, Input and FieldError.
 *
 * Inputs use `border-line-strong` (#64748B, 4.76:1) rather than the
 * decorative `border-line` (#E2E8F0, 1.23:1): a control whose border is
 * its only boundary must clear the 3:1 non-text contrast requirement
 * (docs/PHASE_8_IMPLEMENTATION_PLAN.md §14.4 F3).
 *
 * Errors are wired with `aria-describedby` + `aria-invalid` and
 * announced via `role="alert"`, so a screen-reader user hears the
 * problem rather than only seeing a red border.
 */

export interface LabelProps {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
  /** Translated "(required)" text — never hardcoded here. */
  requiredLabel?: string;
  className?: string;
}

export function Label({ htmlFor, children, required, requiredLabel, className }: LabelProps) {
  return (
    <label htmlFor={htmlFor} className={cn("block text-sm font-medium text-content", className)}>
      {children}
      {required && requiredLabel ? (
        <span className="text-danger ms-1" aria-hidden="true">
          *
        </span>
      ) : null}
      {required && requiredLabel ? <span className="sr-only">{requiredLabel}</span> : null}
    </label>
  );
}

export interface FieldErrorProps {
  id: string;
  children?: ReactNode;
  className?: string;
}

export function FieldError({ id, children, className }: FieldErrorProps) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className={cn("text-sm text-danger", className)}>
      {children}
    </p>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  describedById?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, describedById, className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      aria-describedby={describedById}
      className={cn(
        "block w-full rounded-md bg-surface text-content",
        "border px-3 py-2 text-sm",
        invalid ? "border-danger" : "border-line-strong",
        "placeholder:text-content-muted disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});

export interface FieldProps {
  label: ReactNode;
  error?: ReactNode;
  required?: boolean;
  requiredLabel?: string;
  children: (ids: { inputId: string; errorId: string; invalid: boolean }) => ReactNode;
}

/** Composes Label + control + FieldError with generated, stable ids. */
export function Field({ label, error, required, requiredLabel, children }: FieldProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId} required={required} requiredLabel={requiredLabel}>
        {label}
      </Label>
      {children({ inputId, errorId, invalid: Boolean(error) })}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}
