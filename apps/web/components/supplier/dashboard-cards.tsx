import type { ReactNode } from "react";
import { FileClock, ReceiptText, Tag, Users } from "lucide-react";
import type { SupplierDashboardCards } from "@platform/types";
import { Money } from "@/components/ui/money";
import type { AppLocale } from "@/i18n/routing";

/** Every amount on this platform is Saudi riyals. */
const SAR = "SAR";

/**
 * THE FOUR FIGURES ACROSS THE TOP, as the approved reference draws
 * them.
 *
 * ONE IS DARK AND THREE ARE LIGHT, and that is the reference's own
 * hierarchy rather than decoration: the money a supplier earned is the
 * one figure the screen is about, and the other three qualify it.
 *
 * EACH LIGHT CARD CARRIES A COLOURED EDGE on its leading side, taken
 * from the identity tokens so a re-themed brand follows.
 *
 * A COMPARISON THAT CANNOT BE MADE IS AN EM DASH. A supplier's first
 * month has no predecessor, and «+0%» would be a claim that nothing
 * moved when in fact nothing is known.
 */

export interface DashboardCardsLabels {
  paidOrders: string;
  paidOrdersCompare: string;
  unsettled: string;
  unsettledNote: string;
  buyers: string;
  newBuyers: string;
  noNewBuyers: string;
  opportunities: string;
  endingSoon: string;
  noneEndingSoon: string;
  /** Shown where a percentage cannot be computed. */
  noComparison: string;
}

export function SupplierDashboardCards({
  cards,
  locale,
  labels,
}: {
  cards: SupplierDashboardCards;
  locale: AppLocale;
  labels: DashboardCardsLabels;
}) {
  const change = cards.paidOrders.changePercent;

  return (
    <div
      className="grid gap-card-gap sm:grid-cols-2 xl:grid-cols-4"
      data-testid="dashboard-cards"
    >
      {/* THE ONE FIGURE THE SCREEN IS ABOUT — dark, and first. */}
      <div
        className="flex min-w-0 flex-col gap-1 rounded-card bg-primary px-card-x py-card-y shadow-card"
        data-testid="card-paid-orders"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm text-primary-foreground">
            {labels.paidOrders}
          </span>
          <ReceiptText
            className="size-6 shrink-0 text-primary-foreground"
            aria-hidden
          />
        </div>
        <span
          className="truncate text-2xl font-semibold text-primary-foreground"
          data-testid="paid-orders-value"
        >
          <Money
            amount={cards.paidOrders.value}
            currency={SAR}
            locale={locale}
            fallback={cards.paidOrders.value}
          />
        </span>
        <span className="flex flex-wrap items-center gap-1 text-xs text-primary-foreground">
          {labels.paidOrdersCompare}
          <bdi
            className={
              change === null
                ? "font-medium"
                : change >= 0
                  ? "font-medium text-success"
                  : "font-medium text-danger"
            }
            data-testid="paid-orders-change"
          >
            {change === null
              ? labels.noComparison
              : `${change >= 0 ? "+" : ""}${change}%`}
          </bdi>
        </span>
      </div>

      <LightCard
        edge="border-s-line-strong"
        icon={<FileClock className="size-6 text-content-muted" aria-hidden />}
        title={labels.unsettled}
        value={
          <Money
            amount={cards.unsettledPayable}
            currency={SAR}
            locale={locale}
            fallback={cards.unsettledPayable}
          />
        }
        note={labels.unsettledNote}
        testId="card-unsettled"
      />

      <LightCard
        edge="border-s-secondary"
        icon={<Users className="size-6 text-content-muted" aria-hidden />}
        title={labels.buyers}
        value={String(cards.buyers.value)}
        note={
          cards.newBuyers > 0
            ? `${cards.newBuyers} ${labels.newBuyers}`
            : labels.noNewBuyers
        }
        noteTone={cards.newBuyers > 0 ? "text-secondary" : undefined}
        testId="card-buyers"
      />

      <LightCard
        edge="border-s-accent"
        icon={<Tag className="size-6 text-accent" aria-hidden />}
        title={labels.opportunities}
        value={String(cards.activeOpportunities)}
        note={
          cards.opportunitiesEndingSoon > 0
            ? `${cards.opportunitiesEndingSoon} ${labels.endingSoon}`
            : labels.noneEndingSoon
        }
        noteTone={
          cards.opportunitiesEndingSoon > 0 ? "text-accent" : undefined
        }
        testId="card-opportunities"
      />
    </div>
  );
}

/**
 * One of the three light cards.
 *
 * THE EDGE IS A BORDER ON THE LEADING SIDE — `border-s`, so it is on
 * the right in Arabic and the left in English rather than frozen to
 * one of them.
 */
function LightCard({
  edge,
  icon,
  title,
  value,
  note,
  noteTone,
  testId,
}: {
  edge: string;
  icon: ReactNode;
  title: string;
  value: ReactNode;
  note: string;
  noteTone?: string;
  testId: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-card border-s-4 bg-surface px-card-x py-card-y shadow-card ${edge}`}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-content-muted">{title}</span>
        <span className="shrink-0">{icon}</span>
      </div>
      <span className="truncate text-2xl font-semibold text-content">
        {value}
      </span>
      <span className={`text-xs ${noteTone ?? "text-content-muted"}`}>
        {note}
      </span>
    </div>
  );
}
