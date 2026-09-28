import { mediaUrl } from "@/lib/media-url";
import { cn } from "@/lib/cn";

/**
 * An opportunity's representative image, or an explicit no-image state.
 *
 * `imageUrl` is null for two entirely normal cases — a product with no
 * media, and any approval snapshot taken before media capture existed —
 * so "no image" is a first-class state here, not an error. It renders a
 * labelled placeholder that occupies the SAME box as a real image, so a
 * grid of cards does not reflow depending on which products happen to
 * have photos.
 *
 * The placeholder is a NEUTRAL box — a muted mark on the page
 * background, never a coloured fill that could be mistaken for the
 * product itself. Whether its label is also printed is the caller's
 * choice: on a card the empty half needs to say what it is, while a
 * detail hero that announced "no image" in large type would read as a
 * failure. Either way a screen reader is told, through the container's
 * accessible name.
 */
export interface OpportunityImageProps {
  src: string | null;
  /** Translated product name — becomes the alt text. */
  productName: string;
  /** Translated "No image available", for the placeholder. */
  noImageLabel: string;
  className?: string;
  /** Real images below the fold should stay lazy; a detail hero should not. */
  priority?: boolean;
  /**
   * Print the no-image label as well as announcing it.
   *
   * Off by default so existing callers are unchanged. The card turns it
   * on: half of a two-column card standing empty with only a faint icon
   * looks like something failed to load, when in fact the offer simply
   * has no photograph.
   */
  showNoImageLabel?: boolean;
}

export function OpportunityImage({
  src,
  productName,
  noImageLabel,
  className,
  priority = false,
  showNoImageLabel = false,
}: OpportunityImageProps) {
  const resolved = mediaUrl(src);
  const box = cn("w-full overflow-hidden rounded-md bg-background", className);

  if (!resolved) {
    return (
      <div
        role="img"
        aria-label={noImageLabel}
        data-testid="opportunity-no-image"
        className={cn(
          box,
          "flex flex-col items-center justify-center gap-2 border border-dashed border-line-control",
        )}
      >
        {/* Decorative mark; the accessible name is on the container. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="h-8 w-8 text-content-muted"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        {showNoImageLabel ? (
          // aria-hidden: the container is already named by the same
          // string, and without this a screen reader reads it twice.
          <span
            aria-hidden="true"
            className="px-2 text-center text-xs text-content-muted"
          >
            {noImageLabel}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    // A plain <img>: these are API routes on another origin with no
    // build-time dimensions, so next/image would need a remote-pattern
    // allowlist per environment for no benefit here.
    <img
      src={resolved}
      alt={productName}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={cn(box, "object-cover")}
    />
  );
}
