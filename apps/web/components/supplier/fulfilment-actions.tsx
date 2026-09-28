"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { actionNeedsTracking } from "@/lib/fulfilment-actions";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/field";

/**
 * One fulfilment step, for an order allocation or a replacement.
 *
 * The two resources have identical transitions — `start-preparation`,
 * `mark-ready`, `ship` — identical guards and an identical `ShipDto`, so
 * they share this component rather than a copy that could drift on which
 * step needs carrier details.
 *
 * DELIVERED IS NOT HERE and cannot be. Confirming delivery belongs to the
 * trader; the API has no supplier route for it, and a button would be a
 * claim about someone else's goods.
 *
 * ELIGIBILITY IS THE SERVER'S. Every transition is claimed with a
 * conditional UPDATE and answers 409 when the row has moved on. The caller
 * passes the one action the current status allows, or nothing at all — that
 * is a courtesy so a doomed button is never drawn, not the rule.
 *
 * No optimistic status. Shipping starts a delivery window and can complete
 * an order; `router.refresh()` re-reads what actually happened rather than
 * painting a guess a failed request would have to undo.
 */
export type FulfilmentResource = "order-allocations" | "replacement-obligations";

export interface FulfilmentActionsProps {
  resource: FulfilmentResource;
  id: string;
  /** The single action the current status allows, or null for none. */
  action: string | null;
  labels: {
    /** Keyed by action segment: start-preparation | mark-ready | ship. */
    action: Record<string, string>;
    prompt: Record<string, string>;
    carrierCode: string;
    trackingNumber: string;
    trackingHint: string;
    required: string;
    confirm: string;
    cancel: string;
    working: string;
    errorTitle: string;
    requestIdLabel: string;
    fieldRequired: string;
  };
}

export function FulfilmentActions({ resource, id, action, labels }: FulfilmentActionsProps) {
  const router = useRouter();
  const root = useTranslations();

  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [carrierCode, setCarrierCode] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ carrier?: boolean; tracking?: boolean }>({});

  if (!action) return null;

  const needsTracking = actionNeedsTracking(action);

  async function run() {
    // Double-submit protection: a second press while the request is in
    // flight does nothing.
    if (busy) return;

    if (needsTracking) {
      // `ShipDto` requires both, non-empty. Checked here so the reader is
      // told which field is missing — the API's answer names neither.
      const missing = {
        carrier: carrierCode.trim().length === 0,
        tracking: trackingNumber.trim().length === 0,
      };
      if (missing.carrier || missing.tracking) {
        setFieldErrors(missing);
        return;
      }
    }

    setBusy(true);
    setFailure(null);
    setFieldErrors({});

    try {
      // No Idempotency-Key: these endpoints require none, and each
      // transition is claimed conditionally on the row still being in the
      // expected state — so a duplicate arrives as a 409, not a second
      // transition.
      await apiClient.post(
        `/supplier/${resource}/${id}/${action}`,
        needsTracking
          ? { carrierCode: carrierCode.trim(), trackingNumber: trackingNumber.trim() }
          : undefined
      );

      setAsking(false);
      setBusy(false);
      router.refresh();
    } catch (error) {
      // The typed carrier details survive the failure.
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="sm"
         
          variant="secondary"
          onClick={() => setAsking(true)}
        >
          {labels.action[action]}
        </Button>
        <Failure failure={failure} labels={labels} root={root} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      {/* Announced when it appears, because it replaces the button the
          reader just pressed. */}
      <p role="status" aria-live="polite" className="text-sm text-content">
        {labels.prompt[action]}
      </p>

      {needsTracking ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-content-muted">{labels.trackingHint}</p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-carrier`} required requiredLabel={labels.required}>
              {labels.carrierCode}
            </Label>
            <Input
              id={`${id}-carrier`}
              value={carrierCode}
              onChange={(event) => setCarrierCode(event.target.value)}
              invalid={fieldErrors.carrier}
              describedById={fieldErrors.carrier ? `${id}-carrier-error` : undefined}
             
            />
            <FieldError id={`${id}-carrier-error`}>
              {fieldErrors.carrier ? labels.fieldRequired : null}
            </FieldError>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-tracking`} required requiredLabel={labels.required}>
              {labels.trackingNumber}
            </Label>
            <Input
              id={`${id}-tracking`}
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
              invalid={fieldErrors.tracking}
              describedById={fieldErrors.tracking ? `${id}-tracking-error` : undefined}
             
            />
            <FieldError id={`${id}-tracking-error`}>
              {fieldErrors.tracking ? labels.fieldRequired : null}
            </FieldError>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
         
          onClick={run}
          isLoading={busy}
          disabled={busy}
        >
          {busy ? labels.working : labels.confirm}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
         
          disabled={busy}
          onClick={() => setAsking(false)}
        >
          {labels.cancel}
        </Button>
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
  labels: FulfilmentActionsProps["labels"];
  root: ReturnType<typeof useTranslations>;
}) {
  if (!failure) return null;

  return (
    <div role="alert" className="flex flex-col gap-1 text-sm">
      <p className="font-medium text-danger-text">{labels.errorTitle}</p>
      {/* The translated message for a KNOWN code, never the API's own
          English text. */}
      <p className="text-content">{root(failure.messageKey)}</p>
      {failure.requestId ? (
        <p className="text-content-muted">
          {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
        </p>
      ) : null}
    </div>
  );
}
