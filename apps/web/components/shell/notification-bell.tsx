import Link from "next/link";
import { Bell } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getLocale } from "next-intl/server";

/**
 * The bell, and it is only ever a real one.
 *
 * It links to the portal's own notifications page and carries the
 * unread count that page reports — the same figure, read once on the
 * server and passed down, so the badge and the list can never disagree.
 *
 * WHEN THE COUNT COULD NOT BE READ the bell still works and simply
 * wears no badge. A notifications page reachable in one click is worth
 * more than a number, and a "0" invented after a failed read would be a
 * claim that there is nothing waiting.
 *
 * THE COUNT IS ANNOUNCED, not just painted. A badge is a visual
 * affordance; the link's accessible name carries "N unread" so the
 * figure is not lost to anyone who cannot see the dot.
 *
 * 99+ RATHER THAN A LONG NUMBER. Past two digits the exact figure stops
 * being information and starts being a layout problem in a 32px
 * control.
 */
export interface NotificationBellProps {
  href: string;
  /** Undefined when the count could not be read. */
  unread?: number;
  /**
   * Whether the bell is drawn LOUD — bigger, filled, in the accent.
   *
   * ONE FLAG FOR ONE DECISION, and it defaults to off. The supplier's
   * bell hangs at the end of a row of file tabs on a dark ground, where
   * a sixteen-pixel outline in the bar's own colour disappears; every
   * other portal keeps the quiet bell it has in the platform's bar, and
   * keeps it because nothing else passes this.
   */
  prominent?: boolean;
}

/**
 * IT TRANSLATES ITSELF rather than taking sentences as props.
 *
 * The count is only known here, so a sentence handed in would arrive
 * with its `{count}` unfilled and have to be patched with
 * `String.replace` — which means ICU never formats the number, and an
 * Arabic reader gets neither plural agreement nor locale digits.
 */
export async function NotificationBell({
  href,
  unread,
  prominent = false,
}: NotificationBellProps) {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "shell.header" });
  const count = typeof unread === "number" && unread > 0 ? unread : 0;
  const shown = count > 99 ? "99+" : String(count);

  return (
    <Link
      href={href}
      data-testid="notification-bell"
      aria-label={
        count > 0
          ? `${t("notifications")} — ${t("notificationsUnread", { count })}`
          : t("notifications")
      }
      className={
        "relative inline-flex shrink-0 items-center justify-center rounded-control " +
        "hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
        (prominent
          ? // FORTY PIXELS AND THE ACCENT. «كبّر زر الإشعارات والتنبيهات
            // وخلّه ممتلئ وليس مفرّغ وبلون الهوية البرتقالي» — measured
            // against the ground it stands on: the platform's amber on
            // the portal's navy carries 7.6 to 1, well past the 3 to 1
            // WCAG 1.4.11 asks of a control's own shape.
            "size-10 text-accent"
          : "size-8 min-h-control text-primary-foreground")
      }
    >
      {/* FILLED, NOT OUTLINED — «ممتلئ وليس مفرّغ». A lucide glyph is a
          stroked path, so the fill is the shape's inside rather than a
          second icon. */}
      <Bell
        aria-hidden="true"
        fill={prominent ? "currentColor" : "none"}
        className={prominent ? "size-6" : "size-control"}
      />
      {count > 0 ? (
        // `aria-hidden`: the number is already in the link's accessible
        // name above, and announcing it twice is worse than once.
        <span
          aria-hidden="true"
          data-testid="notification-bell-count"
          className="absolute -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent-interactive px-1 text-[10px] font-medium leading-4 text-accent-interactive-foreground end-0"
        >
          {shown}
        </span>
      ) : null}
    </Link>
  );
}
