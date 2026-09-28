import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import {
  loadSupplierOpportunities,
  loadSupplierOpportunity,
} from "@/lib/supplier-data";
import {
  opportunityActions,
  opportunityIsLive,
  opportunityNextStepKey,
} from "@/lib/opportunity-actions";
import { localized, formatDate, formatDateTime } from "@/lib/localized";
import {
  formatMoneyParts,
  formatPercentage,
  formatQuantity,
} from "@/lib/money";
import { CalendarClock, Gift, Pencil } from "lucide-react";
import { Money } from "@/components/ui/money";
import { Card, CardBody } from "@/components/ui/card";
import { OpportunityImage } from "@/components/opportunities/opportunity-image";
import { StatusBadge } from "@/components/trader/status-badge";
import {
  FieldRow,
  HALF6,
  HALF12,
  ReadName,
  ReadValue,
  SectionTitle,
  SHORT_LABEL,
} from "@/components/forms/listing-parts";
import { ErrorState } from "@/components/ui/states";
import { OpportunityActions } from "@/components/supplier/opportunity-actions";
import { DirectStockForm } from "@/components/supplier/direct-stock-form";
import { TimeRemaining } from "@/components/opportunities/time-remaining";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.opportunities");

/**
 * One listing: its state, its terms, where it ships from, and the actions
 * the API will accept.
 *
 * An unknown id and another company's listing both answer 404 from the API —
 * deliberately, so probing reveals nothing — and this renders Next's own 404
 * for either, which preserves that.
 *
 * ACTION_REQUIRED shows the TRANSLATED reason code and a fix written for it.
 * The row's `reasonDetails` is operator-facing English and is not on the
 * contract at all, so there is nothing here to leak.
 *
 * Every amount arrives as a decimal string and is formatted at the edge of
 * rendering. Nothing is summed, multiplied or converted: the tax breakdown
 * shown is the FROZEN one computed at publish time, and recomputing it here
 * would produce a second figure that eventually disagrees with the one
 * traders were charged.
 */
