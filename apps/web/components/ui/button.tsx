import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
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
  | "ghost"
  | "bare";

/**
 * ONE SIZE.
 *
 * There were three — 32, 36 and 42 pixels tall — and which one a
 * button wore depended on who wrote the screen. The type survives so
 * that callers passing `size="sm"` keep compiling, and every value
 * resolves to the same measurements: a button is 32px tall wherever
 * it appears.
 *
 * 32 ON A PHONE TOO. No breakpoint, and no transparent overlay
 * widening the hit area — the height was tested by touch and
 * adopted, so the painted box is the target.
 */
export type ButtonSize = "sm" | "md" | "lg";

/**
 * COLOUR ONLY. Height, padding, radius, elevation and every
 * interaction state come from the shared rule below, so a new
 * variant cannot arrive a different size by accident.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  accent: "bg-accent text-accent-foreground",
  accentInteractive: "bg-accent-interactive text-accent-interactive-foreground",
  danger: "bg-danger text-danger-foreground",
  // The one variant with no fill: it carries the boundary instead,
  // and stays flat because there is no surface to lift.
  ghost: "bg-transparent text-content border border-line shadow-none hover:bg-background",
  // NO FILL AND NO BOUNDARY EITHER — «ألغِ أي أزرار داخل مربع في أشرطة
  // اللسان واكتفِ بالأيقونة أو الاسم أو الأيقونة والاسم».
  //
  // The strips are the one place a control is already enclosed: the
  // sheet's own band, ruled top and foot. A box drawn inside a box is
  // the second container this design has been striking off all along,
  // and it is what was holding those strips open.
  //
  // IT KEEPS THE HEIGHT AND THE FOCUS RING. A boxless button is still
  // a 32px target — that measure was tested by touch and adopted, and
  // dropping the paint is no reason to drop the reach.
  bare: "bg-transparent text-content border-0 hover:bg-background",
};

/**
 * 32px tall: 6 + 20 + 6, from the tokens and not from a guess.
 *
 * `min-h-control` as well as the padding, so a button holding only
 * an icon is the same height as one holding a word — an icon button
 * that came out 28px beside a 32px text button is the fault this
 * closes.
 */
const CONTROL_METRICS =
  "min-h-control px-control-x py-control-y text-[length:var(--control-font-size)] leading-[var(--control-line-height)]";

/**
 * Shared class computation, so a link styled as a button cannot drift
 * from a real button. Exported rather than duplicated.
 */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string
): string {
  // `size` is accepted and ignored: see the note on ButtonSize.
  void size;

  return cn(
    "inline-flex items-center justify-center gap-control-gap rounded-control font-medium",
    CONTROL_METRICS,
    // RAISED, because it is a thing to press. The press itself goes
    // IN — `active:` swaps the outer shadow for an inner one, which
    // is the whole of the interaction and needs no transform.
    //
    // EXCEPT WHERE THERE IS NOTHING TO RAISE. A shadow under a
    // transparent button draws a floating rectangle with no button in
    // it — which is the very box the strips were asked to be rid of.
    //
    // THE LIFT IS DECIDED HERE AND NOT IN THE VARIANT, because `cn`
    // JOINS classes and does not merge them: a `shadow-none` written
    // beside the fill loses to this line by the stylesheet's own order,
    // silently, whatever the class attribute reads. The variant map is
    // colour only — the comment above it says so — and elevation is a
    // measurement, so it belongs with the measurements.
    //
    // AND THE FOCUS RING SURVIVES THE CHANGE. The raised ring is a
    // shadow, so a button with no shadow needs the outline the rest of
    // this system uses instead. A control nobody can see focus on is
    // not a lighter control, it is a broken one.
    variant === "bare"
      ? "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      : "shadow-raised active:shadow-pressed focus-visible:shadow-raised-focus",
    "transition-[box-shadow,opacity] motion-reduce:transition-none",
    "hover:opacity-[var(--state-hover-opacity)]",
    // Disabled loses the lift as well as the colour: a raised
    // rectangle that refuses to be pressed is a lie about itself.
    "disabled:opacity-[var(--state-disabled-opacity)] disabled:shadow-none disabled:cursor-not-allowed",
    // An icon inside a button is 16px, from the token, so a caller
    // cannot pass a 20px one and break the height.
    "[&_svg]:size-control [&_svg]:shrink-0",
    VARIANT_CLASSES[variant],
    className
  );
}

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
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {children}
    </button>
  );
});

/**
 * A LINK that looks like a button.
 *
 * Deliberately a separate component rather than an `asChild` prop on
 * Button: a navigation and an action are different things to a screen
 * reader and to the keyboard, and collapsing them behind one component
 * makes it easy to ship a `<button>` that navigates or an `<a>` that
 * submits. The caller passes the real element; only the styling is
 * shared.
 */
export interface ButtonLinkProps {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)}>
      {children}
    </Link>
  );
}
