import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

/**
 * The two halves of a register, as tabs rather than as two screens.
 *
 * ONE SIDEBAR ENTRY, TWO TABLES. Buyers and suppliers are the same kind
 * of record with different columns, and splitting them into separate
 * navigation entries would make an operator who does not yet know which
 * kind a company is guess before they can look.
 *
 * A TAB IS A LINK, not a piece of client state. The choice belongs in
 * the URL beside the search and the filters: it survives a reload, it
 * can be pasted to a colleague, and Back returns to the tab you came
 * from. That also means the server renders the right table on the first
 * paint rather than flashing the wrong one.
 *
 * THE COUNTS ARE REAL. Each badge is the number that tab would show
 * under the CURRENT search — not a total that ignores it, which would
 * promise results the tab does not have.
 *
 * AND THEY ARE BUTTONS, NOT A TRACK — «ألغِ الحقل الغائر في الموردون
 * والمشترون، احتفظ بزر المشترون والموردون وحط له زر نفس التصميم».
 *
 * THE SUNKEN TRACK WAS A ROW OF ITS OWN. It said «these two belong
 * together», which two words side by side say without a container —
 * and it cost a row of the page to say it, above a second row that
 * held four more buttons. Wearing the platform's own button, the two
 * stand IN that row with them: same height, same corner, same press.
 *
 * THE CHOSEN ONE IS FILLED and the other is a ghost, which is how
 * every other pair of choices on this console reads.
 */

export interface RegisterTab {
  key: string;
  label: string;
  href: string;
  count: number | null;
  active: boolean;
}

export function RegisterTabs({
  tabs,
  label,
}: {
  tabs: readonly RegisterTab[];
  /** Names the tablist for a screen reader. */
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          // `page` is the tab a reader is on; a screen reader should
          // say so rather than leave them counting.
          aria-current={tab.active ? "page" : undefined}
          data-testid={`register-tab-${tab.key}`}
          // THE PLATFORM'S OWN BUTTON, so the two stand level with
          // the four beside them rather than merely near them.
          className={buttonClasses(tab.active ? "primary" : "ghost", "md")}
        >
          <span>{tab.label}</span>
          {tab.count !== null ? (
            <span
              // Latin digits in both scripts, and `ltr` so a four
              // digit count never reverses.
              dir="ltr"
              className={[
                "rounded-full px-2 py-0.5 text-xs tabular-nums",
                tab.active
                  ? "bg-accent text-accent-foreground"
                  : "bg-background text-content-muted",
              ].join(" ")}
              data-testid={`register-tab-count-${tab.key}`}
            >
              {tab.count}
            </span>
          ) : null}
        </Link>
    ))}
    </nav>
  );
}
