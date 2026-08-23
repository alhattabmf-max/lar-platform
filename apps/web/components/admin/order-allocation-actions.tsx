"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { newIdempotencyKey, type IdempotencyKey } from "@/lib/idempotency";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

/**
 * Settling one shipment.
 *
 * NO AMOUNT FIELD. The payout figure is computed by the server from the
 * allocation's frozen financial snapshot; an amount box here would ask
 * an operator to retype money that has already been determined, and any
 * difference between the two would be a difference in a real transfer.
 *
 * `externalTransferReference` IS a field, and it is the bank's own
 * handle for the transfer the operator just performed. It is optional
 * because a zero-balance settlement has no transfer to reference — the
 * server records the outcome as ZERO_BALANCE and there is nothing to
 * quote.
 *
 * IDEMPOTENCY is mandatory: this endpoint moves money and the API
 * rejects the request without the header. The key is minted once when
 * the form is opened and reused for every retry, so a resubmission after
 * a timeout replays the same settlement rather than paying twice.
 */
export function SettleAllocationForm({
  allocationId,
  labels,
}: {
  allocationId: string;
  labels: {
    action: string;
    prompt: string;
    reference: string;
    referenceHint: string;
    confirm: string;
    cancel: string;
    working: string;
    errorTitle: string;
    requestIdLabel: string;
  };
}) {
  const router = useRouter();
  const root = useTranslations();
  const ids = useId();

  const [asking, setAsking] = useState(false);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [key, setKey] = useState<IdempotencyKey | null>(null);

  function open() {
    setAsking(true);
    setReference("");
    setFailure(null);
    setKey(newIdempotencyKey());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || key === null) return;

    setBusy(true);
    setFailure(null);

    const trimmed = reference.trim();

    try {
      await apiClient.post(
        `/admin/order-allocations/${allocationId}/settle`,
        // Omitted entirely when blank. Sending an empty string would
        // fail the endpoint's own `@MinLength(1)`, and recording a
        // reference of "" would be worse than recording none.
        trimmed === "" ? {} : { externalTransferReference: trimmed },
        { idempotencyKey: key }
      );
      setAsking(false);
      setBusy(false);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <Button type="button" size="sm" className="min-h-11" onClick={open}>
        {labels.action}
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3"
      noValidate
    >
      <p role="status" aria-live="polite" className="text-sm text-content">
        {labels.prompt}
      </p>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-reference`}>{labels.reference}</Label>
        <Input
          id={`${ids}-reference`}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          aria-describedby={`${ids}-reference-hint`}
        />
        <p id={`${ids}-reference-hint`} className="text-xs text-content-muted">
          {labels.referenceHint}
        </p>
      </div>

      {failure ? (
        <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger p-2">
          <p className="text-sm font-medium text-content">{labels.errorTitle}</p>
          <p className="text-sm text-content-muted">{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="text-xs text-content-muted">
              {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" className="min-h-11" isLoading={busy} disabled={busy}>
          {busy ? labels.working : labels.confirm}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11"
          disabled={busy}
          onClick={() => setAsking(false)}
        >
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}
