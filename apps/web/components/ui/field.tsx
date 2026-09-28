import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Label, Input and FieldError.
 *
 * Inputs carry NO outline at rest. The fill is the boundary — a well
 * in the surface holding it — which is the shape the approved
 * reference draws. That trades away the 3:1 resting boundary WCAG
 * 1.4.11 asks for (#EEF2F7 on white is 1.12:1); the owner was shown
 * that cost and took it, and it is recorded beside the token in
 * `globals.css`. The border is kept as a transparent pixel so the
 * error state can colour it without the control changing size.
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
  /**
   * A small mark beside the label, as the approved reference draws it.
   *
   * DECORATION, AND ONLY DECORATION. It repeats what the label already
   * says, so it carries `aria-hidden` and nothing depends on a reader
   * seeing it — a form whose meaning lives in its icons is a form
   * half its readers cannot use.
   */
  icon?: ReactNode;
  className?: string;
}

export function Label({
  htmlFor,
  children,
  required,
  requiredLabel,
  icon,
  className,
}: LabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "flex items-center gap-1.5 text-sm font-medium text-content",
        className,
      )}
    >
      {icon ? (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span>
        {children}
        {required && requiredLabel ? (
          <span className="text-danger ms-1" aria-hidden="true">
            *
          </span>
        ) : null}
        {required && requiredLabel ? (
          <span className="sr-only">{requiredLabel}</span>
        ) : null}
      </span>
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

/**
 * WRITTEN INTO, SO PRESSED IN.
 *
 * `shadow-inset` and no outer shadow at all — an outer one would
 * make a field look like something to press, which is the single
 * confusion Soft Elevation exists to remove.
 *
 * SHARED WITH TEXTAREA and with the search box in the list toolbar,
 * because all three are the same thing: a place text goes. The only
 * difference a textarea makes is the height, which it sets itself.
 */
export const FIELD_CLASSES = cn(
  // FILLED, NOT OUTLINED — no line at all. The fill and the inner
  // shadow are the whole of the shape, which is what the reference
  // shows. The cost is recorded beside the token in globals.css.
  "block w-full rounded-control bg-field-fill text-content",
  "border border-transparent px-control-x",
  "text-[length:var(--control-font-size)] leading-[var(--control-line-height)]",
  "shadow-inset focus-visible:shadow-inset-focus",
  "placeholder:text-content-muted",
  "disabled:opacity-[var(--state-disabled-opacity)] disabled:cursor-not-allowed",
  // The error state is a border, not a second shadow: two signals
  // for one fact is how a form starts shouting.
  "aria-[invalid=true]:border-danger",
);

/**
 * A date or a period: PICKED, not typed, so it lifts like a select
 * rather than sinking like a field. It lives beside the field skin
 * because both are things a single input tag can wear.
 */
export const CHOOSER_CLASSES = cn(
  // A chooser is white and lifted, with no line either: what tells
  // it from the card under it is the shadow.
  "block w-full rounded-control bg-surface text-content",
  "border border-transparent px-control-x",
  "text-[length:var(--control-font-size)] leading-[var(--control-line-height)]",
  "shadow-soft focus-visible:shadow-soft-focus",
  "disabled:opacity-[var(--state-disabled-opacity)] disabled:cursor-not-allowed",
  "aria-[invalid=true]:border-danger",
);

/** A single-line field: 36px, fixed. */
export const FIELD_ONE_LINE = "h-field";

/**
 * A textarea takes the same skin and NOT the height: it is the one
 * field whose whole point is holding more than a line.
 */
export const FIELD_MULTI_LINE = "py-control-y";

/**
 * THE THIRD SKIN: white, with a line, and NOTHING PRESSED IN.
 *
 * THE OWNER ASKED FOR IT BY NAME — «واجعل الحقول بيضاء بحد خفيف دون
 * الظل الداخلي» — after seeing the filled skin beside the approved
 * reference for the add-product page. It is declared HERE rather than
 * assembled on that page, because a page writing its own border is
 * how a system stops being one, and a guard refuses it.
 *
 * IT IS NOT THE DEFAULT. The rest of the platform keeps the filled
 * well; this is opted into by the screens the owner has moved.
 *
 * THE LINE IS `--color-border-control`, NOT `--color-border`. The
 * reference draws a hairline that measures 1.23:1 on white, against
 * the 3:1 WCAG 1.4.11 asks of anything that identifies a control —
 * and with no fill and no shadow, this border IS the whole of the
 * shape, so it is the one thing a reader has to be able to see.
 * #8291A6 is the lightest slate that clears the bar on the card AND
 * on the page behind it, which is exactly what the token was chosen
 * for.
 *
 * FOCUS IS THE HALO ALONE. The other two skins add the ring to an
 * elevation they already carry; this one carries none, so there is
 * nothing to compose with.
 */
export const OUTLINED_CLASSES = cn(
  "block w-full rounded-control bg-surface text-content",
  "border border-line-control px-control-x",
  "text-[length:var(--control-font-size)] leading-[var(--control-line-height)]",
  "shadow-none focus-visible:shadow-[var(--ring-focus)]",
  "placeholder:text-content-muted",
  "disabled:opacity-[var(--state-disabled-opacity)] disabled:cursor-not-allowed",
  "aria-[invalid=true]:border-danger",
);

/** Which skin a field wears. Shared by Input, Textarea and Select. */
export type FieldAppearance = "field" | "chooser" | "outlined";

export function skinFor(appearance: FieldAppearance): string {
  if (appearance === "chooser") return CHOOSER_CLASSES;
  if (appearance === "outlined") return OUTLINED_CLASSES;
  return FIELD_CLASSES;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  describedById?: string;
  /**
   * Which of the three skins this input wears.
   *
   * `field` — text goes IN, so the box is pressed in. The default.
   * `chooser` — a date or a period is PICKED, not typed, so it
   *   lifts the way a select does. A date input opens a calendar:
   *   it is a chooser wearing an input tag.
   * `outlined` — white with a line and no elevation, for the screens
   *   the owner has moved to the approved reference.
   */
  appearance?: FieldAppearance;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, describedById, className, appearance = "field", ...props },
  ref
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      aria-describedby={describedById}
      className={cn(skinFor(appearance), FIELD_ONE_LINE, className)}
      {...props}
    />
  );
});

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  describedById?: string;
  /** The same three skins an Input wears. */
  appearance?: FieldAppearance;
}

/**
 * The one field whose whole point is holding more than a line.
 *
 * IT EXISTED NOWHERE, so seven screens wrote their own — each with its
 * own padding, its own border and its own idea of an error state. It
 * takes the field skin and NOT the 36px height: that height is what
 * makes a single-line field a single line.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { invalid, describedById, className, appearance = "field", ...props },
    ref
  ) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        aria-describedby={describedById}
        className={cn(skinFor(appearance), FIELD_MULTI_LINE, className)}
        {...props}
      />
    );
  }
);

export interface FieldProps {
  label: ReactNode;
  error?: ReactNode;
  required?: boolean;
  requiredLabel?: string;
  /** Decoration beside the label — see `LabelProps.icon`. */
  icon?: ReactNode;
  children: (ids: { inputId: string; errorId: string; invalid: boolean }) => ReactNode;
}

/** Composes Label + control + FieldError with generated, stable ids. */
export function Field({
  label,
  error,
  required,
  requiredLabel,
  icon,
  children,
}: FieldProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={inputId}
        required={required}
        requiredLabel={requiredLabel}
        icon={icon}
      >
        {label}
      </Label>
      {children({ inputId, errorId, invalid: Boolean(error) })}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}
