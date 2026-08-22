import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Trader portal navigation.
 *
 * A `<nav>` of links, never buttons: these are navigations, and a
 * screen reader must hear them as such. It wraps rather than scrolls
 * horizontally, so at 360px the links reflow onto a second line
 * instead of pushing the page sideways.
 *
 * A destination that does not exist yet is rendered as inert text with
 * a translated "coming soon" note — never as a link that 404s, and
 * never silently omitted, because a gap in the menu is harder to
 * understand than an item that says it is not ready.
 */
export interface TraderNavItem {
  key: string;
  /** Already translated. */
  label: string;
  /** Locale-prefixed internal path, or null while the page does not exist. */
  href: string | null;
  /** Shown beside an unavailable item, already translated. */
  comingSoonLabel?: string;
  /** Rendered as a badge — the unread notification count. */
  badge?: number;
}

export interface TraderNavProps {
  /** Accessible name for the landmark, already translated. */
  navLabel: string;
  items: readonly TraderNavItem[];
  className?: string;
}

export function TraderNav({ navLabel, items, className }: TraderNavProps) {
  return (
    <nav aria-label={navLabel} className={cn("border-b border-line bg-surface", className)}>
      <ul className="mx-auto flex max-w-6xl list-none flex-wrap gap-1 px-4 py-2">
        {items.map((item) => {
          // The badge renders in BOTH branches. An unread count is worth
          // showing even while its screen is still being built — it tells
          // someone something is waiting for them, which is exactly when
          // they most need to know.
          const badge =
            item.badge !== undefined && item.badge > 0 ? (
              <span className="rounded-full bg-accent-interactive px-2 py-0.5 text-xs font-semibold text-accent-interactive-foreground">
                {item.badge}
              </span>
            ) : null;

          return (
            <li key={item.key}>
              {item.href ? (
                <Link
                  href={item.href}
                  className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-content hover:bg-background"
                >
                  {item.label}
                  {badge}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-content-muted"
                >
                  {item.label}
                  {badge}
                  {item.comingSoonLabel ? (
                    <span className="rounded-md bg-background px-2 py-0.5 text-xs">
                      {item.comingSoonLabel}
                    </span>
                  ) : null}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
