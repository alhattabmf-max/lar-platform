import type { SVGProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Line icons, drawn here rather than installed.
 *
 * The product ships no icon package and this needs a handful of glyphs, so a
 * dependency would be a lot of surface for a small, fixed set. They are
 * plain SVG in the same style the app already used for the no-image
 * placeholder: a 24-unit box, no fill, `currentColor` stroke.
 *
 * They replace Unicode glyphs — ▤ ◎ ◈ ◍ ▣ — which were never a design
 * decision. Those render from whatever font the reader happens to have,
 * so their weight, size and vertical alignment differed between
 * machines and none of them actually depicted the thing they labelled.
 *
 * DECORATIVE, ALWAYS. Every icon here sits beside a text label that
 * carries the meaning, so each is `aria-hidden` and none takes a title.
 * An icon announced next to the words it decorates is read twice.
 *
 * Colour comes from `currentColor`, so the caller decides it once on a
 * wrapper rather than each glyph carrying its own.
 */

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Icon({ className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // One size and one weight for the whole set: a row of labelled
      // figures reads as a list only if its markers line up.
      className={cn("h-4 w-4 shrink-0", className)}
      {...props}
    />
  );
}

/** Region — a map pin. */
export function MapPinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 10.5c0 5.25-8 10.5-8 10.5S4 15.75 4 10.5a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10.5" r="2.75" />
    </Icon>
  );
}

/** Minimum order — a shopping cart. */
export function CartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.75 4h2.1l2.4 10.2a1.8 1.8 0 0 0 1.75 1.4h7.9a1.8 1.8 0 0 0 1.75-1.35L21.25 7.5H5.75" />
      <circle cx="9.5" cy="19.25" r="1.5" />
      <circle cx="17.5" cy="19.25" r="1.5" />
    </Icon>
  );
}

/** Signing in — an arrow entering a door. */
export function SignInIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 3.5h4a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-4" />
      <path d="M10 16.5 14.5 12 10 7.5" />
      <path d="M14.5 12H3.5" />
    </Icon>
  );
}

/**
 * Signing out — the same door, the arrow leaving it.
 *
 * DELIBERATELY THE MIRROR of `SignInIcon`: the frame is identical and
 * only the arrow reverses, so the two controls read as one pair in the
 * same corner of the bar rather than as two unrelated buttons.
 *
 * It is NOT flipped for RTL. A door with an arrow is a picture, not
 * text, and mirroring it in Arabic would make sign-out point the way
 * sign-in does in English.
 */
export function SignOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 3.5h-4A1.5 1.5 0 0 0 4 5v14a1.5 1.5 0 0 0 1.5 1.5h4" />
      <path d="M16 16.5 20.5 12 16 7.5" />
      <path d="M20.5 12H9.5" />
    </Icon>
  );
}

/**
 * A FILLED base — the same 24 frame, painted rather than drawn.
 *
 * «غيّر الأيقونتين بنفس الأيقونات الممتلئة وليس المفرّغة» — the stroked
 * set reads lighter than a solid glyph beside it, which is exactly why
 * the bell looked bigger than the two next to it at the identical size.
 */
function SolidIcon({
  className,
  children,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("h-4 w-4 shrink-0", className)}
      {...props}
    >
      {children}
    </svg>
  );
}

/**
 * The globe, solid — a filled disc with its meridians cut out of it.
 *
 * THE LINES ARE THE GROUND, NOT WHITE. A solid glyph with white lines
 * would be right on one surface and wrong on every other; these are
 * stroked in `--color-background`, which is the ground the row this
 * icon lives in is painted on. It is exact where it is used, and the
 * test beside it holds it there.
 */
export function GlobeSolidIcon({ className, ...props }: IconProps) {
  return (
    <SolidIcon className={className} {...props}>
      <circle cx="12" cy="12" r="10.5" />
      <g stroke="var(--color-background)" strokeWidth="1.6" fill="none" strokeLinecap="round">
        <path d="M1.9 8.6h20.2M1.9 15.4h20.2" />
        {/* The meridians: a bare disc with latitudes alone reads as a
            target, which is a different icon in this very set. */}
        <path d="M12 1.5v21" />
        <path d="M12 1.5a15 15 0 0 0 0 21a15 15 0 0 0 0-21Z" />
      </g>
    </SolidIcon>
  );
}

/** A person, solid — a head and the shoulders under it, both filled. */
export function UserSolidIcon({ className, ...props }: IconProps) {
  return (
    <SolidIcon className={className} {...props}>
      <circle cx="12" cy="7.75" r="4.25" />
      <path d="M12 13.5c-4.4 0-8 2.9-8 6.5 0 .55.45 1 1 1h14c.55 0 1-.45 1-1 0-3.6-3.6-6.5-8-6.5Z" />
    </SolidIcon>
  );
}
