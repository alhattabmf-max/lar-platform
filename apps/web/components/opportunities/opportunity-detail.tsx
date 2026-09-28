import type { ReactNode } from "react";
import {
  Box,
  CalendarDays,
  Clock,
  Globe,
  Hourglass,
  Info,
  Layers,
  MapPin,
  Package,
  Ruler,
  Scale,
  ShoppingCart,
  Tags,
  Target,
  TrendingUp,
  Truck,
  type LucideIcon,
} from "lucide-react";
import type { PublicOpportunityDetail } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { localized, formatDateTime, daysUntil } from "@/lib/localized";
import { formatMoneyParts, formatPercentage, formatQuantity } from "@/lib/money";
import { Money } from "@/components/ui/money";
import { OfferProgressTrack } from "@/components/opportunities/offer-progress";
import { OpportunityImage } from "@/components/opportunities/opportunity-image";

/**
 * ONE OFFER'S SCREEN, DRAWN ONCE FOR BOTH FRONTS.
 *
 * «بطاقة عرض تفاصيل المنتج في صفحة الزائر عدّلها مثل عرض تفاصيل المنتج
 * في صفحة المشتري.»
 *
 * IT IS AN EXTRACTION AND NOT A COPY, deliberately. The two pages read
 * different endpoints behind different guards, and the obvious way to
 * make them match was to paste six hundred lines into the second one —
 * which is exactly how the offer CARDS drifted apart before the owner
 * asked for them to be unified: «لا أريد اختلافًا في شكل بطاقة المنتج
 * في الرئيسية وفي السوق أو أي صفحة». Two files cannot stay identical;
 * one file cannot differ from itself.
 *
 * WHAT THE TWO FRONTS ACTUALLY DIFFER IN is smaller than it looks.
 * `TraderOpportunityDetail` extends `PublicOpportunityDetail`, and of
 * everything these four cards draw, only ONE field is the buyer's
 * alone: `expectedPreparationDays`. It is optional here and renders as
 * a stated absence when a visitor is reading — never as a guess.
 *
 * AND THE PURCHASE IS A SLOT, not a flag. The buyer's front fills it
 * with the composer that creates a checkout session; the visitor's
 * fills it with the way to sign in. This component knows neither, which
 * is why no `isVisitor` conditional can ever grow inside it and start
 * hiding things a visitor was supposed to see.
 *
 * A SERVER COMPONENT. Every value it renders is already resolved by the
 * page that loads it, and the only interactive thing on the screen —
 * the composer — arrives through the slot as an element.
 */
export interface OpportunityDetailLabels {
  productLabel: string;
  deliveryLabel: string;
  packageLabel: string;
  buyNow: string;
  gallery: string;
  galleryItem: (index: number, name: string) => string;
  noImage: string;
  scheduled: string;
  noDescription: string;
  taxonomy: string;
  priceIncludesTax: string;
  priceUnavailable: string;
  targetQuantity: string;
  remainingQuantity: string;
  sold: string;
  shareQuantity: string;
  progressAriaLabel: (percent: string) => string;
  unsoldCaveat: string;
  progressCaveat: string;
  city: string;
  region: string;
  preparationTime: string;
  preparationDays: (days: number) => string;
  opens: string;
  closes: string;
  remainingTime: string;
  closed: string;
  closesInDays: (days: number) => string;
  unit: string;
  packageContent: string;
  weightPerUnit: string;
  dimensions: string;
  cm: string;
  length: string;
  width: string;
  height: string;
}

