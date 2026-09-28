import Link from "next/link";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Landmark,
  MapPin,
  Package,
  RefreshCcw,
  Truck,
  Hourglass,
} from "lucide-react";
import type {
  OrderAllocationStatus,
  SupplierDashboardAttention,
  SupplierDashboardListing,
  SupplierDashboardSettlements,
  SupplierFulfilmentCounts,
} from "@platform/types";
import { ORDER_ALLOCATION_STATUSES } from "@platform/types";
import { mediaUrl } from "@/lib/media-url";
import { Money } from "@/components/ui/money";
import type { AppLocale } from "@/i18n/routing";

/** Every amount on this platform is Saudi riyals. */
const SAR = "SAR";

/**
 * The four panels below the cards, as the approved reference draws
 * them.
 *
 * EVERY FIGURE COMES FROM THE ONE DASHBOARD READ. Nothing here counts
 * the length of a list, and nothing is estimated: a panel with no data
 * says it has none rather than drawing an empty shape that reads as a
 * zero somebody could act on.
 */

/** The chevron that points the way a language reads. */
function Arrow({ rtl }: { rtl: boolean }) {
  const Icon = rtl ? ChevronLeft : ChevronRight;
  return <Icon className="size-4" aria-hidden />;
}

// ------------------------------------------------ current listings

export interface ListingsPanelLabels {
  title: string;
  viewAll: string;
  manage: string;
  empty: string;
  /** «800 من 1,000 كيس» — the parts, joined by the component. */
  of: string;
  fundedNote: string;
  endsIn: string;
  endsToday: string;
  day: string;
  days: string;
  noRegion: string;
}

