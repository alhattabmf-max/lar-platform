"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { newIdempotencyKey, type IdempotencyKey } from "@/lib/idempotency";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

/**
 * Starting one refund attempt.
 *
 * NO AMOUNT FIELD, deliberately. The endpoint accepts a provider code
 * and nothing else — the figure is read from the frozen
 * `RefundObligation` inside the service. An amount box here would ask an
 * operator to retype money that has already been decided, and any
 * discrepancy between what they typed and what is owed would be a
 * discrepancy in a real transfer.
 *
 * THE PROVIDER LIST COMES FROM THE SERVER, from the registry that will
 * actually be asked to perform the transfer. A hardcoded list in the
 * browser drifts the moment a provider is added or removed, and a
 * free-text box would ask an operator to type an internal identifier
 * from memory.
 *
 * IDEMPOTENCY is mandatory here — this endpoint moves money. The key is
 * minted once when the form is rendered and reused for every retry, so a
 * resubmission after a timeout replays the same attempt rather than
 * starting a second transfer. It is replaced only when the operator
 * chooses a different provider, which is a genuinely different
 * instruction.
 *
 * There is no confirmation dialog wrapped around this because the form
 * IS the confirmation: choosing a provider and pressing the button is
 * two deliberate acts, and the amount being transferred is stated above
 * it on the page.
 */
export function RefundAttemptForm({
  refundObligationId,
  providers,
  labels,
}: {
  refundObligationId: string;
  /** Registered provider codes, from the server. */
  providers: readonly string[];
  labels: {
    legend: string;
    provider: string;
    hint: string;
    submit: string;
    working: string;
    required: string;
    noProviders: string;
    errorTitle: string;
    requestIdLabel: string;
  };
}) {
  const router = useRouter();
  const root = useTranslations();
  const ids = useId();

  const [providerCode, setProviderCode] = useState(providers[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [key, setKey] = useState<IdempotencyKey>(() => newIdempotencyKey());

  // No providers registered means there is nothing this screen can
  // honestly offer. It says so rather than rendering a select with no
  // options and a button that cannot work.
  if (providers.length === 0) {
    return (
      <p className="rounded-card bg-surface shadow-card px-card-x py-card-y text-sm text-content-muted">
        {labels.noProviders}
      </p>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || providerCode === "") return;

    setBusy(true);
    setFailure(null);

    try {
      await apiClient.post(
        `/admin/refund-obligations/${refundObligationId}/attempts`,
        { providerCode },
        { idempotencyKey: key }
      );
      setBusy(false);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <fieldset className="flex flex-col gap-3 rounded-card bg-surface shadow-card px-card-x py-card-y">
        <legend className="px-1 text-base font-medium text-content">{labels.legend}</legend>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-provider`} required requiredLabel={labels.required}>
            {labels.provider}
          </Label>
          <Select
            id={`${ids}-provider`}
            value={providerCode}
            onChange={(event) => {
              setProviderCode(event.target.value);
              // A different provider is a different instruction, so it
              // gets a different key. Reusing the old one would make the
              // API replay the FIRST attempt and report success for a
              // transfer that never happened.
              setKey(newIdempotencyKey());
              setFailure(null);
            }}
          >
            {providers.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </div>

        {failure ? (
          <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger p-3">
            <p className="text-sm font-medium text-content">{labels.errorTitle}</p>
            <p className="text-sm text-content-muted">{root(failure.messageKey)}</p>
            {failure.requestId ? (
              <p className="text-xs text-content-muted">
                {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" isLoading={busy} disabled={busy}>
          {busy ? labels.working : labels.submit}
        </Button>
      </fieldset>
    </form>
  );
}
