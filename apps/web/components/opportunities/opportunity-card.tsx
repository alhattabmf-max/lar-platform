import Link from "next/link";
import type { PublicOpportunityItem, SaleMode } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { localized } from "@/lib/localized";
import { formatMoneyParts } from "@/lib/money";
import { Money } from "@/components/ui/money";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { OpportunityImage } from "./opportunity-image";
import {
  OfferProgressTrack,
  type OfferProgressLabels,
} from "./offer-progress";

/**
 * One offer in the marketplace grid — a BAND, two to a row.
 *
 * «حجم ارتفاع بطاقة المنتج في صفحة منتجاتي في المورد جميل، اجعل بطاقات
 * المنتجات في واجهة الزائر وواجهة المشتري بنفس الحجم… في الصف الواحد
 * تكون بطاقتين، مع الاحتفاظ بالمعلومات نفسها.»
 *
 * IT WAS FOUR HUNDRED PIXELS TALL. The card was a two-by-four grid: a
 * square photograph beside a column of facts, then the bar and the
 * button on a row of their own, then two captions on another. Every
 * figure had a line to itself, so five figures were five lines, and a
 * reader comparing two offers was scrolling rather than looking.
 *
 * THE SHAPE IS THE SUPPLIER'S PRODUCT ROW, which the owner approved:
 * three parts across with the middle taking what is left — the
 * picture, everything the offer IS, and the way in. Same construction
 * and the same tokens, so the height comes out the same by BUILD
 * rather than by a number copied between two files.
 *
 * NOTHING WAS DROPPED TO MAKE IT FIT — «مع الاحتفاظ بالمعلومات نفسها».
 * The five figures moved from five stacked rows into a band that
 * divides the middle in two, and one rule above that band replaces the
 * five that used to sit under each figure.
 *
 * THE PICTURE IS SMALLER THAN THE THING IT INTRODUCES — «ما تقدر
 * تصغّر الصورة؟ إذا أراد أن يشوف التفاصيل بيدخل عرض التفاصيل وبتوضح له
 * الصورة. الأهم للمشتري السعر والكمية».
 *
 * At three cards to a row a card is about 308px wide on a 1024 screen,
 * and 112 pixels of photograph took a THIRD of it. Eighty takes a
 * quarter, which is what makes three to a row possible there at all —
 * and the detail page is where a photograph is actually looked at.
 *
 * AND TWO FIGURES ARE LEFT OF FIVE.
 *
 * THE UNIT IS NOT DROPPED BUT MERGED INTO THE PRICE, where it belongs:
 * a price without its unit is not a price, and it costs no line there.
 *
 * THE MINIMUM ORDER STAYS, because it is the gate — a reader who
 * cannot meet it has no use for the rest of the card. THE REGION STAYS,
 * because where a thing ships from decides whether it is worth having
 * and cannot be inferred from anything else here.
 *
 * THE TARGET AND THE REMAINING GO TO THE DETAIL PAGE, and not because
 * they matter least: they are the two the card ALREADY ANSWERS TWICE.
 * The bar is a picture of exactly those two numbers, and the caption
 * under it says what share is left. A figure removed for being a
 * duplicate stays removed however wide the screen gets; a figure
 * removed for not fitting comes back as a problem at the next width.
 *
 * THE PHOTOGRAPH LEADS IN BOTH DIRECTIONS. The row is a plain flex
 * line, so Arabic puts it at the right and English at the left with
 * nothing named twice. The earlier card pinned its grid to physical
 * columns and chose a template per language because it had four ROWS
 * to keep in step across two halves; a band has one line and no such
 * problem to solve.
 *
 * Price and quantities are shown to a VISITOR deliberately — that is
 * the point of the design, and the public contract carries them.
 * Buying still requires an authenticated trader; nothing here is a
 * purchase step.
 */
