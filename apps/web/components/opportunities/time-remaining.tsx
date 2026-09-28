"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { timeLeftUntil, type TimeLeft } from "@/lib/localized";

/**
 * HOW LONG IS LEFT, counted from now.
 *
 * The owner's shape: «7 أيام» or «24 يومًا و5 ساعات», and it has to be
 * live — a supplier sets a DURATION, and what a buyer reads is what
 * remains of it.
 *
 * A CLIENT COMPONENT, and that is the design rather than a detail. The
 * value depends on the reader's clock at the moment they look.
 * Rendered on the server it would be stale before it reached the
 * browser, and hydration would swap one number for another under a
 * reader's eyes — React calls that a mismatch and it would be right to.
 * So the server renders NOTHING here and the browser fills it in, which
 * is honest about where the answer comes from.
 *
 * WHAT THE SERVER RENDERS INSTEAD is the closing timestamp, beside this
 * — already there, already exact, and what anybody planning around the
 * cut-off actually needs. This is the reading at a glance.
 *
 * IT TRANSLATES ITSELF rather than taking sentences as props. The first
 * draft took them, and a guard caught what that costs: the numbers are
 * only known here, so the strings arrived with their `{days}`
 * placeholders unfilled and were patched with `String.replace` — which
 * means next-intl never formats the number, so an Arabic reader gets no
 * plural agreement and no locale digits. `useTranslations` inside the
 * component hands the values to ICU where they belong.
 *
 * IT TICKS ONCE A MINUTE. Hours change on the hour; faster wakes the
 * page for nothing, slower shows an hour that has already gone.
 */
export interface TimeRemainingProps {
  /** ISO 8601. When the offer closes. */
  endAt: string;
  className?: string;
}

export function TimeRemaining({ endAt, className }: TimeRemainingProps) {
  const t = useTranslations("timeRemaining");
  const [left, setLeft] = useState<TimeLeft | null | undefined>(undefined);

  useEffect(() => {
    const read = () => setLeft(timeLeftUntil(endAt));
    read();
    const timer = setInterval(read, 60_000);
    return () => clearInterval(timer);
  }, [endAt]);

  // BEFORE MOUNT: nothing at all, not a placeholder. A dash or a
  // spinner in a line of text is a flicker on every page load for a
  // value that arrives in the same frame.
  if (left === undefined) return null;

  const text =
    left === null
      ? t("ended")
      : left.days === 0
        ? left.hours === 0
          ? t("lessThanHour")
          : t("hours", { hours: left.hours })
        : left.hours === 0
          ? t("days", { days: left.days })
          : t("daysAndHours", { days: left.days, hours: left.hours });

  return (
    <span data-testid="time-remaining" className={className}>
      {text}
    </span>
  );
}
