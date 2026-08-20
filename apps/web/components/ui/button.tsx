import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Colour rules encoded as types, not conventions
 * (docs/PHASE_8_IMPLEMENTATION_PLAN.md §14):
 *
 *   - `accent` (gold #F59E0B) pairs with DARK text only — white on gold
 *     measures 2.15:1 and fails AA. There is no white-on-gold variant to
 *     choose by mistake.
 *   - The orange button with white text is `accentInteractive`
 *     (#B45309, 5.02:1), never `accent`.
 *
 * No visible text lives here: every label arrives via `children`, which
 * the caller sources from next-intl.
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "accent"
  | "accentInteractive"
  | "danger"
  | "ghost";

export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
  accent: "bg-accent text-accent-foreground hover:opacity-90",
  accentInteractive: "bg-accent-interactive text-accent-interactive-foreground hover:opacity-90",
  danger: "bg-danger text-danger-foreground hover:opacity-90",
  ghost: "bg-transparent text-content border border-line hover:bg-background",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "text-sm px-3 py-1.5",
  md: "text-sm px-4 py-2",
  lg: "text-base px-5 py-2.5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders a busy state and blocks activation. Requires an accessible label from the caller. */
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", isLoading = false, className, disabled, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium",
        "transition-opacity disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
});