export function ListingsPanel({
  listings,
  locale,
  rtl,
  labels,
}: {
  listings: readonly SupplierDashboardListing[];
  locale: AppLocale;
  rtl: boolean;
  labels: ListingsPanelLabels;
}) {
  const ar = locale.startsWith("ar");

  return (
    <section
      className="flex min-w-0 flex-col gap-2 rounded-card bg-surface px-card-x py-card-y shadow-card"
      data-testid="listings-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-content">{labels.title}</h2>
        <Link
          href={`/${locale}/supplier/opportunities`}
          className="inline-flex items-center gap-1 text-sm text-secondary hover:underline"
          data-testid="listings-view-all"
        >
          {labels.viewAll}
          <Arrow rtl={rtl} />
        </Link>
      </div>

      {listings.length === 0 ? (
        <p
          className="py-8 text-center text-sm text-content-muted"
          data-testid="listings-empty"
        >
          {labels.empty}
        </p>
      ) : (
        <ul className="flex list-none flex-col divide-y divide-line">
          {listings.map((listing) => {
            const percent =
              listing.targetQuantity === 0
                ? 0
                : Math.round(
                    (listing.fundedQuantity / listing.targetQuantity) * 100,
                  );
            const remaining = daysUntil(listing.endAt);
            const unit = ar ? listing.salesUnitNameAr : listing.salesUnitNameEn;
            const region = ar ? listing.regionNameAr : listing.regionNameEn;

            return (
              <li
                key={listing.id}
                className="flex min-w-0 flex-wrap items-center gap-3 py-3"
                data-testid={`listing-${listing.id}`}
              >
                {/* THE PICTURE IS THE APPROVED SNAPSHOT'S, served
                    through the route that checks who may see it — never
                    a storage key. A listing with none shows the frame
                    rather than a broken image. */}
                <span className="size-14 shrink-0 overflow-hidden rounded-card bg-background">
                  {listing.imageUrl ? (
                    /* A PLAIN <img>, DELIBERATELY. next/image would
                       proxy and re-encode it, and this picture is
                       served by an API route that decides who may see
                       it — routing it through an optimiser would put a
                       second cache in front of an access decision.
                       `alt=""` because the product name is beside it. */
                    <img
                      // THROUGH `mediaUrl`, which is the whole reason
                      // that helper exists: the API sends a PATH on its
                      // own origin, and a relative `src` resolves
                      // against the WEB origin and 404s. This panel was
                      // rendering the path raw, so «عروضي الجارية» drew
                      // an empty frame for every listing that had a
                      // photograph.
                      src={mediaUrl(listing.imageUrl)}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="grid size-full place-items-center">
                      <Package className="size-6 text-content-muted" aria-hidden />
                    </span>
                  )}
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-semibold text-content">
                    {ar ? listing.productNameAr : listing.productNameEn}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" aria-hidden />
                      {region ?? labels.noRegion}
                    </span>
                    {/* NO COUNTDOWN ON A DIRECT LISTING — it has no
                        closing date, so the badge is omitted rather
                        than saying «ينتهي اليوم» about a shelf that
                        stays up until its owner takes it down. */}
                    {remaining === null ? null : (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--color-accent)_12%,var(--color-surface))] px-2 py-0.5 text-accent"
                        data-testid={`listing-ends-${listing.id}`}
                      >
                        <Clock className="size-3.5" aria-hidden />
                        {remaining <= 0
                          ? labels.endsToday
                          : `${labels.endsIn} ${remaining} ${remaining === 1 ? labels.day : labels.days}`}
                      </span>
                    )}
                  </span>
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <bdi className="text-content">
                      {listing.fundedQuantity.toLocaleString(locale)} {labels.of}{" "}
                      {listing.targetQuantity.toLocaleString(locale)}
                      {unit ? ` ${unit}` : ""}
                    </bdi>
                    <bdi className="font-semibold text-accent">{percent}%</bdi>
                  </span>
                  <span className="block h-2 w-full overflow-hidden rounded-full bg-background">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${Math.min(percent, 100)}%` }}
                    />
                  </span>
                  <span className="text-[10px] text-content-muted">
                    {labels.fundedNote}
                  </span>
                </span>

                <Link
                  href={`/${locale}/supplier/opportunities/${listing.id}`}
                  className="inline-flex shrink-0 items-center gap-1 text-sm text-content hover:underline"
                >
                  {labels.manage}
                  <Arrow rtl={rtl} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------- settlements

export interface SettlementsPanelLabels {
  title: string;
  transferred: string;
  lastTransfer: string;
  none: string;
  viewAll: string;
}

export function SettlementsPanel({
  settlements,
  locale,
  rtl,
  labels,
  formattedDate,
}: {
  settlements: SupplierDashboardSettlements;
  locale: AppLocale;
  rtl: boolean;
  labels: SettlementsPanelLabels;
  /** Formatted on the server — a formatter cannot cross the boundary. */
  formattedDate: string | null;
}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-2 rounded-card bg-surface px-card-x py-card-y shadow-card"
      data-testid="settlements-panel"
    >
      <h2 className="text-base font-semibold text-content">{labels.title}</h2>

      <div className="flex items-center justify-between gap-3 rounded-card bg-primary px-4 py-3">
        <Landmark className="size-6 shrink-0 text-primary-foreground" aria-hidden />
        <span className="flex min-w-0 flex-col items-end">
          <span className="text-xs text-primary-foreground">
            {labels.transferred}
          </span>
          <span
            className="truncate text-lg font-semibold text-primary-foreground"
            data-testid="settlements-transferred"
          >
            <Money
              amount={settlements.transferredInPeriod}
              currency={SAR}
              locale={locale}
              fallback={settlements.transferredInPeriod}
            />
          </span>
        </span>
      </div>

      {/* «آخر تحويل» IS NOT BOUNDED BY THE WINDOW. It answers "when was
          I last paid", and a supplier paid five weeks ago needs that
          answer more than one paid yesterday. */}
      <div className="flex items-center justify-between gap-3 rounded-card border border-line px-4 py-3">
        <Calendar className="size-6 shrink-0 text-content-muted" aria-hidden />
        <span className="flex min-w-0 flex-col items-end">
          <span className="text-xs text-content-muted">
            {labels.lastTransfer}
          </span>
          {settlements.lastTransfer ? (
            <span
              className="truncate text-lg font-semibold text-content"
              data-testid="settlements-last"
            >
              <Money
                amount={settlements.lastTransfer.amount}
                currency={SAR}
                locale={locale}
                fallback={settlements.lastTransfer.amount}
              />
              {formattedDate ? (
                <span className="text-sm font-normal text-content-muted">
                  {" / "}
                  {formattedDate}
                </span>
              ) : null}
            </span>
          ) : (
            <span
              className="text-sm text-content-muted"
              data-testid="settlements-none"
            >
              {labels.none}
            </span>
          )}
        </span>
      </div>

      <Link
        href={`/${locale}/supplier/follow-up`}
        className="inline-flex items-center gap-1 self-start text-sm text-secondary hover:underline"
        data-testid="settlements-view-all"
      >
        {labels.viewAll}
        <Arrow rtl={rtl} />
      </Link>
    </section>
  );
}

// ------------------------------------------------------ fulfilment

export interface FulfilmentPanelLabels {
  title: string;
  viewOrders: string;
  statuses: Record<OrderAllocationStatus, string>;
}

const STATUS_ICON: Record<OrderAllocationStatus, typeof Clock> = {
  // WAITING ON OTHER BUYERS, not on this supplier — «إذا اكتمل الهدف
  // يتم إرسال الطلبات للمورد». An hourglass rather than a clock: a
  // clock says a deadline is running, and none is.
  AWAITING_FUNDING: Hourglass,
  AWAITING_PREPARATION: Clock,
  PREPARING: Package,
  READY_TO_SHIP: ClipboardCheck,
  SHIPPED: Truck,
  DELIVERED: CheckCircle2,
};

const STATUS_TONE: Record<OrderAllocationStatus, string> = {
  // MUTED, because nothing is asked of the supplier yet. The accent is
  // this platform's "act now"; using it here would call for an action
  // the platform refuses to allow.
  AWAITING_FUNDING: "text-content-muted",
  AWAITING_PREPARATION: "text-accent",
  PREPARING: "text-accent",
  READY_TO_SHIP: "text-secondary",
  SHIPPED: "text-content-muted",
  DELIVERED: "text-success",
};

export function FulfilmentPanel({
  counts,
  locale,
  rtl,
  labels,
}: {
  counts: SupplierFulfilmentCounts;
  locale: AppLocale;
  rtl: boolean;
  labels: FulfilmentPanelLabels;
}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-2 rounded-card bg-surface px-card-x py-card-y shadow-card"
      data-testid="fulfilment-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-content">{labels.title}</h2>
        <Link
          href={`/${locale}/supplier/orders`}
          className="inline-flex items-center gap-1 text-sm text-secondary hover:underline"
          data-testid="fulfilment-view-orders"
        >
          {labels.viewOrders}
          <Arrow rtl={rtl} />
        </Link>
      </div>

      {/* FIVE TILES, ALWAYS. A stage with no rows is a zero, never a
          tile that vanished — a missing stage reads as a stage the
          platform does not have. */}
      <ul className="grid list-none grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:rtl:divide-x-reverse">
        {ORDER_ALLOCATION_STATUSES.map((status) => {
          const Icon = STATUS_ICON[status];
          return (
            <li
              key={status}
              className="flex flex-col items-center gap-1 px-2 py-3"
              data-testid={`fulfilment-${status}`}
            >
              <Icon className={`size-6 ${STATUS_TONE[status]}`} aria-hidden />
              <span className="text-xl font-semibold text-content">
                {counts[status]}
              </span>
              <span className="text-center text-xs text-content-muted">
                {labels.statuses[status]}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------- attention

export interface AttentionPanelLabels {
  title: string;
  orders: string;
  ordersAction: string;
  disputes: string;
  disputesAction: string;
  replacements: string;
  replacementsAction: string;
  clear: string;
}

export function AttentionPanel({
  attention,
  locale,
  rtl,
  labels,
}: {
  attention: SupplierDashboardAttention;
  locale: AppLocale;
  rtl: boolean;
  labels: AttentionPanelLabels;
}) {
  /**
   * A ROW WHOSE COUNT IS ZERO IS NOT RENDERED. A permanently full
   * "needs attention" panel showing three zeroes teaches people to
   * stop looking at it, which is the one thing it must never do.
   */
  const rows = [
    attention.ordersAwaitingPreparation > 0 && {
      key: "orders",
      icon: <Clock className="size-5 text-accent" aria-hidden />,
      text: `${attention.ordersAwaitingPreparation} ${labels.orders}`,
      action: labels.ordersAction,
      href: `/${locale}/supplier/orders`,
      tone: "border-accent text-accent",
    },
    attention.disputesAwaitingResponse > 0 && {
      key: "disputes",
      icon: <AlertTriangle className="size-5 text-danger" aria-hidden />,
      text: `${attention.disputesAwaitingResponse} ${labels.disputes}`,
      action: labels.disputesAction,
      href: `/${locale}/supplier/follow-up`,
      tone: "border-danger text-danger",
    },
    attention.replacementsAwaitingAction > 0 && {
      key: "replacements",
      icon: <RefreshCcw className="size-5 text-success" aria-hidden />,
      text: `${attention.replacementsAwaitingAction} ${labels.replacements}`,
      action: labels.replacementsAction,
      href: `/${locale}/supplier/follow-up`,
      tone: "border-success text-success",
    },
  ].filter(Boolean) as {
    key: string;
    icon: React.ReactNode;
    text: string;
    action: string;
    href: string;
    tone: string;
  }[];

  return (
    <section
      className="flex min-w-0 flex-col gap-2 rounded-card bg-surface px-card-x py-card-y shadow-card"
      data-testid="attention-panel"
    >
      <h2 className="text-base font-semibold text-content">{labels.title}</h2>

      {rows.length === 0 ? (
        <p
          className="inline-flex items-center gap-2 py-2 text-sm text-content-muted"
          data-testid="attention-clear"
        >
          <CheckCircle2 className="size-5 text-success" aria-hidden />
          {labels.clear}
        </p>
      ) : (
        <ul className="flex list-none flex-wrap gap-3">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3"
              data-testid={`attention-${row.key}`}
            >
              <span className="inline-flex min-w-0 items-center gap-2 text-sm text-content">
                {row.icon}
                <span className="truncate">{row.text}</span>
              </span>
              <Link
                href={row.href}
                /* THE SHARED CONTROL METRICS, borrowed rather than
                   re-typed: `px-control-x py-control-y` is what every
                   other button on the platform measures. Only the
                   BORDER colour differs per row, which is the
                   reference's own signal. */
                className={`inline-flex shrink-0 items-center gap-1 rounded-control border px-control-x py-control-y text-[length:var(--control-font-size)] ${row.tone}`}
              >
                {row.action}
                <Arrow rtl={rtl} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Whole days from now until an ISO instant, never negative on the page.
 *
 * NULL FOR A LISTING WITH NO CLOSING DATE — a direct sale has none, and
 * the row that shows a countdown is omitted rather than told «zero
 * days», which would read as «closing today».
 */
function daysUntil(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}