export interface OpportunityCardLabels {
  regionLabel: string;
  unitLabel: string;
  targetLabel: string;
  remainingLabel: string;
  minimumOrderLabel: string;
  /** "incl. VAT", shown beside the price. */
  priceInclTax: string;
  /**
   * WHAT STANDS WHERE THE PRICE WOULD BE when the API sends something
   * that is not a money string.
   *
   * The card used to render NOTHING in that case, which leaves a
   * product with no price and no reason given — and "0.00" would be
   * worse still, because it is a claim about what the thing costs. A
   * stated absence is the only honest third option.
   */
  priceUnavailable: string;
  scheduledBadge: string | null;
  noImage: string;
  viewDetails: string;
  /** Accessible name carrying the product, so a grid of links differs. */
  viewDetailsFor: string;
  /** Already-interpolated quantity + unit, one per figure. */
  targetValue: string;
  remainingValue: string;
  minimumOrderValue: string;
  progress: OfferProgressLabels;
  /**
   * WHICH OF THE TWO SALES PATHS, and what a direct card says instead
   * of a progress bar and a countdown.
   *
   * A shelf has no target to be a percentage of and no date to count
   * down to. «البيع المباشر يظهر السعر والمخزون المتاح» — so the band
   * under the rule carries one line: how much is left, or that there is
   * none.
   */
  saleMode: SaleMode;
  stockLabel: string;
  soldOut: boolean;
}

export interface OpportunityCardProps {
  opportunity: PublicOpportunityItem;
  locale: AppLocale;
  labels: OpportunityCardLabels;
  /**
   * WHICH FRONT'S DETAIL PAGE THE CARD OPENS.
   *
   * «عندما أضغط عرض تفاصيل المنتج في الصفحة الرئيسية في واجهة المشتري
   * يرجعني إلى صفحة الزائر.»
   *
   * The buyer's home renders the visitor's home — that was asked for
   * and it is right — but this card built its address from the LOCALE
   * alone and so always pointed at the public route. A signed-in buyer
   * pressing "view details" was walked out of their own portal.
   *
   * THE FRONT IS THE CALLER'S TO NAME, because the card cannot know it:
   * it is the same component on both, and reading a session here would
   * put an auth decision inside a presentational card. Omitted, it is
   * the public marketplace, which is where this card began.
   */
  detailBasePath?: string;
}

/**
 * `Fact` IS GONE, AND SO IS THE BAND IT DREW.
 *
 * It stacked a quiet label over a loud value for the minimum order
 * and the region — «الحد الأدنى موجود في التفاصيل… المنطقة لا
 *  أحتاجها». Both live on the detail page, and the region is a
 * filter at the head of the listing rather than a fact about a card.
 */

