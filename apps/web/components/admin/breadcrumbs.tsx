import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * Where the reader is, one line above the page title.
 *
 * A `<nav>` holding an ordered list, because the order is the meaning —
 * a set of links with no sequence is a menu, not a trail. The last entry
 * is the current page and is NOT a link: an anchor to the page you are
 * already on is a control that does nothing.
 *
 * The separator is `aria-hidden`. `<ol>` already tells assistive
 * technology this is a sequence, and reading an arrow between every pair
 * of items adds noise to the same fact. It is drawn with a single
 * chevron that the document's own direction flips, so the arrow points
 * the way the reader is travelling in both languages with no branch
 * here.
 */

export interface BreadcrumbItem {
  label: string;
  /** Absent on the final entry, which is where the reader already is. */
  href?: string;
}

export function Breadcrumbs({
  items,
  label,
  className,
}: {
  items: readonly BreadcrumbItem[];
  /** Accessible name for the trail, e.g. «مسار التنقل». */
  label: string;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <nav aria-label={label} className={className} data-testid="breadcrumbs">
      <ol className="flex list-none flex-wrap items-center gap-1 text-sm text-content-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;

          return (
            <li
              key={`${item.label}-${index}`}
              className="flex items-center gap-1"
            >
              {index > 0 ? (
                <ChevronLeft
                  aria-hidden="true"
                  // POINTS THE WAY THE READER IS TRAVELLING. Arabic runs
                  // right to left, so the unrotated left-pointing
                  // chevron is already correct there; English is the
                  // case that needs turning over. Rotating on `rtl`
                  // instead produced exactly the wrong arrow in both.
                  className="size-4 shrink-0 ltr:rotate-180"
                />
              ) : null}

              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="rounded-sm hover:text-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className="text-content"
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
