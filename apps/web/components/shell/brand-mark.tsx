import Link from "next/link";
import type { BrandingPublic } from "@platform/types";
import { mediaUrl } from "@/lib/media-url";
import { brandLogoUrl } from "@/lib/branding";

/**
 * The identity in the header: ONE logo image, linking home.
 *
 * NO NAME IS EVER PRINTED HERE — not beside the image, not beneath it,
 * and not as a stand-in when the image is missing. The mark carries the
 * symbol and the wordmark inside the artwork itself, so a name in text
 * next to it says the same thing twice in a different typeface. That
 * also means this component never reads `nameAr`/`nameEn`: it cannot
 * print a brand name it does not know about.
 *
 * WHEN THERE IS NO LOGO, blank space holds the place — no name, no
 * initials, no invented wordmark, and no FRAME either. A dashed
 * rectangle used to sit there; on a bar painted the identity colour it
 * reads as a broken image rather than as room being kept. The link
 * still carries the accessible name and still reaches the home page.
 *
 * THE HEADER IMPOSES NO SHAPE. A logo may be square, wide, or anything
 * between, and cropping or stretching an operator's mark to fit a box
 * this file chose would be a design decision taken away from them.
 * `object-contain` inside a max height AND the width its cell allows
 * lets the image keep its own proportions and settle inside whichever
 * bound it meets first. The WIDTH CEILING lives on the header cell
 * rather than here, so the mark can also give way on a narrow phone
 * instead of pushing the sign-in button into wrapping.
 *
 * A MARK PER LANGUAGE, falling back rather than failing — see
 * `brandLogoUrl`. There is no dark variant, because the platform has no
 * dark theme.
 *
 * ACCESSIBLE NAMING. The LINK is what a reader activates, so the link
 * carries the name of what it does — "Go to homepage" — and that
 * `aria-label` is what assistive technology announces. The image's
 * `alt` is a generic description of the picture rather than a brand
 * string, so nothing here needs to know the tenant's name.
 *
 * A plain <img>, not next/image: the URL is an arbitrary absolute URL
 * from an admin-managed setting, and next/image would need every
 * possible host pre-registered in next.config.
 */
export interface BrandMarkProps {
  branding: BrandingPublic;
  /** Generic picture description, e.g. "Platform logo" — never a brand name. */
  logoAlt: string;
  /** What activating the mark does, e.g. "Go to homepage". */
  homeLabel: string;
  homeHref: string;
  variant?: "main" | "small";
}

export function BrandMark({
  branding,
  logoAlt,
  homeLabel,
  homeHref,
  variant = "main",
}: BrandMarkProps) {
  // The small variant is a SIZE, and no per-language small mark exists;
  // it keeps reading the field it always read.
  // BOTH VARIANTS GO THROUGH THE HELPER. `brandLogoUrl` already
  // absolutises the header mark; the small one read its field raw and
  // would have 404'd the day an operator uploaded one — it is null
  // today, which is the only reason it has never been seen to fail.
  const logoUrl =
    variant === "small" ? mediaUrl(branding.logoSmallUrl) : brandLogoUrl(branding);

  return (
    <Link
      href={homeHref}
      aria-label={homeLabel}
      data-testid="brand-mark"
      className="inline-flex max-w-full items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={logoAlt}
          data-testid="brand-mark-logo"
          className="h-auto max-h-8 w-auto max-w-full object-contain"
        />
      ) : (
        // Blank on purpose. The link above already carries the
        // accessible name, so this is hidden rather than announced as
        // an empty image.
        // NOTHING DRAWN AT ALL. It used to be a dashed rectangle
        // holding the space, which on a bar painted the identity
        // colour reads as a broken image rather than as room being
        // kept. The link still carries the accessible name and still
        // reaches the home page; it simply has no picture in it until
        // an operator uploads one.
        <span
          aria-hidden="true"
          data-testid="brand-mark-placeholder"
          className="block h-8 w-24 max-w-full"
        />
      )}
    </Link>
  );
}