export function OpportunityCard({
  opportunity,
  locale,
  labels,
  detailBasePath,
}: OpportunityCardProps) {
  const isRtl = locale === "ar-SA";
  const dir = isRtl ? "rtl" : "ltr";

  const name = localized(
    locale,
    opportunity.productNameAr,
    opportunity.productNameEn,
  );
  // WHETHER there is a price to show is still a question this card
  // answers before laying out the row; WHAT it looks like is the
  // shared component's business now.
  const price = formatMoneyParts(
    opportunity.unitPriceInclTaxAmount,
    opportunity.currency,
    locale,
  );
  const href = `${detailBasePath ?? `/${locale}/opportunities`}/${opportunity.id}`;

  return (
    <article
      dir={dir}
      data-testid="offer-card"
      className="flex h-full flex-col rounded-card bg-surface px-card-x py-card-y shadow-card"
    >
      {/* THREE PARTS, AND THE MIDDLE ONE TAKES WHAT IS LEFT: the
          picture, everything the offer IS, and the way in. The
          supplier's product row is built exactly this way and the owner
          approved its height — «حجم ارتفاع بطاقة المنتج… جميل».

          IT STACKS BELOW `sm`, picture first and the way in last, and
          nothing is hidden to make it fit. */}
      {/* PRESSED IN — «حاول تضغط البطاقة، ما أبغى حشو زائد فيها».
          Sixteen pixels between the picture and the lines became twelve,
          and the row no longer aligns to the top: `items-stretch` is
          what lets the picture take the lines' own height. */}
      {/* TWO SHAPES, ONE FOR EACH SCREEN — «شرايك نحط الصورة أعلى
          وتحتها المعلومات موازية بعض أكبر قدر ممكن».

          ON A PHONE the photograph leads and the lines sit under it,
          which is the shopping card everyone already knows how to
          read; two to a row makes it 191 wide, and 4:3 keeps the card
          from becoming a tower — a square would cost 191 pixels of
          height before a single word.

          FROM `sm` THE NAME LEADS and the picture stands beside it,
          unchanged — «أبغاها نفس سطح المكتب». A 350-pixel card has
          room for both, and a wide screen is read by scanning names
          rather than by looking at pictures. */}
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
        {/* A REAL link, reachable by keyboard. The reference makes the
            image one of three ways in, and an image that opens a page
            for a mouse but not for a keyboard is exactly the kind of
            thing this card was rebuilt to stop doing.

            Named EXPLICITLY rather than leaning on the image's alt: an
            offer with no photo renders a placeholder whose label is "no
            image available", and a link announced that way tells a
            screen-reader user nothing about which offer it opens. The
            name holds whether or not a photo exists.

            THE BOX SIZES IT, not a class on the image. The image
            carries `w-full` in its own skin and `cn` joins classes
            rather than merging them, so a size written on the image
            would lose to that in the stylesheet's own order. */}
        <Link
          href={href}
          aria-label={name}
          data-testid="offer-card-media"
          // AS TALL AS THE LINES BESIDE IT — «مربع الصورة خلّه موازي
          // للأسطر الثلاثة».
          //
          // THE WIDTH IS FIXED AND THE HEIGHT IS TAKEN, never the other
          // way round. `aspect-square` on a stretched item was tried and
          // it blew the picture up to four hundred pixels: the width
          // resolved from the image's own intrinsic size first, and the
          // ratio then derived a height from THAT — a square measuring
          // itself, with the row growing to fit. Eighty pixels of width
          // and `self-stretch` has no such loop: the row's height is
          // settled by the lines, and the picture simply takes it.
          // THE FULL WIDTH OF THE CARD ON A PHONE, AT 4:3; eighty
          // pixels beside the lines from `sm` up. `aspect-auto` and
          // `self-stretch` hand the height back to the row there, so
          // the picture takes whatever the lines beside it come to.
          className="block aspect-[4/3] w-full shrink-0 overflow-hidden rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:aspect-auto sm:w-20 sm:self-stretch"
        >
          {/* SQUARE, 1:1, and never stretched — the image component
              crops. The card uses the thumbnail; the detail page uses
              the full-resolution route. */}
          <OpportunityImage
            src={opportunity.thumbnailUrl}
            productName={name}
            noImageLabel={labels.noImage}
            className="h-full rounded-card [&>img]:h-full [&>img]:object-cover"
            showNoImageLabel
          />
        </Link>

        {/* EVERYTHING THE OFFER IS. */}
        {/* THREE LINES IN ONE COLUMN — «الاسم، وتحته السعر، وتحت
            السعر أدنى حد للطلب، والمنطقة تكون موازية للحد الأدنى».
            One block and one rhythm: the rule that used to sit above the
            figures made two blocks of what is one column of facts. */}
        <div
          data-testid="offer-card-info"
          className="flex min-w-0 flex-1 flex-col gap-1.5"
        >
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-start gap-2">
              <h3 className="min-w-0 flex-1 text-base font-semibold leading-tight">
                <Link
                  href={href}
                  // NO RULE UNDER THE NAME — «ألغِ الخط اللي تحت الكتابات مثل
                  // اسم المنتج، مشوّه للصورة».
                  //
                  // An underline is how a link says it is one when it
                  // sits INSIDE a paragraph and nothing else marks it.
                  // This name is the heading of its own card, in the
                  // identity navy, with the picture beside it and the
                  // button below opening the same page — three ways in
                  // and no prose to be lost in. What the rule added was
                  // a stroke through a grid of twelve.
                  className="text-primary hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {name}
                </Link>
              </h3>

              {opportunity.status === "SCHEDULED" && labels.scheduledBadge ? (
                <span className="rounded-md bg-warning-surface px-2 py-0.5 text-xs font-medium text-warning-text">
                  {labels.scheduledBadge}
                </span>
              ) : null}
            </div>

            {/* The price leads, in the reference's orange.
                `accent-interactive` is the accessible shade of that
                amber: the lighter `accent` measures 2.15:1 on white and
                fails as text.

                Rendered through `formatMoney`, not printed raw. That is
                what puts the amount in the locale's own currency form
                ("287.50 ر.س." rather than "287.50 SAR") and pins the
                digits to the numbering system the rest of the product
                uses. A null means the API sent something that is not a
                money string, and the row is omitted rather than showing
                a broken figure. */}
            {price === null ? (
              // A STATED ABSENCE, never a blank and never a zero.
              <p className="text-sm text-content-muted">
                {labels.priceUnavailable}
              </p>
            ) : (
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="text-2xl font-bold text-accent-interactive">
                  <Money
                    amount={opportunity.unitPriceInclTaxAmount}
                    currency={opportunity.currency}
                    locale={locale}
                  />
                </span>
                {/* AND NOT THE UNIT — «كلمة طبلية، اللي هي وحدة البيع،
                     موجودة في التفاصيل، ما أحتاجها».

                    It cost no line while the card was wide; on a card
                    191 across it pushes «شامل الضريبة» onto one of its
                    own. The detail page states it beside the quantity
                    a buyer actually orders in. */}
                <span className="text-xs text-content-muted">
                  {labels.priceInclTax}
                </span>
              </p>
            )}
          </div>

          {/* THE FIGURES, IN A BAND RATHER THAN A COLUMN. Five stacked
              rows were most of the four hundred pixels this card used
              to take; two columns hold the same five in three lines.
              ONE rule above them, never one under each — see `Fact`. */}
          {/* THE THIRD LINE: the minimum order, with the region
              beside it — «تحت السعر أدنى حد للطلب، والمنطقة تكون موازية
              للحد الأدنى». The minimum leads because it is the gate.

              TWO COLUMNS, PINNED — «المنطقة تكون موازية للحد الأدنى».
              It was `auto-fit` with a 136px minimum, written when the
              band carried FIVE figures and had to decide for itself how
              many would fit. With two figures that calculation is the
              bug: at 1100px the band is 203 wide, two minimums plus the
              gap need 296, so it dropped to one column and the region
              landed UNDER the minimum order rather than beside it.
              Two figures that must stand side by side are a fixed pair,
              not a count to be worked out. Nothing truncates, so a
              narrow column wraps its label instead of clipping it.

          {/* THE TWO FIGURES ARE GONE FROM THE CARD.

              «الحد الأدنى موجود في التفاصيل، لا أحتاجه. المنطقة لا
               أحتاجها — إذا أراد الشخص منتجًا في منطقة يبحث عن طريق
               بحث المناطق. يبقى العنوان والصورة والسعر شامل الضريبة
               والمؤشر والتاريخ وزر عرض التفاصيل.»

              A LISTING IS SCANNED, NOT READ. Every figure that also
              lives on the detail page is a line the eye has to pass
              on the way to the next card — and the region in
              particular is a FILTER, standing at the head of this
              very page: printing it on all thirty-six cards tells a
              reader nothing they did not choose.

              WHAT IS LEFT IS WHAT DECIDES: the picture, the name, the
              price with its tax, how much is left, when it closes,
              and the way in. */}
        </div>

      </div>

      {/* THE BAR AND THE WAY IN, ON ONE LINE ACROSS THE WHOLE CARD.

          «لا أريد أي فراغ في البطاقة، استغل كل الفراغات.»

          THEY WERE A COLUMN OF THEIR OWN, 176 pixels wide and fixed. At
          three cards to a row that column was WIDER than the product
          beside it — the middle came out at 120 — and it used 94 of its
          own 261 pixels, so half the card was white. The measure a
          button needs is the width of its word; reserving a column for
          it took that width from the only part of the card a reader is
          actually reading.

          THE BAR TAKES WHAT IS LEFT and the button takes what it needs,
          so nothing is reserved and nothing is empty. The middle column
          goes from 120 pixels back to about 320, which is what lets the
          price keep its unit on one line and the figures stand in two
          columns again.

          THE MARKER RIDES IMMEDIATELY ABOVE THE BAR. It is a pointer at
          a position ON the bar, so the two are one block and nothing may
          come between them. */}
      {/* THE BAR AND THE BUTTON SIT CLOSER. Twelve above the rule and
          twelve below it was twenty-four pixels of air holding apart two
          things that belong to the same card; eight and eight still
          reads as a separate band and gives sixteen pixels back. */}
      {/* AND THE FOOT STACKS WHERE THE CARD IS HALF A PHONE WIDE.

          Measured at 393 with two to a row: the card is 191, the
          button takes 96 of it, and the bar and its two lines were
          left 83 — which broke «ينتهي العرض: 4 أكتوبر 2026» across
          three lines beside a button standing on its own.

          SO THE TWO TAKE THE FULL WIDTH IN TURN below `sm`, and sit
          side by side from `sm` up, where 300 is room for both. */}
      <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2 border-t border-line pt-2 max-sm:[&>*]:w-full">
        {/* A DIRECT LISTING HAS NEITHER A BAR NOR A CLOCK.

            The bar is a picture of «how much of the target has sold»
            and the date is when the window shuts. A shelf has no target
            and no window, so drawing either would be a picture of
            nothing — «إذا أصبح المتاح صفرًا تظهر نفد المخزون». What
            stands in their place is the one figure that decides whether
            this card is any use: how much is left. */}
        {labels.saleMode === "DIRECT" ? (
          <div data-testid="offer-card-stock" className="min-w-0 flex-1">
            <p
              className={cn(
                "text-sm font-medium",
                labels.soldOut ? "text-danger" : "text-content",
              )}
            >
              {labels.stockLabel}
            </p>
          </div>
        ) : (
        <div data-testid="offer-card-progress" className="min-w-0 flex-1">
          <OfferProgressTrack
            progressPercentage={opportunity.progressPercentage}
            locale={locale}
            ariaLabel={labels.progress.ariaLabel}
          />
          {/* THE TWO CAPTIONS, on one line under the bar they belong to.
              They were a row of the old grid spread across the whole
              card; they sit with the bar now, which is the thing they
              describe. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 pt-1">
            <p
              data-testid="offer-card-remaining"
              className="text-[11px] text-content-muted"
            >
              {labels.progress.remaining}
            </p>
            <p
              data-testid="offer-card-ends-at"
              className="text-[11px] font-medium text-danger"
            >
              {labels.progress.endsAt}
            </p>
          </div>
        </div>
        )}

        <Link
          href={href}
          aria-label={labels.viewDetailsFor}
          data-testid="offer-card-action"
          // THE SHARED BUTTON, not a link dressed as one. It carried its
          // own padding, radius, colour and hover — four decisions
          // repeated here that the system already makes, and a height
          // that drifted from every other button on the platform.
          //
          // ITS OWN WIDTH, not a column's. `shrink-0` so a long product
          // name cannot squeeze the word out of it.
          className={cn(
            buttonClasses("secondary"),
            "shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
          )}
        >
          {labels.viewDetails}
        </Link>
      </div>
    </article>
  );
}

/**
 * Below this many days remaining, the closing notice is emphasised.
 *
 * Three days is a judgement call, not a business rule — nothing in the
 * API changes at this threshold. It lives here as a named constant so
 * it is obviously presentational and can be changed in one place.
 */
export const CLOSING_SOON_DAYS = 3;
