"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/field";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createCheckoutSession } from "@/lib/checkout-create";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import {
  stepQuantity,
  toAllocationIntents,
  validatePurchase,
  type AllocationDraft,
  type PurchaseIssue,
  type SelectableLocation,
} from "@/lib/purchase-composer";
import { formatQuantity } from "@/lib/money";
import { Button } from "@/components/ui/button";

/**
 * Choosing a quantity and where it goes, then starting checkout.
 *
 * This is the only screen that composes a purchase, and the only caller
 * of `createCheckoutSession`. Everything it collects — the quantity and
 * the per-branch split — is exactly what the server hashes into the
 * idempotency fingerprint, so the operation's identity is this form's
 * contents.
 *
 * WHAT IT DOES NOT DO: no total. Shipping depends on the tariff tier
 * for each destination and tax on the frozen opportunity, and both are
 * computed server-side into `quote_snapshots`. A figure calculated here
 * would be a second source of truth, and the person would discover the
 * discrepancy at the payment screen. There is no estimate endpoint, so
 * there is no estimate — the totals appear on the checkout page, from
 * the server, after the session exists.
 *
 * Availability works the same way. `unsoldQuantity` is checked here to
 * catch the obvious mistake early, but it is `target − funded` as of
 * page render. The lock the server takes during checkout is the only
 * authority, and the copy says so rather than implying a reservation.
 */
export interface PurchaseComposerProps {
  opportunityId: string;
  locale: string;
  /** The purchase step AND the minimum. */
  shareQuantity: number;
  unsoldQuantity: number;
  /**
   * Already localised, for reading beside a quantity.
   *
   * Nullable because the frozen opportunity's selling unit genuinely
   * is: an older snapshot may carry none. Where it is absent the
   * quantity reads on its own rather than beside an empty space.
   */
  salesUnitName: string | null;
  /** The trader's own active branches, from the API. */
  locations: readonly SelectableLocation[];
  /** Where to send someone who has no branches yet. */
  accountLocationsHref: string;
  /**
   * DROPS EVERY LINE THAT IS NOT A CONTROL.
   *
   * «بطاقة اشترِ طويلة جدًا، اختصرها فقط في تحديد الكمية وتحديد الفرع
   * بدون شروحات غير مهمة.»
   *
   * The composer is the whole purchase screen when it stands alone; on
   * the buyer's detail page it is ONE of three cards, and four of its
   * lines are either said again on the card beside it or are pure
   * explanation:
   *
   *   - its own heading, under a card already headed «اشترِ الآن»
   *   - the step hint, which is what the stepper does
   *   - the unsold figure, which IS «الكمية المتبقية» one card over
   *   - the caveat on that figure, printed there too
   *
   * WHAT STAYS is the quantity, the branch, the button, and the note
   * about shipping and tax — the last because a reader deciding to
   * press the button needs to know the price is not the total, and
   * nothing else on the page says so.
   */
  compact?: boolean;
}

