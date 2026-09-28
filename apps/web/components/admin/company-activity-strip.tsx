import type { ReactNode } from "react";

/**
 * WHAT THIS COMPANY HAS DONE — FOUR SMALL CARDS IN THE TITLE ROW.
 *
 * «هذا الحقل مكوّن من أربعة أجزاء، خلّ كل جزء في بطاقة، في طرفها لون،
 *  وارفعها في الشريط اللي فوقها في المساحة الفاضية بين اسم المورّد أو
 *  المشتري وأزرار التوثيق. وتكون البطاقة بارتفاع صفّ واحد صغيرة، لا
 *  تجي بارتفاع كبير.»
 *
 * IT WAS A CARD OF ITS OWN AT THE FOOT OF THE PAGE — a heading and four
 * figures in a grid, each with a line for its label and a line for its
 * number. Then it was one strip under the name, which was shorter and
 * still a row of the page spent on four numbers.
 *
 * NOW IT COSTS NO ROW AT ALL. The title row already had the space: a
 * company name takes a third of it and the verification line sits at
 * the far end, so the four readings ride in the gap between them.
 *
 * ONE LINE HIGH, EACH. The label and the figure share a baseline inside
 * a card about twenty-six pixels tall — anything taller would make the
 * title row grow to hold them, which is the row this was moved into
 * precisely because it was already there.
 *
 * THE COLOUR IS ON THE EDGE, not behind the text. A tinted card would
 * be four coloured blocks competing with the company's own name; a
 * four-pixel rule on the leading edge tells them apart at a glance and
 * leaves the figure on white, where it is legible. Each colour is a
 * token the platform already uses — nothing here invents a shade.
 *
 * NO HEADING. Every reading is labelled, and a title over four labelled
 * numbers is the standing explanation this console does not carry.
 *
 * THE SAME FOUR FOR BOTH KINDS. A supplier's orders are the ones it
 * sells and a buyer's are the ones it places — the page resolves which
 * before handing them over, so this draws what it is given.
 */

/** The leading edge, from the platform's own tokens. */
const EDGE = {
  secondary: "border-s-secondary",
  accent: "border-s-accent",
  primary: "border-s-primary",
  danger: "border-s-danger",
} as const;

export type ActivityTone = keyof typeof EDGE;

export function CompanyActivityStrip({
  readings,
}: {
  readings: readonly {
    key: string;
    label: string;
    tone: ActivityTone;
    /** A count as text, or an amount carrying the drawn riyal symbol. */
    value: ReactNode;
  }[];
}) {
  return (
    <dl
      className="flex min-w-0 flex-wrap items-center gap-2"
      data-testid="card-activity"
    >
      {readings.map((reading) => (
        <div
          key={reading.key}
          className={
            "flex min-w-0 items-baseline gap-2 rounded-card border border-line " +
            "border-s-4 bg-surface px-2 py-1 shadow-card " +
            EDGE[reading.tone]
          }
        >
          <dt className="whitespace-nowrap text-xs text-content-muted">
            {reading.label}
          </dt>
          <dd
            className="truncate text-sm font-semibold text-content tabular-nums"
            data-testid={`metric-${reading.key}`}
          >
            {/* `<bdi>` RATHER THAN `dir="ltr"`: `dir` would change this
                cell's own paragraph direction and with it the default
                alignment, so on an Arabic page the label and its figure
                would sit at opposite ends. `<bdi>` isolates the DIGITS —
                "2,781.25 ر.س" keeps its parts in order — and leaves the
                alignment to inherit. */}
            <bdi>{reading.value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}
