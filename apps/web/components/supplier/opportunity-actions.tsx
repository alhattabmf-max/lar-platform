"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import type { OpportunityActionGate } from "@/lib/opportunity-actions";

/**
 * Publish, close-at-reached, extend and delete, for one listing.
 *
 * A client component because the API's CSRF guard requires a browser
 * `Origin` header on state-changing requests, and the session cookie rides
 * along with `credentials: "include"` — both supplied by `apiClient`. None of
 * these endpoints takes an `Idempotency-Key`; they are not in the API's
 * idempotent set. A duplicate is prevented here by refusing to fire while a
 * request is in flight, and behind that by the server's own guards: `extend`
 * claims its transition with a conditional UPDATE (`WHERE status = 'ACTIVE'
 * AND extended_at IS NULL`) and answers 409 when the claim finds no row.
 *
 * There is no optimistic status. Publishing resolves to ACTIVE or SCHEDULED
 * depending on whether `startAt` has passed, and can instead be REFUSED for a
 * reason no client can see — an unverified company, an unapproved product, a
 * tax rate that is not configured. Painting a guess would mean undoing it.
 *
 * Deleting removes the listing, so the page it was on no longer exists: that
 * one navigates to the list rather than refreshing into a 404.
 */
/**
 * THE SUPPLIER'S TWO ANSWERS WHEN AN OFFER ENDS SHORT.
 *
 * «فرصة لم تصل هدفها مئة بالمئة بل وصلت ستين بالمئة… هنا مهلة تعطى
 *  للمورد مدة 24 ساعة: إذا قرر أن تقفل الصفقة ويعتمدها أوك، وإذا أراد
 *  أن تكتمل مئة بالمئة فعنده خيار التمديد… إذا لم ينفذ الخيارين تنتهي
 *  الفرصة وتسترد الأموال تلقائي.» And «يقرر المورد في العرض نفسه» —
 * which is why they are HERE, on the offer, and not in an inbox.
 *
 * Doing nothing is the third answer and needs no button: the clock
 * refunds every buyer when the window elapses.
 */
/**
 * `stop` IS A DIRECT LISTING'S ONLY ENDING, and it is not a delete.
 *
 * «إذا حصلت مبيعات على DIRECT لا تعدل السعر على النشرة الحالية — يوقف
 *  المورد النشرة وينشئ واحدة جديدة بالسعر الجديد.» Stopping ends new
 * sales and touches no order: every paid order on a direct listing went
 * to preparation when it was paid and is being packed, shipped and
 * settled regardless. Nobody is refunded, which is what separates it
 * from an administrator cancelling a group offer whose buyers are still
 * waiting for a target.
 */
export type OpportunityAction =
  | "publish"
  | "close-at-reached"
  | "extend"
  | "stop"
  | "delete";

/**
 * Action to label key. The action is the ROUTE SEGMENT — the API is
 * addressed by it directly — and route segments are kebab-case while
 * message keys are not.
 */
const LABEL_OF: Record<
  OpportunityAction,
  "publish" | "closeAtReached" | "extend" | "stop" | "delete"
> = {
  publish: "publish",
  "close-at-reached": "closeAtReached",
  extend: "extend",
  stop: "stop",
  delete: "delete",
};

const PROMPT_OF: Record<
  OpportunityAction,
  | "publishPrompt"
  | "closeAtReachedPrompt"
  | "extendPrompt"
  | "stopPrompt"
  | "deletePrompt"
> = {
  publish: "publishPrompt",
  "close-at-reached": "closeAtReachedPrompt",
  extend: "extendPrompt",
  stop: "stopPrompt",
  delete: "deletePrompt",
};

export interface OpportunityActionsProps {
  opportunityId: string;
  gate: OpportunityActionGate;
  /** Where to go after a successful delete. */
  listHref: string;
  labels: {
    publish: string;
    publishPrompt: string;
    closeAtReached: string;
    closeAtReachedPrompt: string;
    extend: string;
    extendPrompt: string;
    stop: string;
    stopPrompt: string;
    delete: string;
    deletePrompt: string;
    confirm: string;
    cancel: string;
    working: string;
    errorTitle: string;
    requestIdLabel: string;
  };
}

