import { cn } from "@/lib/cn";

/**
 * THE SAUDI RIYAL SYMBOL — the official mark, drawn.
 *
 * IT HAS TO BE A DRAWING. The 2025 symbol has no Unicode code point,
 * so there is no character to type and no font that carries it. U+FDFC
 * ﷼ is the OLD sign and is a different mark; «ر.س» and "SAR" are an
 * abbreviation and a code, not the symbol. The path below is the
 * official artwork, unaltered — only its hard-coded fill is gone.
 *
 * THE BRAND TEAL, BY THE OWNER'S CHOICE — #0F766E, which is exactly
 * `--color-secondary` and therefore a TOKEN here, never a hex. The
 * file ships `fill: #231f20`; a near-black mark beside a navy figure
 * was the first thing that had to go, and painting it in the identity
 * colour is what makes an amount recognisable at a glance.
 *
 * IT CAN STILL INHERIT. `tone="inherit"` takes the surrounding text
 * colour instead, for a surface the teal cannot be read on — measured,
 * the teal is 5.47:1 on a white card and 3.05:1 on the navy one, which
 * clears the 3:1 a graphic must meet but sits dimmer than the white
 * digits beside it.
 *
 * SIZED IN `em`, NOT PIXELS. The symbol belongs to whatever type it
 * appears in: 24px beside a dashboard figure, 14px in a table cell,
 * and it scales with the reader's own font size. A fixed pixel height
 * would be right in exactly one place.
 *
 * ALIGNED BY ITS OWN BOX. The glyph's artwork fills its viewBox top to
 * bottom, so it is set to cap height and nudged down onto the
 * baseline — otherwise it rides high above the digits beside it.
 *
 * DECORATIVE BY DEFAULT. The currency is announced as WORDS by the
 * component that renders an amount, so this carries `aria-hidden` and
 * a screen reader hears «ريال سعودي» rather than "image".
 */

/** Width ÷ height of the official artwork's viewBox. */
export const RIYAL_ASPECT = 1124.14 / 1256.39;

export type RiyalTone = "brand" | "inherit";

export interface RiyalProps {
  /**
   * Height, as a multiple of the current font size.
   *
   * `0.82` is cap height for the type this product uses — the mark then
   * stands as tall as the digits beside it rather than as tall as the
   * line box, which is what makes it sit in the number instead of on
   * top of it.
   */
  em?: number;
  /**
   * `brand` — the identity teal. The default, everywhere.
   * `inherit` — the colour of the text around it.
   */
  tone?: RiyalTone;
  className?: string;
}

export function Riyal({ em = 0.82, tone = "brand", className }: RiyalProps) {
  return (
    <svg
      viewBox="0 0 1124.14 1256.39"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn(
        "inline-block shrink-0",
        tone === "brand" ? "text-secondary" : undefined,
        className
      )}
      style={{
        height: `${em}em`,
        width: `${(em * RIYAL_ASPECT).toFixed(3)}em`,
        // Onto the baseline. The artwork has no side bearings of its
        // own, so the space around it is the caller's gap, not the
        // glyph's.
        verticalAlign: `${(-0.04).toFixed(2)}em`,
      }}
    >
      <path d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z" />
      <path d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z" />
    </svg>
  );
}