export default async function SupplierProductDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({
    locale: appLocale,
    namespace: "supplier.opportunities",
  });
  const status = await getTranslations({
    locale: appLocale,
    namespace: "supplier.status",
  });
  const states = await getTranslations({
    locale: appLocale,
    namespace: "states",
  });
  const common = await getTranslations({
    locale: appLocale,
    namespace: "common",
  });
  // THE CARD TITLES COME FROM THE FORM'S OWN CATALOGUE, because
  // they name the same two cards «إنشاء عرض» draws. Two copies of
  // «شروط البيع» would be the place the two screens quietly stop
  // agreeing about what the card is called.
  const sectionText = await getTranslations({
    locale: appLocale,
    namespace: "supplier.listings.form",
  });

  // THE COMPANY'S OTHER OFFERS come along, because one fact about them
  // decides what this page may offer: whether another offer on the same
  // product is already running. There is no per-product route, so the
  // filtering happens here.
  const [result, siblings] = await Promise.all([
    loadSupplierOpportunity(id),
    loadSupplierOpportunities(),
  ]);

  if (!result.ok && result.notFound) notFound();

  const backHref = `/${appLocale}/supplier/opportunities`;

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb
          href={backHref}
          label={t("breadcrumbLabel")}
          back={t("backToList")}
        />
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      </div>
    );
  }

  const opportunity = result.data;

  /**
   * THE OFFER ALREADY RUNNING ON THIS PRODUCT, if there is one.
   *
   * The owner's rule: «لا يُنشر عرض ثانٍ على المنتج إلا بعد انتهاء العرض
   * الأول». The server refuses the publication either way; what this
   * buys is that the button is not offered and the reason is on screen
   * with a way to reach the offer that is in the way — rather than a
   * refusal appearing only after the supplier presses «نشر».
   *
   * A failed read names none. The server is still the authority, and a
   * page that hid the button because it could not read a list would
   * strand a supplier who has no live offer at all.
   */
  const liveSibling = siblings.ok
    ? siblings.data.find(
        (other) =>
          other.id !== opportunity.id &&
          other.productId === opportunity.productId &&
          opportunityIsLive(other.status),
      )
    : undefined;

  const rawGate = opportunityActions(opportunity);
  const gate = liveSibling ? { ...rawGate, canPublish: false } : rawGate;
  const name = localized(
    appLocale,
    opportunity.productNameAr,
    opportunity.productNameEn,
  );
  const unit = localized(
    appLocale,
    opportunity.salesUnitNameAr,
    opportunity.salesUnitNameEn,
  );

  const price = formatMoneyParts(
    opportunity.unitPriceAmount,
    opportunity.currency,
    appLocale,
  );
  // Every figure on this page goes through one helper, so the symbol,
  // its size and its side are decided once per screen.
  const money = (amount: string) => (
    <Money amount={amount} currency={opportunity.currency} locale={appLocale} />
  );
  const exclTax =
    opportunity.unitPriceExclTaxAmount === null
      ? null
      : money(opportunity.unitPriceExclTaxAmount);
  const tax =
    opportunity.unitTaxAmount === null
      ? null
      : money(opportunity.unitTaxAmount);
  const totalValue =
    opportunity.totalValueInclTaxAmount === null
      ? null
      : money(opportunity.totalValueInclTaxAmount);

  // ACTION_REQUIRED resolves per reason code: "something is blocking
  // this" is not a next step — which of the ten things it is, is.
  // A REASON IS A REASON, whatever state carries it.
  //
  // This used to read it only in ACTION_REQUIRED — the state a
  // REpublish leaves behind. A product added while the company was
  // still incomplete never reaches that state: it stays DRAFT with its
  // blocker written on it, and the supplier was being shown the generic
  // "review and publish" instead of the one sentence that says what is
  // actually missing.
  const nextStep = opportunity.reasonCode
    ? t(`reasonFix.${opportunity.reasonCode}`)
    : t(`nextStep.${opportunityNextStepKey(opportunity.status)}`);

  // THE FROZEN ORIGIN AND THE DESCRIPTION, resolved once. The city
  // and region are snapshotted at publication, so a draft genuinely
  // has none — that is an answer, not an error.
  const shipsFromRegion = localized(
    appLocale,
    opportunity.fulfillmentRegionNameAr,
    opportunity.fulfillmentRegionNameEn,
  );
  const shipsFromCity = localized(
    appLocale,
    opportunity.fulfillmentCityNameAr,
    opportunity.fulfillmentCityNameEn,
  );
  const description = localized(
    appLocale,
    opportunity.descriptionAr,
    opportunity.descriptionEn,
  );

  // A PICTURE OF THE TWO NUMBERS BESIDE IT, never a third figure.
  const soldPercent =
    opportunity.targetQuantity > 0
      ? Math.min(
          100,
          (opportunity.fundedQuantity / opportunity.targetQuantity) * 100,
        )
      : 0;

  return (
    <div className="flex flex-col gap-card-gap">
      {/* ====================================== the supplier's window
          «فرصة لم تصل هدفها مئة بالمئة بل وصلت ستين بالمئة… هنا مهلة
           تعطى للمورد مدة 24 ساعة… إذا لم ينفذ الخيارين تنتهي الفرصة
           وتسترد الأموال تلقائي.» And «يقرر المورد في العرض نفسه».

          AT THE TOP, ABOVE EVERYTHING. Every other banner on this page
          explains a state; this one is a question with a deadline, and
          the money of everyone who already bought is captured while it
          goes unanswered. The two buttons are in the actions column
          below, where every action on this offer already lives.

          THE COUNTDOWN IS A CLIENT COMPONENT and the exact instant is
          rendered here. A remaining time computed on the server is
          stale before it reaches the browser; a timestamp is not. Both
          are shown because they answer different questions — "how long
          have I got" and "by when exactly". */}
      {gate.decisionWindowOpen && opportunity.decisionWindowClosesAt ? (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-card border border-warning bg-warning-surface p-4"
        >
          <p className="text-sm font-semibold text-warning-text">
            {t("decisionWindow.title")}
          </p>
          <p className="text-sm text-content">
            {t("decisionWindow.body", {
              funded: formatQuantity(opportunity.fundedQuantity, appLocale),
              target: formatQuantity(opportunity.targetQuantity, appLocale),
              unit: unit ?? "",
            })}
          </p>
          <p className="text-sm text-content">
            <span className="text-content-muted">
              {t("decisionWindow.remaining")}{" "}
            </span>
            <TimeRemaining
              endAt={opportunity.decisionWindowClosesAt}
              className="font-semibold text-warning-text"
            />
          </p>
          <p className="text-xs text-content-muted">
            {t("decisionWindow.closesAt")}:{" "}
            {formatDateTime(opportunity.decisionWindowClosesAt, appLocale)}
          </p>
          {/* THE THIRD ANSWER, which needs no button. Doing nothing is a
              decision here and it is the one with consequences. */}
          <p className="text-xs text-content-muted">
            {t("decisionWindow.silence")}
          </p>
        </div>
      ) : null}

      {/* ============================================== the product
          THE PICTURE, THE NAME, THE STATE AND WHAT CAN BE DONE — on one
          band, as the approved reference draws it.

          THE STATE IS SAID ONCE. It used to appear as a badge and again
          as a titled card of its own directly beneath, so a paused
          offer announced itself twice before the terms were reached.
          The badge carries it; the sentence under it is what to DO
          about it, which is a different fact.

          THE ACTIONS ARE WHERE THE DECISION IS, not three screens down
          past the tax breakdown. */}
      <Card>
        <CardBody className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_16rem_18rem]">
          <div className="flex min-w-0 items-start gap-4">
            <span className="block size-28 shrink-0">
              <OpportunityImage
                src={opportunity.imageUrl}
                productName={name}
                noImageLabel={t("noImage")}
                className="h-full rounded-card"
              />
            </span>
            <span className="flex min-w-0 flex-col gap-1.5">
              {/* WHAT IT IS — on one line. */}
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="truncate text-2xl font-semibold text-content">
                  {name}
                </h1>
                {unit ? (
                  <span className="text-sm text-content-muted">{unit}</span>
                ) : null}
                <StatusBadge
                  label={
                    opportunity.reasonCode
                      ? status(`opportunityReason.${opportunity.reasonCode}`)
                      : status(`opportunity.${opportunity.status}`)
                  }
                  tone={
                    opportunity.status === "ACTION_REQUIRED" ||
                    opportunity.status === "PAUSED"
                      ? "attention"
                      : opportunity.status === "ACTIVE" ||
                          opportunity.status === "FUNDED"
                        ? "done"
                        : "neutral"
                  }
                />
              </span>

              {/* WHAT IT COSTS — the figure and what it is per, on
                  the same line rather than one above the other. */}
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-xl font-semibold text-content">
                  <Money
                    amount={opportunity.unitPriceAmount}
                    currency={opportunity.currency}
                    locale={appLocale}
                  />
                </span>
                <span className="text-xs text-content-muted">
                  {[unit ? t("perUnit", { unit }) : null, t("priceInclTax")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {/* WHAT THE STATE MEANS, in the supplier's own terms,
                  and what to do next when something is blocking it. */}
              <span className="text-sm text-content-muted">{nextStep}</span>

              {/* AND WHAT IS IN THE WAY, when it is another offer. Said
                  here beside the state rather than as a banner of its
                  own: it IS the answer to "why can this not go live",
                  which is the question the line above just raised. */}
              {liveSibling ? (
                <span className="text-sm text-content-muted">
                  {t("liveOffer.note")}{" "}
                  <Link
                    href={`/${appLocale}/supplier/opportunities/${liveSibling.id}`}
                    className="text-secondary hover:opacity-[var(--state-hover-opacity)]"
                  >
                    {t("liveOffer.open")}
                  </Link>
                </span>
              ) : null}
            </span>
          </div>

          {/* -------------------------------------- what has sold */}
          <div className="flex min-w-0 flex-col justify-center gap-1 border-line lg:border-s lg:px-4">
            <span className="text-xs font-medium text-content-muted">
              {t("soldOfTarget")}
            </span>
            <span className="text-sm text-content">
              {t("fundedOfTarget", {
                funded: formatQuantity(opportunity.fundedQuantity, appLocale),
                target: formatQuantity(opportunity.targetQuantity, appLocale),
              })}
              {unit ? ` ${unit}` : ""}
            </span>
            <span
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={opportunity.targetQuantity}
              aria-valuenow={opportunity.fundedQuantity}
              aria-label={t("soldOfTarget")}
              className="block h-2 w-full overflow-hidden rounded-full bg-background"
            >
              <span
                className="block h-full rounded-full bg-secondary"
                style={{ inlineSize: `${soldPercent}%` }}
              />
            </span>
            <span className="text-xs text-content-muted">
              {formatQuantity(Math.round(soldPercent), appLocale)}%
            </span>
          </div>

          {/* ------------------------------------ what can be done */}
          <div className="flex min-w-0 flex-col justify-center gap-2 border-line lg:border-s lg:px-4">
            <Link
              href={`/${appLocale}/supplier/products/${opportunity.productId}`}
              className="inline-flex min-h-nav items-center justify-center gap-2 rounded-control bg-secondary px-control-x text-sm font-medium text-secondary-foreground hover:opacity-[var(--state-hover-opacity)]"
            >
              <Pencil aria-hidden className="size-4 shrink-0" />
              {t("actions.editDetails")}
            </Link>

            {/* The offer's own fields — price, quantity, dates — follow
                its state, and the link appears only where a write would
                be accepted. A link into a form that cannot be saved is
                worse than no link. */}
            {gate.canUpdate ? (
              <Link
                href={`/${appLocale}/supplier/opportunities/${opportunity.id}/edit`}
                className="inline-flex min-h-nav items-center justify-center gap-2 rounded-control border border-line px-control-x text-sm font-medium text-content hover:bg-background"
              >
                {t("actions.edit")}
              </Link>
            ) : null}

            <OpportunityActions
              opportunityId={opportunity.id}
              gate={gate}
              listHref={backHref}
              labels={{
                publish: t("actions.publish"),
                publishPrompt: t("actions.publishPrompt"),
                closeAtReached: t("actions.closeAtReached"),
                closeAtReachedPrompt: t("actions.closeAtReachedPrompt"),
                stop: t("actions.stop"),
                stopPrompt: t("actions.stopPrompt"),
                extend: t("actions.extend"),
                extendPrompt: t("actions.extendPrompt"),
                delete: t("actions.delete"),
                deletePrompt: t("actions.deletePrompt"),
                confirm: common("confirm"),
                cancel: common("cancel"),
                working: t("actions.working"),
                errorTitle: states("errorTitle"),
                requestIdLabel: states("requestIdLabel"),
              }}
            />

            {/* THE SHELF ITSELF, on the listing that has one.

                «المورد يستطيع تعديل المخزون صعودًا أو هبوطًا» — and it
                sits here rather than in the edit form because the edit
                form is refused the moment a buyer commits, which is
                exactly when restocking starts to matter. */}
            {opportunity.saleMode === "DIRECT" && gate.canStop ? (
              <DirectStockForm
                opportunityId={opportunity.id}
                targetQuantity={opportunity.targetQuantity}
                labels={{
                  title: t("stock.title"),
                  field: t("stock.field"),
                  hint: t("stock.hint"),
                  save: t("stock.save"),
                  saving: t("stock.saving"),
                  errorTitle: states("errorTitle"),
                  requestIdLabel: states("requestIdLabel"),
                  notANumber: t("stock.notANumber"),
                }}
              />
            ) : null}

            {gate.canExtend ? (
              <span className="text-xs text-content-muted">
                {t("extendOnce")}
              </span>
            ) : null}
            {opportunity.status === "ACTIVE" ? (
              <span className="text-xs text-content-muted">
                {t("offeredToTraders")}
              </span>
            ) : null}

            {/* AND THE WAY OUT, last in the column. It was a row of
                its own above the whole page for one short link. */}
            <Link
              href={backHref}
              className="inline-flex min-h-nav items-center justify-center text-sm text-secondary hover:opacity-[var(--state-hover-opacity)]"
            >
              {t("backToList")}
            </Link>
          </div>
        </CardBody>
      </Card>

      {/* ============================= الشروط والمدد، كما تُنشأ
          «استخدم معها نفس أسلوبنا في عرض تفاصيل المنتج.»

          THE SAME TWO CARDS «إنشاء عرض» DRAWS, in the same order and
          the same proportions — what is being sold and on what terms
          takes seven columns, and for how long takes five.

          WHAT STOOD HERE WAS FIVE CARDS: terms, tax, schedule,
          origin and description, each with a titled header block of
          its own and a list of facts stacked name-over-value. Five
          card paddings, five headers and two lines per fact, for
          fifteen short answers — a page the height of a screen and a
          half carrying what fits in half of one.

          NOTHING IS LOST, IT IS FILED. The tax breakdown belongs with
          the price it is a breakdown OF; the frozen region and city
          are what the branch field became at publication; the
          description is a term of the sale. The dates are the
          timing card, which is what that card is for.

          READ, NOT TYPED — the same `ReadValue` the product page
          uses, so a supplier reads back what he entered in the boxes
          he entered it in. */}
      <div className="grid grid-cols-12 gap-card-gap">
        <Card
          className="col-span-12 lg:col-span-7"
          ariaLabel={sectionText("sections.offerTerms")}
        >
          <CardBody>
            <SectionTitle icon={<Gift className="size-5 text-secondary" />}>
              {sectionText("sections.offerTerms")}
            </SectionTitle>

            <div className="grid grid-cols-6 content-start gap-x-4 gap-y-2">
              <FieldRow
                className={HALF6}
                label={<ReadName>{t("unitPrice")}</ReadName>}
                control={
                  <ReadValue>
                    {price ? money(opportunity.unitPriceAmount) : null}
                  </ReadValue>
                }
              />
              <FieldRow
                className={HALF6}
                label={<ReadName>{t("targetQuantity")}</ReadName>}
                control={
                  <ReadValue>
                    {formatQuantity(opportunity.targetQuantity, appLocale)}
                  </ReadValue>
                }
              />
              <FieldRow
                className={HALF6}
                label={<ReadName>{t("funded")}</ReadName>}
                control={
                  <ReadValue>
                    {t("fundedOfTarget", {
                      funded: formatQuantity(
                        opportunity.fundedQuantity,
                        appLocale,
                      ),
                      target: formatQuantity(
                        opportunity.targetQuantity,
                        appLocale,
                      ),
                    })}
                  </ReadValue>
                }
              />
              <FieldRow
                className={HALF6}
                label={<ReadName>{t("preparationDays")}</ReadName>}
                control={
                  <ReadValue>
                    {t("days", { count: opportunity.expectedPreparationDays })}
                  </ReadValue>
                }
              />

              {/* THE SHARE, WHEN THERE IS ONE. Both halves come from
                  the policy version pinned at publication, so before
                  that there is nothing to show and a zero would be a
                  claim about a tier nobody has been placed in. */}
              {opportunity.shareQuantity !== null ? (
                <FieldRow
                  className={HALF6}
                  label={<ReadName>{t("shareQuantity")}</ReadName>}
                  control={
                    <ReadValue>
                      {formatQuantity(opportunity.shareQuantity, appLocale)}
                    </ReadValue>
                  }
                />
              ) : null}
              {opportunity.sharePercentage !== null ? (
                <FieldRow
                  className={HALF6}
                  label={<ReadName>{t("sharePercentage")}</ReadName>}
                  control={
                    <ReadValue>
                      {formatPercentage(opportunity.sharePercentage, appLocale)}
                    </ReadValue>
                  }
                />
              ) : null}

              {/* THE BREAKDOWN OF THE PRICE ABOVE, filed with it
                  rather than in a card of its own. It is FROZEN at
                  publication: before that there is none, and a zero
                  would be a claim that no tax applies. */}
              {exclTax ? (
                <FieldRow
                  className={HALF6}
                  label={<ReadName>{t("unitPriceExclTax")}</ReadName>}
                  control={<ReadValue>{exclTax}</ReadValue>}
                />
              ) : null}
              {tax ? (
                <FieldRow
                  className={HALF6}
                  label={<ReadName>{t("unitTax")}</ReadName>}
                  control={<ReadValue>{tax}</ReadValue>}
                />
              ) : null}
              {opportunity.taxRatePercent !== null ? (
                <FieldRow
                  className={HALF6}
                  label={<ReadName>{t("taxRate")}</ReadName>}
                  control={
                    <ReadValue>{`${opportunity.taxRatePercent}%`}</ReadValue>
                  }
                />
              ) : null}
              {totalValue ? (
                <FieldRow
                  className={HALF6}
                  label={<ReadName>{t("totalValue")}</ReadName>}
                  control={<ReadValue>{totalValue}</ReadValue>}
                />
              ) : null}

              {/* WHERE IT SHIPS FROM — the branch field, as it stands
                  after publication froze it. GATED ON THE REGION, not
                  on the city: a branch may name a region and no city,
                  and testing the city first hid the region too. */}
              {shipsFromRegion ? (
                <FieldRow
                  className={HALF6}
                  label={<ReadName>{t("shipsFromRegion")}</ReadName>}
                  control={<ReadValue>{shipsFromRegion}</ReadValue>}
                />
              ) : (
                <FieldRow
                  className={HALF6}
                  label={<ReadName>{t("shipsFromRegion")}</ReadName>}
                  control={<ReadValue>{t("originNotFrozenYet")}</ReadValue>}
                />
              )}
              {shipsFromCity ? (
                <FieldRow
                  className={HALF6}
                  label={<ReadName>{t("shipsFromCity")}</ReadName>}
                  control={<ReadValue>{shipsFromCity}</ReadValue>}
                />
              ) : null}

              {description ? (
                <FieldRow
                  className="col-span-6"
                  label={<ReadName>{t("descriptionTitle")}</ReadName>}
                  control={<ReadValue multiline>{description}</ReadValue>}
                />
              ) : null}
            </div>
          </CardBody>
        </Card>

        {/* ============================================ مدة العرض */}
        <Card
          className="col-span-12 lg:col-span-5"
          ariaLabel={sectionText("sections.offerTiming")}
        >
          <CardBody>
            <SectionTitle
              icon={<CalendarClock className="size-5 text-accent" />}
            >
              {sectionText("sections.offerTiming")}
            </SectionTitle>

            <div className="grid grid-cols-12 content-start gap-x-4 gap-y-2">
              <FieldRow
                className={HALF12}
                labelWidth={SHORT_LABEL}
                label={<ReadName>{t("startsAt")}</ReadName>}
                control={
                  <ReadValue>
                    <time dateTime={opportunity.startAt}>
                      {formatDateTime(opportunity.startAt, appLocale)}
                    </time>
                  </ReadValue>
                }
              />
              <FieldRow
                className={HALF12}
                labelWidth={SHORT_LABEL}
                label={<ReadName>{t("endsAt")}</ReadName>}
                control={
                  <ReadValue>
                    {/* A DIRECT LISTING HAS NO CLOSING DATE, so the row
                        shows nothing rather than an empty `time`. */}
                    {opportunity.endAt === null ? null : (
                      <time dateTime={opportunity.endAt}>
                        {formatDateTime(opportunity.endAt, appLocale)}
                      </time>
                    )}
                  </ReadValue>
                }
              />

              {/* THE FOUR THAT ONLY SOME OFFERS HAVE. Each is drawn
                  where it happened and nowhere when it did not — an
                  empty «أُوقف في» is a claim that it was. */}
              {opportunity.firstActivatedAt ? (
                <FieldRow
                  className={HALF12}
                  labelWidth={SHORT_LABEL}
                  label={<ReadName>{t("firstActivatedAt")}</ReadName>}
                  control={
                    <ReadValue>
                      {formatDate(opportunity.firstActivatedAt, appLocale)}
                    </ReadValue>
                  }
                />
              ) : null}
              {opportunity.extendedAt ? (
                <FieldRow
                  className={HALF12}
                  labelWidth={SHORT_LABEL}
                  label={<ReadName>{t("extendedAt")}</ReadName>}
                  control={
                    <ReadValue>
                      {formatDate(opportunity.extendedAt, appLocale)}
                    </ReadValue>
                  }
                />
              ) : null}
              {opportunity.pausedAt ? (
                <FieldRow
                  className={HALF12}
                  labelWidth={SHORT_LABEL}
                  label={<ReadName>{t("pausedAt")}</ReadName>}
                  control={
                    <ReadValue>
                      {formatDate(opportunity.pausedAt, appLocale)}
                    </ReadValue>
                  }
                />
              ) : null}
              {opportunity.blockedAt ? (
                <FieldRow
                  className={HALF12}
                  labelWidth={SHORT_LABEL}
                  label={<ReadName>{t("blockedAt")}</ReadName>}
                  control={
                    <ReadValue>
                      {formatDate(opportunity.blockedAt, appLocale)}
                    </ReadValue>
                  }
                />
              ) : null}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Breadcrumb({
  href,
  label,
  back,
}: {
  href: string;
  label: string;
  back: string;
}) {
  return (
    <nav aria-label={label} className="text-sm">
      <Link
        href={href}
        className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
      >
        {back}
      </Link>
    </nav>
  );
}