export function OpportunityDetail({
  locale,
  opportunity,
  category,
  labels,
  purchase,
}: {
  locale: AppLocale;
  /**
   * The public shape, which the buyer's own detail extends. The one
   * field this component cannot assume is the buyer's preparation
   * window; absent, its row prints a dash like any other unheld figure.
   */
  opportunity: PublicOpportunityDetail & { expectedPreparationDays?: number };
  /** Resolved from the taxonomy by the page; null when it could not be. */
  category: string | null;
  labels: OpportunityDetailLabels;
  /** «اشترِ الآن» for a buyer, the way in for a visitor. */
  purchase: ReactNode;
}) {
  const name = localized(locale, opportunity.productNameAr, opportunity.productNameEn);
  const description = localized(
    locale,
    opportunity.productDescriptionAr,
    opportunity.productDescriptionEn
  );
  const city = localized(
    locale,
    opportunity.fulfillmentCityNameAr,
    opportunity.fulfillmentCityNameEn
  );
  const region = localized(
    locale,
    opportunity.fulfillmentRegionNameAr,
    opportunity.fulfillmentRegionNameEn
  );
  const unit = localized(locale, opportunity.salesUnitNameAr, opportunity.salesUnitNameEn);

  const price = formatMoneyParts(opportunity.unitPriceInclTaxAmount, opportunity.currency, locale);
  const sold = formatPercentage(opportunity.progressPercentage, locale);
  const opens = formatDateTime(opportunity.startAt, locale);
  const closes = formatDateTime(opportunity.endAt, locale);
  // COMPUTED FROM THE READER'S OWN CLOCK, unlike the two dates above,
  // which are the server's.
  const days = daysUntil(opportunity.endAt);

  /**
   * A quantity WITH its selling unit, or the bare number when the offer
   * names none. Arabic inflects a counted noun by the count and the
   * catalogue stores ONE name per unit, so the name is appended rather
   * than declined — deriving the plural would be inventing grammar from
   * data the platform does not hold.
   */
  const withUnit = (count: number) =>
    `${formatQuantity(count, locale)}${unit ? ` ${unit}` : ""}`;

  /** Every photograph the snapshot froze, main first. */
  const gallery = opportunity.thumbnailUrls ?? [];

  /**
   * THE THREE MEASURES AS ONE LINE, and only when all three are there.
   * A box "40 × — × 20" is not a size, it is a hole with two numbers
   * beside it. A snapshot either froze the set or froze none.
   */
  const dimensions =
    opportunity.lengthCm && opportunity.widthCm && opportunity.heightCm
      ? `${opportunity.lengthCm} × ${opportunity.widthCm} × ${opportunity.heightCm} ${labels.cm}`
      : null;

  const packageContent = opportunity.packageContentQuantity
    ? `${opportunity.packageContentQuantity} ${
        localized(
          locale,
          opportunity.packageContentUnitNameAr,
          opportunity.packageContentUnitNameEn
        ) ?? ""
      }`.trim()
    : null;

  return (
    /* THREE CARDS AND NO REPETITION — the owner's own division: «اشترِ
       الآن» carries the purchase alone; the product card carries what
       the thing IS and what it costs; the shipping card carries when
       and how it arrives, and the package card what the box is.

       ONE SCREEN, NOT A SCROLL — «حاول أنك ما تخليها أكثر من صفحة».

       NOTHING APPEARS TWICE. The price, the minimum and the quantities
       are on the product card and nowhere else; the branch and the
       button are on the purchase card and nowhere else. */
    <div className="flex flex-col gap-3">
      {/* TWO COLUMNS. The narrow one is the LEFT — «انقل بطاقة اشترِ
          إلى الجهة اليسرى» — and in Arabic the left is where a row
          ENDS, so it is the second track.

          THE PACKAGE CARD SITS UNDER THE PURCHASE CARD, in that same
          column, which is what gives the two ONE width: «احرص يكون عرض
          بطاقة مواصفات العبوة نفس عرض بطاقة اشترِ». Matching two widths
          by hand is how they drift apart; sharing a column is how they
          cannot. */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* ── THE WIDE COLUMN: what the offer IS, and when it arrives ── */}
        <div className="flex min-w-0 flex-col gap-3">
          {/* ============ 2 · THE PRODUCT AND ITS COMMERCIAL TERMS. */}
          <section
            aria-label={labels.productLabel}
            data-testid="detail-product-card"
            className="flex flex-col gap-3 rounded-card bg-surface px-card-x py-card-y shadow-card"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex shrink-0 flex-col gap-2">
                <OpportunityImage
                  src={opportunity.imageUrl}
                  productName={name}
                  noImageLabel={labels.noImage}
                  className="aspect-square h-auto w-full rounded-card sm:w-40"
                  priority
                  showNoImageLabel
                />

                {gallery.length > 1 ? (
                  <ul
                    aria-label={labels.gallery}
                    data-testid="detail-gallery"
                    className="grid list-none grid-cols-4 gap-1.5 sm:w-40"
                  >
                    {gallery.map((src, index) => (
                      <li key={src}>
                        {/* THE SHARED COMPONENT, never a bare image tag.
                            It runs the url through `mediaUrl`, so a path
                            the API owns resolves against the API and not
                            against this app. */}
                        <OpportunityImage
                          src={src}
                          productName={labels.galleryItem(index + 1, name ?? "")}
                          noImageLabel={labels.noImage}
                          className="aspect-square h-auto w-full rounded-md"
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-start gap-2">
                  <h1 className="min-w-0 flex-1 text-xl font-semibold leading-tight text-content">
                    {name}
                  </h1>
                  {opportunity.status === "SCHEDULED" ? (
                    <span className="rounded-md bg-warning-surface px-2 py-0.5 text-xs font-medium text-warning-text">
                      {labels.scheduled}
                    </span>
                  ) : null}
                </div>

                {/* Plain text from the frozen approval snapshot, as a
                    text node. Never dangerouslySetInnerHTML — a
                    repo-wide test forbids it. */}
                <p className="whitespace-pre-wrap text-sm text-content-muted">
                  {description ?? labels.noDescription}
                </p>

                <Spec label={labels.taxonomy} value={category} icon={Tags} />

                {/* THE PRICE, in the accessible amber. The lighter
                    accent measures 2.15:1 on white and fails as text. */}
                <p className="flex flex-wrap items-baseline gap-2 pt-1">
                  {price ? (
                    <>
                      <span className="text-3xl font-bold text-accent-interactive">
                        <Money
                          amount={opportunity.unitPriceInclTaxAmount}
                          currency={opportunity.currency}
                          locale={locale}
                        />
                      </span>
                      {unit ? (
                        <span className="text-sm text-content-muted">/ {unit}</span>
                      ) : null}
                    </>
                  ) : (
                    // A stated absence. "0.00" would be a claim about
                    // what this costs.
                    <span className="text-sm text-content-muted">
                      {labels.priceUnavailable}
                    </span>
                  )}
                  <span className="text-xs text-content-muted">{labels.priceIncludesTax}</span>
                </p>
              </div>
            </div>

            {/* THE FOUR FIGURES, on one band above their bar. */}
            <dl
              data-testid="detail-terms"
              className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 sm:grid-cols-4"
            >
              <Spec
                label={labels.targetQuantity}
                value={withUnit(opportunity.targetQuantity)}
                icon={Target}
              />
              <Spec
                label={labels.remainingQuantity}
                value={withUnit(opportunity.unsoldQuantity)}
                icon={Layers}
              />
              <Spec label={labels.sold} value={sold} icon={TrendingUp} />
              {/* NO MINIMUM ON A DIRECT LISTING — the buyer names any
                  quantity up to what is left, so the row is omitted
                  rather than showing a share of nothing. */}
              {opportunity.shareQuantity === null ? null : (
                <Spec
                  label={labels.shareQuantity}
                  value={withUnit(opportunity.shareQuantity)}
                  icon={ShoppingCart}
                />
              )}
            </dl>

            <OfferProgressTrack
              progressPercentage={opportunity.progressPercentage}
              locale={locale}
              ariaLabel={labels.progressAriaLabel(
                formatPercentage(opportunity.progressPercentage, locale) ?? ""
              )}
            />

            {/* The two caveats belong to the two figures above them: an
                arithmetic difference is not a reservation, and a share
                sold is not a goal. */}
            <div className="flex flex-col gap-1">
              <Caveat>{labels.unsoldCaveat}</Caveat>
              <Caveat>{labels.progressCaveat}</Caveat>
            </div>
          </section>

          {/* ============ 3 · SHIPPING, DATES, AND THE CLOCK. */}
          <section
            aria-label={labels.deliveryLabel}
            data-testid="detail-shipping-card"
            className="flex flex-col gap-3 rounded-card bg-surface px-card-x py-card-y shadow-card"
          >
            <h2 className="flex items-center gap-2 text-base font-semibold text-content">
              <Truck aria-hidden="true" className="size-4 shrink-0 text-secondary" />
              {labels.deliveryLabel}
            </h2>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <Spec label={labels.city} value={city} icon={MapPin} />
              <Spec label={labels.region} value={region} icon={Globe} />
              {/* THE ONE FIGURE A VISITOR'S CONTRACT DOES NOT CARRY. It
                  prints its label and a dash rather than vanishing: a
                  missing row reads as a platform that forgot to ask. */}
              <Spec
                label={labels.preparationTime}
                value={
                  opportunity.expectedPreparationDays === undefined
                    ? null
                    : labels.preparationDays(opportunity.expectedPreparationDays)
                }
                icon={Clock}
              />
              <Spec
                label={labels.opens}
                value={opens ? <time dateTime={opportunity.startAt}>{opens}</time> : null}
                icon={CalendarDays}
              />
              <Spec
                label={labels.closes}
                value={
                  closes && opportunity.endAt !== null ? (
                    <time dateTime={opportunity.endAt}>{closes}</time>
                  ) : null
                }
                icon={CalendarDays}
              />
              {/* COMPUTED IN THE BROWSER, from the reader's own clock —
                  the two dates above are the server's. */}
              <Spec
                label={labels.remainingTime}
                value={
                  days === null ? (
                    labels.closed
                  ) : (
                    <span className="text-accent-interactive">{labels.closesInDays(days)}</span>
                  )
                }
                icon={Hourglass}
              />
            </dl>
          </section>
        </div>

        {/* ── THE NARROW COLUMN: the purchase, and what the box is ── */}
        <div className="flex min-w-0 flex-col gap-3">
          {/* ============ 1 · BUY NOW — the purchase and nothing else. */}
          <section
            aria-label={labels.buyNow}
            data-testid="detail-purchase-card"
            className="flex flex-col gap-2 rounded-card bg-surface px-card-x py-card-y shadow-card"
          >
            <h2 className="flex items-center gap-2 text-base font-semibold text-content">
              <ShoppingCart aria-hidden="true" className="size-4 shrink-0 text-secondary" />
              {labels.buyNow}
            </h2>

            {purchase}
          </section>

          {/* ============ 4 · WHAT THE BOX IS. */}
          <section
            aria-label={labels.packageLabel}
            data-testid="detail-package-card"
            className="flex flex-col gap-3 rounded-card bg-surface px-card-x py-card-y shadow-card"
          >
            <h2 className="flex items-center gap-2 text-base font-semibold text-content">
              <Box aria-hidden="true" className="size-4 shrink-0 text-secondary" />
              {labels.packageLabel}
            </h2>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2">
                <Spec label={labels.unit} value={unit} icon={Box} />
                <Spec label={labels.packageContent} value={packageContent} icon={Package} />
                <Spec
                  label={labels.weightPerUnit}
                  value={opportunity.weightPerUnit}
                  icon={Scale}
                />
                <Spec label={labels.dimensions} value={dimensions} icon={Ruler} />
              </dl>

              {/* THE BOX, DRAWN. It is a picture of the three figures
                  beside it and carries no number of its own — the
                  labels on it name the edges, and the measures stay in
                  the list where they can be read and copied. */}
              <BoxDiagram
                lengthLabel={labels.length}
                widthLabel={labels.width}
                heightLabel={labels.height}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * One labelled figure, in the card's own type — an eleven-pixel label
 * above a fourteen-pixel value, matching the offer card exactly.
 *
 * AN ABSENT VALUE STILL PRINTS ITS LABEL, as an em dash. A pre-7A
 * snapshot genuinely has no weight and no dimensions; hiding the row
 * would leave a reader wondering whether the platform forgot to ask or
 * the supplier forgot to answer, and the dash says which.
 */
function Spec({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="flex items-center gap-1.5 text-[11px] font-medium leading-tight text-content-muted">
        {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0 text-secondary" /> : null}
        {label}
      </dt>
      <dd className="text-sm font-semibold text-content">{value ?? "—"}</dd>
    </div>
  );
}

/** One of the two notices, with the mark that says it is one. */
function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-content-muted">
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-secondary" />
      <span>{children}</span>
    </p>
  );
}

/**
 * A box with its three edges named.
 *
 * DECORATIVE, and hidden from assistive technology: every figure it
 * illustrates is in the list beside it, where a screen reader already
 * reads them and a person can select the text. A diagram that repeated
 * them would be read twice.
 *
 * Drawn in `currentColor` so it takes the ink of whatever it sits in,
 * and in stroke only — a filled box would compete with the photograph
 * one card away.
 */
function BoxDiagram({
  lengthLabel,
  widthLabel,
  heightLabel,
}: {
  lengthLabel: string;
  widthLabel: string;
  heightLabel: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 140"
      className="h-28 w-full shrink-0 text-content-muted sm:w-48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      {/* The cube: a front face, a top face and a side face. */}
      <path d="M60 50 L120 50 L120 105 L60 105 Z" />
      <path d="M60 50 L85 30 L145 30 L120 50" />
      <path d="M120 50 L145 30 L145 85 L120 105" />
      {/* The three edges, each with an arrow and its name. */}
      <path d="M60 118 L120 118" strokeWidth="1" markerStart="url(#a)" markerEnd="url(#a)" />
      <path d="M133 96 L133 41" strokeWidth="1" markerStart="url(#a)" markerEnd="url(#a)" />
      <path d="M52 105 L52 50" strokeWidth="1" markerStart="url(#a)" markerEnd="url(#a)" />
      <defs>
        <marker id="a" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0 3 L6 0 L6 6 Z" fill="currentColor" stroke="none" />
        </marker>
      </defs>
      <text x="90" y="133" textAnchor="middle" fontSize="11" stroke="none" fill="currentColor">
        {lengthLabel}
      </text>
      <text x="152" y="70" fontSize="11" stroke="none" fill="currentColor">
        {heightLabel}
      </text>
      <text x="44" y="80" textAnchor="end" fontSize="11" stroke="none" fill="currentColor">
        {widthLabel}
      </text>
    </svg>
  );
}
