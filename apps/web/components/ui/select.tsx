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
 * NO OUTLINE, for the same reason inputs have none: the reference
 * draws a chooser as a lifted white shape, not a shape inside a line.
 * The border is kept transparent so the error state can colour it
 * without the control changing size.
 *
 * RAISED, BUT LESS THAN A BUTTON. A select is pressed, so it lifts —
 * and it is never the action on the screen, so it lifts less. It is
 * the one control between a field and a button, and it looks like
 * it.
 */
/**
 * The same 36px and the same padding as an Input, with `shadow-soft`
 * where the Input has `shadow-inset`. Shared with the searchable
 * select, the date field and the period picker, so every chooser on
 * the platform is one shape.
 */
/**
 * THE SKIN WITHOUT ITS HEIGHT.
 *
 * The height is separated so the component can choose one — a chooser
 * standing in a form column is a field at 36px, and a chooser standing
 * in a toolbar beside a button is 32px. Everything else about the two
 * is identical, which is why only this one class moves.
 *
 * IT CANNOT BE DONE FROM OUTSIDE. `cn` joins classes and does not merge
 * them, so an `h-control` passed in `className` and the skin's own
 * `h-field` would both reach the stylesheet, where `h-field` is emitted
 * later and wins. The override has to happen before the join.
 */
const SELECT_SKIN = cn(
  "block w-full rounded-control bg-surface text-content",
  "border border-transparent px-control-x",
  "text-[length:var(--control-font-size)] leading-[var(--control-line-height)]",
  "shadow-soft focus-visible:shadow-soft-focus",
  "disabled:opacity-[var(--state-disabled-opacity)] disabled:cursor-not-allowed",
  "aria-[invalid=true]:border-danger",
);

/** The lifted chooser at its default height, for anything wearing the
 *  skin without going through the component — the searchable select. */
export const SELECT_CLASSES = cn(SELECT_SKIN, "h-field");

/**
 * THE OUTLINED CHOOSER — white with a line and no lift.
 *
 * The same skin the field wears on the screens the owner has moved to
 * the approved reference, so a select and the input beside it are one
 * shape there too. It is opt-in; the lifted chooser stays the default.
 *
 * The 36px, the padding, the radius and the type all come from the
 * same tokens as the default skin — what changes is the boundary and
 * the elevation, and nothing else.
 */
const SELECT_OUTLINED_SKIN = cn(
  "block w-full rounded-control bg-surface text-content",
  "border border-line-control px-control-x",
  "text-[length:var(--control-font-size)] leading-[var(--control-line-height)]",
  "shadow-none focus-visible:shadow-[var(--ring-focus)]",
  "disabled:opacity-[var(--state-disabled-opacity)] disabled:cursor-not-allowed",
  "aria-[invalid=true]:border-danger",
);

export const SELECT_OUTLINED_CLASSES = cn(SELECT_OUTLINED_SKIN, "h-field");

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  describedById?: string;
  /**
   * `chooser` — lifted and white, the default everywhere.
   * `outlined` — white with a line, matching the outlined field.
   */
  appearance?: "chooser" | "outlined";
  /**
   * How tall the chooser stands.
   *
   * `field` — 36px, the default. A chooser in a form column is one of
   * the fields and lines up with them; it is taller than a button
   * because text sits in it.
   *
   * `control` — 32px, the button's height. «الزر حق آخر 90 يومًا عريض،
   * خلّه 32 بكسل ارتفاعه ووازنه مع الزر اللي جنبه». A chooser in a
   * TOOLBAR is not standing with fields, it is standing beside a
   * button, and four pixels taller than the thing next to it reads as
   * a mistake rather than as a hierarchy.
   */
  heightAs?: "field" | "control";
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    invalid,
    describedById,
    className,
    children,
    appearance = "chooser",
    heightAs = "field",
    ...props
  },
  ref
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      aria-describedby={describedById}
      // `chooser-native` is the hook the stylesheet needs to dress
      // this element's OPEN LIST, which no class on the element can
      // reach. It is on the component rather than in SELECT_CLASSES
      // because the searchable select wears that skin on an <input>
      // and draws its own list already.
      className={cn(
        appearance === "outlined" ? SELECT_OUTLINED_SKIN : SELECT_SKIN,
        heightAs === "control" ? "h-control" : "h-field",
        "chooser-native",
        invalid && "border-danger",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
});
