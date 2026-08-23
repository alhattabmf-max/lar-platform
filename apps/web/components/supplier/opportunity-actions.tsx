"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import type { OpportunityActionGate } from "@/lib/opportunity-actions";

/**
 * Publish, extend and delete, for one listing.
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
export type OpportunityAction = "publish" | "extend" | "delete";

export interface OpportunityActionsProps {
  opportunityId: string;
  gate: OpportunityActionGate;
  /** Where to go after a successful delete. */
  listHref: string;
  labels: {
    publish: string;
    publishPrompt: string;
    extend: string;
    extendPrompt: string;
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
    ...(gate.canExtend ? (["extend"] as const) : []),
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
        await apiClient.delete(`/companies/me/opportunities/${opportunityId}`);
        setAsking(null);
        // The record is gone. Refreshing this page would render a 404.
        router.replace(listHref);
        router.refresh();
        return;
      }

      await apiClient.post(`/companies/me/opportunities/${opportunityId}/${action}`);
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
          {asking === "publish"
            ? labels.publishPrompt
            : asking === "extend"
              ? labels.extendPrompt
              : labels.deletePrompt}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="min-h-11"
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
            className="min-h-11"
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
        {/* All three ask first. Publishing makes the listing visible to
            traders, extending is allowed exactly once and cannot be
            undone, and deleting removes the draft permanently. */}
        {available.map((action) => (
          <Button
            key={action}
            type="button"
            size="sm"
            className="min-h-11"
            variant={action === "publish" ? "primary" : action === "extend" ? "secondary" : "ghost"}
            onClick={() => setAsking(action)}
          >
            {labels[action]}
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
      {/* The translated message for a KNOWN code, never the API's own
          text — a refused publish returns the operator-facing English
          detail string for the blocking reason. */}
      <p className="text-content">{root(failure.messageKey)}</p>
      {failure.requestId ? (
        <p className="text-content-muted">
          {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
        </p>
      ) : null}
    </div>
  );
}