export function OpportunityActions({
  opportunityId,
  gate,
  listHref,
  labels,
}: OpportunityActionsProps) {
  const router = useRouter();
  const root = useTranslations();

  const [asking, setAsking] = useState<OpportunityAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const available: OpportunityAction[] = [
    ...(gate.canPublish ? (["publish"] as const) : []),
    // FIRST, and before extend: taking what the offer reached ends the
    // wait for every buyer already on it. Extending asks them to wait
    // longer for money that is already captured.
    ...(gate.canCloseAtReached ? (["close-at-reached"] as const) : []),
    ...(gate.canExtend ? (["extend"] as const) : []),
    ...(gate.canStop ? (["stop"] as const) : []),
    ...(gate.canDelete ? (["delete"] as const) : []),
  ];

  async function run(action: OpportunityAction) {
    // Double-submit protection: a second press while a request is in
    // flight does nothing at all.
    if (busy) return;

    setBusy(true);
    setFailure(null);

    try {
      if (action === "delete") {
        // THE LISTING ROUTE, not the opportunity one. This is the only
        // place that knows whether removing means erasing the rows or
        // archiving them, and it decides from what the listing carries
        // — a sold unit, an order, a checkout — rather than from its
        // state. Either way the supplier stops seeing it, which is what
        // they asked for; either way nothing pointing at it is orphaned.
        await apiClient.delete(`/companies/me/listings/${opportunityId}`);
        setAsking(null);
        // Gone or archived, this page no longer has anything to show.
        router.replace(listHref);
        router.refresh();
        return;
      }

      // PUBLISH THROUGH THE LISTING ROUTE. The opportunity route
      // answers a refusal with `VALIDATION_FAILED` and an
      // operator-facing English sentence, which is what a supplier used
      // to read here. The listing route records the blocker on the row
      // and returns its CODE, so the same explanation appears whether
      // the supplier pressed the button on the form or on this page.
      //
      // `extend` and `close-at-reached` keep their own routes: they
      // are offer-lifecycle actions with no blocker vocabulary and
      // nothing to explain differently. The action IS the segment.
      await apiClient.post(
        action === "publish"
          ? `/companies/me/listings/${opportunityId}/publish`
          : `/companies/me/opportunities/${opportunityId}/${action}`
      );
      setAsking(null);
      setBusy(false);
      // The server decides the resulting status and, for extend, the new
      // end date. Neither is knowable here.
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  if (available.length === 0) return null;

  if (asking !== null) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-line p-3">
        {/* Announced when it appears, because the question replaces the
            button the person just pressed. */}
        <p role="status" aria-live="polite" className="text-sm text-content">
          {labels[PROMPT_OF[asking]]}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
           
            onClick={() => run(asking)}
            isLoading={busy}
            disabled={busy}
          >
            {busy ? labels.working : labels.confirm}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
           
            onClick={() => setAsking(null)}
            disabled={busy}
          >
            {labels.cancel}
          </Button>
        </div>

        <Failure failure={failure} labels={labels} root={root} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {/* All of them ask first. Publishing makes the listing visible
            to traders, closing at what was reached ends the offer and
            starts preparation on that quantity, extending is allowed
            exactly once, and deleting removes the draft permanently —
            none of the four can be undone. */}
        {available.map((action) => (
          <Button
            key={action}
            type="button"
            size="sm"
           
            variant={
              action === "publish" || action === "close-at-reached"
                ? "primary"
                : action === "extend"
                  ? "secondary"
                  : "ghost"
            }
            onClick={() => setAsking(action)}
          >
            {labels[LABEL_OF[action]]}
          </Button>
        ))}
      </div>

      <Failure failure={failure} labels={labels} root={root} />
    </div>
  );
}

function Failure({
  failure,
  labels,
  root,
}: {
  failure: UserFacingError | null;
  labels: OpportunityActionsProps["labels"];
  root: ReturnType<typeof useTranslations>;
}) {
  if (!failure) return null;

  return (
    <div role="alert" className="flex flex-col gap-1 text-sm">
      <p className="font-medium text-danger-text">{labels.errorTitle}</p>
      {/* THE FIXING SENTENCE when the platform named a blocker, and the
          generic message only when it did not. Never the API's own
          text: a refused publish carries an operator-facing English
          detail string, which is not written for the person reading
          this. */}
      <p className="text-content">
        {failure.blockedReason
          ? root(`supplier.opportunities.reasonFix.${failure.blockedReason}`)
          : root(failure.messageKey)}
      </p>
      {failure.requestId ? (
        <p className="text-content-muted">
          {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
        </p>
      ) : null}
    </div>
  );
}
