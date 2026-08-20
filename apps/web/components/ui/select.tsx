import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * A native `<select>`.
 *
 * Native rather than a custom listbox on purpose: the platform control
 * already gives keyboard navigation, type-ahead, correct RTL rendering
 * and — on mobile — the OS picker, none of which a hand-rolled
 * replacement reproduces for free.
 *
 * Borders use `border-line-strong` for the same reason inputs do: a
 * control whose border is its only boundary must clear the 3:1
 * non-text contrast requirement.
 */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  describedById?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, describedById, className, children, ...props },
  ref
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      aria-describedby={describedById}
      className={cn(
        "block w-full rounded-md bg-surface text-content",
        "border px-3 py-2 text-sm",
        invalid ? "border-danger" : "border-line-strong",
        "disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
});