export function PurchaseComposer({
  opportunityId,
  locale,
  shareQuantity,
  unsoldQuantity,
  salesUnitName,
  compact = false,
  locations,
  accountLocationsHref,
}: PurchaseComposerProps) {
  const t = useTranslations("trader.compose");
  const states = useTranslations("states");
  const root = useTranslations();
  const router = useRouter();

  const formId = useId();
  const quantityId = `${formId}-quantity`;
  const errorSummaryId = `${formId}-errors`;

  const selectableIds = useMemo(() => locations.map((l) => l.id), [locations]);

  // A single branch takes the whole quantity: there is one possible
  // split, and making someone type it is a step with no decision in it.
  const singleLocation = locations.length === 1;

  const [quantity, setQuantity] = useState<number | null>(shareQuantity > 0 ? shareQuantity : 1);
  const [allocations, setAllocations] = useState<AllocationDraft[]>(() =>
    locations.length >= 1
      ? [{ companyLocationId: locations[0].id, quantity: shareQuantity > 0 ? shareQuantity : 1 }]
      : []
  );

  const [submitting, setSubmitting] = useState(false);
  const [issues, setIssues] = useState<PurchaseIssue[]>([]);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const quantityRef = useRef<HTMLInputElement>(null);
  const allocationRefs = useRef<(HTMLInputElement | null)[]>([]);

  const draft = { quantity, allocations, shareQuantity, unsoldQuantity, selectableIds };

  /** Applies a new total, keeping a single branch in step with it. */
  function applyQuantity(next: number | null) {
    setQuantity(next);
    // Any change to the total re-opens the split. With one branch the
    // answer is forced, so it follows; with several it does not, because
    // redistributing someone's split for them changes their order.
    if (singleLocation) {
      setAllocations((rows) =>
        rows.length === 1 ? [{ ...rows[0], quantity: next }] : rows
      );
    }
    // Errors are re-derived on submit, not on every keystroke: shouting
    // "invalid" at someone mid-typing is noise.
    setIssues([]);
  }

  function setAllocationQuantity(index: number, next: number | null) {
    setAllocations((rows) =>
      rows.map((row, i) => (i === index ? { ...row, quantity: next } : row))
    );
    // A SINGLE BRANCH IS THE WHOLE ORDER, so its field IS the total.
    //
    // The total already mirrored DOWN into a lone allocation — see
    // `applyQuantity` — and nothing mirrored back, because there were
    // always two controls and the top one was authoritative. With that
    // control gone from the compact card («نكتفي بالحقل اللي في خانة
    // مواقع التسليم ونغير منه الكمية») the mirror has to run both ways,
    // or the figure submitted is whatever the total happened to be when
    // the page loaded.
    //
    // ONLY WHEN THERE IS ONE. With several branches the total and the
    // split are different questions, and the total keeps its own field.
    //
    // READ OUTSIDE THE UPDATER. A state updater must be pure — React
    // may call it twice — and setting other state from inside one is
    // how that rule gets broken quietly.
    if (allocations.length === 1) setQuantity(next);
    setIssues([]);
  }

  function setAllocationLocation(index: number, id: string) {
    setAllocations((rows) =>
      rows.map((row, i) => (i === index ? { ...row, companyLocationId: id } : row))
    );
    setIssues([]);
  }

  function addAllocation() {
    // Defaults to a branch not already chosen, so the common case needs
    // no correction — but a duplicate is still reported rather than
    // prevented, because the select cannot know what someone meant.
    const used = new Set(allocations.map((a) => a.companyLocationId));
    const next = locations.find((l) => !used.has(l.id)) ?? locations[0];
    if (!next) return;

    setAllocations((rows) => [...rows, { companyLocationId: next.id, quantity: null }]);
    setIssues([]);
  }

  function removeAllocation(index: number) {
    setAllocations((rows) => rows.filter((_, i) => i !== index));
    setIssues([]);
  }

  function focusFirstIssue(found: PurchaseIssue[]) {
    const first = found[0];
    if (!first) return;

    if (first.field === "quantity") {
      quantityRef.current?.focus();
      return;
    }
    allocationRefs.current[first.field.allocationIndex]?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const found = validatePurchase(draft);
    if (found.length > 0) {
      setIssues(found);
      setFailure(null);
      focusFirstIssue(found);
      return;
    }

    setSubmitting(true);
    setIssues([]);
    setFailure(null);

    try {
      const session = await createCheckoutSession({
        opportunityId,
        quantity: quantity!,
        allocations: toAllocationIntents(allocations),
      });

      // The id comes from the RESPONSE, never from anything held here:
      // a replayed retry returns the original session, and navigating
      // to a locally-remembered id would land on the wrong one.
      router.push(`/${locale}/trader/checkout/${session.id}`);
      // Left submitting: the navigation is in flight, and re-enabling
      // the button would invite a second purchase.
    } catch (error) {
      // The draft is untouched. Every value stays on screen — a form
      // that clears itself on failure makes the person re-enter a
      // purchase they already described. The idempotency key is kept or
      // released by `createCheckoutSession` according to the failure;
      // nothing here second-guesses it.
      setFailure(toUserFacingError(error));
      setSubmitting(false);
    }
  }

  // ---- no branches: explain, do not present a dead button -----------
  if (locations.length === 0) {
    return (
      <section
        aria-label={t("title")}
        className="flex flex-col gap-3 rounded-lg border border-warning bg-warning-surface p-4 text-warning-text"
      >
        <h2 className="text-base font-semibold">{t("noLocations.title")}</h2>
        <p className="text-sm">{t("noLocations.description")}</p>
        <Link
          href={accountLocationsHref}
          className="self-start text-sm font-medium underline underline-offset-4"
        >
          {t("noLocations.action")}
        </Link>
      </section>
    );
  }

  const issueFor = (field: PurchaseIssue["field"]) =>
    issues.find((issue) =>
      field === "quantity"
        ? issue.field === "quantity"
        : typeof issue.field === "object" &&
          typeof field === "object" &&
          issue.field.allocationIndex === field.allocationIndex
    );

  const quantityIssue = issueFor("quantity");
  const allocated = allocations.reduce((sum, a) => sum + (a.quantity ?? 0), 0);

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t("title")}
      className={
        compact
          ? // NO CARD OF ITS OWN INSIDE A CARD. A surface, a shadow and
            // a padding drawn again within the one already around it is
            // the second container this design keeps striking off.
            "flex flex-col gap-3"
          : "flex flex-col gap-5 rounded-card bg-surface shadow-card px-card-x py-card-y"
      }
    >
      {compact ? null : (
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-content">{t("title")}</h2>
          <p className="text-sm text-content-muted">
            {salesUnitName
              ? t("step", {
                  quantity: formatQuantity(shareQuantity, locale as never),
                  unit: salesUnitName,
                })
              : t("stepNoUnit", { quantity: formatQuantity(shareQuantity, locale as never) })}
          </p>
        </div>
      )}

      {/* ---- quantity ----

          HIDDEN WHEN IT IS THE SAME NUMBER TWICE — «الكمية ماخذة مساحة
          كبيرة ومكررة في مربع مواقع التسليم».

          A lone branch takes the whole order, so this stepper and the
          field in that branch's row hold one figure between them. In a
          card 22rem wide the stepper also wrapped onto three lines to
          show it.

          IT RETURNS THE MOMENT A SECOND BRANCH DOES, because then the
          total and the split are different questions and the split
          cannot answer the first. */}
      <div
        className={
          compact && allocations.length === 1
            ? "hidden"
            : "flex flex-col gap-1.5"
        }
      >
        <label htmlFor={quantityId} className="text-sm font-medium text-content">
          {t("quantityLabel")}
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => applyQuantity(stepQuantity(quantity, shareQuantity, -1))}
            aria-label={t("decrease", { step: shareQuantity })}
            className="inline-flex size-8 min-h-control shrink-0 items-center justify-center rounded-control text-lg text-content disabled:opacity-[var(--state-disabled-opacity)]"
          >
            −
          </button>

          {/* Manual entry stays available: the buttons are a shortcut,
              not the only way in. `inputMode` gets a numeric keypad on a
              phone without rejecting a paste. */}
          <Input
            id={quantityId}
            ref={quantityRef}
            // A COUNT IS FOUR CHARACTERS, and it sits between a minus and
            // a plus. `Input` carries `block w-full`, so in this flex row
            // it claimed the whole line and pushed the «+» onto the next
            // one — a stepper split across two rows. Sized to what it
            // holds instead, with a floor so a phone keeps a tappable
            // target.
            className="w-24 min-w-[4.5rem] shrink-0 text-center"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={quantity ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") return applyQuantity(null);
              // Digits only, parsed as an integer. A count has no
              // decimal part, and letting one in produces a value the
              // server rejects with no explanation the person can act on.
              if (!/^\d+$/.test(raw)) return;
              applyQuantity(Number.parseInt(raw, 10));
            }}
            aria-describedby={quantityIssue ? errorSummaryId : undefined}
            aria-invalid={quantityIssue ? true : undefined}
          />

          <button
            type="button"
            onClick={() => applyQuantity(stepQuantity(quantity, shareQuantity, 1))}
            aria-label={t("increase", { step: shareQuantity })}
            className="inline-flex size-8 min-h-control shrink-0 items-center justify-center rounded-control text-lg text-content disabled:opacity-[var(--state-disabled-opacity)]"
          >
            +
          </button>

          {salesUnitName ? (
            <span className="text-sm text-content-muted">{salesUnitName}</span>
          ) : null}
        </div>

        {/* THE UNSOLD FIGURE AND ITS CAVEAT LIVE ON THE PRODUCT CARD in
            the compact form — «الكمية المتبقية» and the note that an
            arithmetic difference is not a reservation. Printing them
            here as well would be the same two sentences twice on one
            screen.

            THEY STAY when the composer stands alone, because then there
            is no card beside it carrying them. */}
        {compact ? null : (
          <>
            <p className="text-sm text-content-muted">
              {t("availability", { unsold: formatQuantity(unsoldQuantity, locale as never) })}
            </p>
            {/* Not a reservation. The lock the server takes during
                checkout is the only authority on what can actually be
                bought. */}
            <p className="text-sm text-content-muted">{t("availabilityCaveat")}</p>
          </>
        )}
      </div>

      {/* ---- destinations ---- */}
      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="text-sm font-medium text-content">{t("destinationsLabel")}</legend>

        <ul className="flex list-none flex-col gap-3">
          {allocations.map((allocation, index) => {
            const rowIssue = issueFor({ allocationIndex: index });
            const location = locations.find((l) => l.id === allocation.companyLocationId);
            const rowLabel = t("rowLabel", { index: index + 1 });

            return (
              <li
                key={`${allocation.companyLocationId}-${index}`}
                className="flex flex-col gap-2 rounded-md border border-line p-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <label
                      htmlFor={`${formId}-loc-${index}`}
                      className="text-xs uppercase tracking-wide text-content-muted"
                    >
                      {t("branchLabel")}
                    </label>
                    {/* A SELECT over the API's own list. There is no
                        free-text id field anywhere: a location outside
                        this list belongs to another company or is
                        inactive, and neither can be chosen. */}
                    <Select
                      id={`${formId}-loc-${index}`}
                      value={allocation.companyLocationId}
                      onChange={(e) => setAllocationLocation(index, e.target.value)}
                      aria-invalid={rowIssue ? true : undefined}
                    >
                      {locations.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor={`${formId}-qty-${index}`}
                      className="text-xs uppercase tracking-wide text-content-muted"
                    >
                      {t("quantityLabel")}
                    </label>
                    <Input
                      id={`${formId}-qty-${index}`}
                      ref={(el) => {
                        allocationRefs.current[index] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      // WITH ONE BRANCH AND A TOTAL FIELD ABOVE, the
                      // split is forced by that total, so this shows it
                      // and is not editable — rather than accepting a
                      // number that would then be reported as a
                      // mismatch.
                      //
                      // IN THE COMPACT CARD THERE IS NO FIELD ABOVE —
                      // «نكتفي بالحقل اللي في خانة مواقع التسليم ونغير
                      // منه الكمية» — so this one is it, and the mismatch
                      // the read-only guarded against cannot arise: a
                      // lone row and the total are the same number, kept
                      // so by the mirror in `setAllocationQuantity`.
                      readOnly={singleLocation && !compact}
                      value={allocation.quantity ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === "") return setAllocationQuantity(index, null);
                        if (!/^\d+$/.test(raw)) return;
                        setAllocationQuantity(index, Number.parseInt(raw, 10));
                      }}
                      aria-label={`${rowLabel} — ${t("quantityLabel")}`}
                      aria-invalid={rowIssue ? true : undefined}
                    />
                  </div>

                  {allocations.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeAllocation(index)}
                      className="inline-flex min-h-control items-center rounded-control px-control-x py-control-y text-[length:var(--control-font-size)] leading-[var(--control-line-height)] text-secondary hover:opacity-[var(--state-hover-opacity)]"
                    >
                      {t("removeBranch")}
                    </button>
                  ) : null}
                </div>

                {/* The branch's own details, so someone can tell two
                    similarly named ones apart. The DELIVERY region —
                    the trader's destination, not the supplier's origin
                    — narrowed by the city when the branch names one.
                    This showed the city alone, so a branch recorded on
                    a region and no city printed only its address. */}
                {location ? (
                  <p className="text-sm text-content-muted">
                    {[location.regionName, location.cityName]
                      .filter(Boolean)
                      .join(" — ") ? (
                      <>
                        {t("regionLabel")}:{" "}
                        {[location.regionName, location.cityName]
                          .filter(Boolean)
                          .join(" — ")}
                        {" · "}
                      </>
                    ) : null}
                    {location.shortAddress}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>

        {locations.length > allocations.length ? (
          <button
            type="button"
            onClick={addAllocation}
            className="self-start inline-flex min-h-control items-center rounded-control border border-line px-control-x py-control-y text-[length:var(--control-font-size)] leading-[var(--control-line-height)] text-content hover:bg-background"
          >
            {t("addBranch")}
          </button>
        ) : null}

        {allocations.length > 1 ? (
          <p className="text-sm text-content-muted">
            {t("allocatedSoFar", {
              allocated: formatQuantity(allocated, locale as never),
              quantity: formatQuantity(quantity ?? 0, locale as never),
            })}
          </p>
        ) : null}
      </fieldset>

      {/* ---- errors ---- */}
      <div id={errorSummaryId} role="alert" aria-live="assertive" className="empty:hidden">
        {issues.length > 0 ? (
          <ul className="flex list-none flex-col gap-1 rounded-md border border-danger bg-background p-3 text-sm text-danger-text">
            {issues.map((issue, i) => (
              <li key={`${issue.code}-${i}`}>{t(`issues.${issue.code}`, issue.values ?? {})}</li>
            ))}
          </ul>
        ) : failure ? (
          <div className="flex flex-col gap-1 rounded-md border border-danger bg-background p-3 text-sm">
            <p className="font-medium text-danger-text">{states("errorTitle")}</p>
            {/* The translated message for a KNOWN code, never the API's
                own text. */}
            <p className="text-content">{root(failure.messageKey)}</p>
            {failure.requestId ? (
              <p className="text-content-muted">
                {states("requestIdLabel")}:{" "}
                <span className="font-mono">{failure.requestId}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Button type="submit" isLoading={submitting} disabled={submitting}>
          {submitting ? t("submitting") : t("submit")}
        </Button>
        {/* Says plainly that the totals are not known yet, so their
            absence reads as a fact rather than a missing feature. */}
        <p className="text-sm text-content-muted">{t("totalsComeLater")}</p>
      </div>
    </form>
  );
}
