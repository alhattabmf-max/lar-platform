"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";

/**
 * Confirming that a shipment arrived.
 *
 * A client component because the API's CSRF guard requires a browser
 * `Origin` header on state-changing requests, and the session cookie
 * rides along with `credentials: "include"`.
 *
 * ELIGIBILITY IS THE SERVER'S. `confirmDeliveryByTrader` claims the
 * transition only from `SHIPPED` and answers 409 otherwise, so this
 * button is rendered only for a shipped allocation — the caller checks
 * the status before mounting it. That is a courtesy, not the rule: if
 * the two ever disagree the server wins and the 409 is shown.
 *
 * There is no optimistic update. Confirming delivery starts the
 * dispute window and can complete the whole order, so the state that
 * matters is the server's — `router.refresh()` re-reads it rather than
 * painting a guess that a failed request would have to undo.
 *
 * It asks first. This is not reversible by the trader: once confirmed,
 * the allocation is delivered and the only route back is a dispute.
 */
export interface ConfirmDeliveryButtonProps {
  /** `order-allocation` or `replacement-obligation`. */
  resource: "order-allocations" | "replacement-obligations";
  id: string;
  label: string;
  confirmPrompt: string;
  confirmAction: string;
  cancelAction: string;
  submittingLabel: string;
  errorTitle: string;
  requestIdLabel: string;
}

export function ConfirmDeliveryButton({
  resource,
  id,
  label,
  confirmPrompt,
  confirmAction,
  cancelAction,
  submittingLabel,
  errorTitle,
  requestIdLabel,
}: ConfirmDeliveryButtonProps) {
  const router = useRouter();
  const root = useTranslations();

  const [asking, setAsking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  async function confirm() {
    if (submitting) return;

    setSubmitting(true);
    setFailure(null);

    try {
      // No Idempotency-Key: this endpoint requires none, and the
      // transition is claimed conditionally on the row still being
      // SHIPPED — so a duplicate arrives as a 409 rather than a second
      // confirmation.
      await apiClient.post(`/trader/${resource}/${id}/confirm-delivery`);

      setAsking(false);
      // The server decides what the page now shows: the allocation is
      // delivered, a dispute window has opened, and the order may have
      // become FULFILLED. None of that is knowable here.
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setSubmitting(false);
    }
  }

  if (!asking) {
    return (
      <div className="flex flex-col gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setAsking(true)}>
          {label}
        </Button>
        {failure ? <Failure /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-3">
      {/* Announced when it appears, because the question replaces the
          button the person just pressed. */}
      <p role="status" aria-live="polite" className="text-sm text-content">
        {confirmPrompt}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={confirm}
          isLoading={submitting}
          disabled={submitting}
        >
          {submitting ? submittingLabel : confirmAction}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAsking(false)}
          disabled={submitting}
        >
          {cancelAction}
        </Button>
      </div>

      {failure ? <Failure /> : null}
    </div>
  );

  function Failure() {
    if (!failure) return null;
    return (
      <div role="alert" className="flex flex-col gap-1 text-sm">
        <p className="font-medium text-danger-text">{errorTitle}</p>
        {/* The translated message for a KNOWN code, never the API's own
            text — that is an English developer string. */}
        <p className="text-content">{root(failure.messageKey)}</p>
        {failure.requestId ? (
          <p className="text-content-muted">
            {requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
          </p>
        ) : null}
      </div>
    );
  }
}
