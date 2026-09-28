"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { newIdempotencyKey, type IdempotencyKey } from "@/lib/idempotency";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/**
 * An adjustment on one invoice draft.
 *
 * `POST /admin/invoice-drafts/:id/adjustments` has existed since it was
 * written with no screen anywhere that could call it — so a draft with a
 * wrong figure on it had no correction path at all.
 *
 * NOT AN `AdminAction`. That component sends one optional reason; this
 * endpoint takes three fields, one of them money, and a confirm dialog
 * with a single textarea cannot carry them.
 *
 * THE AMOUNT IS A NUMBER, not a money string. `CreateAdjustmentDto`
 * declares `@IsNumber() @IsPositive()`, which is unusual on this platform
 * — every other money field crosses the wire as a fixed-2 string — so the
 * value is sent as a number and the form refuses anything the DTO would.
 * A negative adjustment is not expressible here BECAUSE THE SERVER
 * REFUSES ONE; whether it should is not this screen's question.
 *
 * IDEMPOTENT. The key is minted when the form opens and reused for every
 * retry of that same intent — a key per press would let a timeout and a
 * retry become two adjustments.
 */

export interface InvoiceAdjustmentLabels {
  open: string;
  legend: string;
  amount: string;
  currencySuffix: string;
  sourceDescription: string;
  sourceReferenceId: string;
  sourceReferenceOptional: string;
  submit: string;
  cancel: string;
  working: string;
  saved: string;
  required: string;
  errorTitle: string;
  requestIdLabel: string;
  errorAmount: string;
  errorDescription: string;
}

export function InvoiceAdjustmentForm({
  documentId,
  labels,
  onDone,
}: {
  documentId: string;
  labels: InvoiceAdjustmentLabels;
  /** Closes the panel that opened it, after a successful write. */
  onDone: () => void;
}) {
  const router = useRouter();
  const root = useTranslations();

  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; description?: string }>({});
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  // Minted ONCE, when the form mounts — not per press. A key per press
  // would let a timeout and a retry become two adjustments.
  const [key] = useState<IdempotencyKey>(() => newIdempotencyKey());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const parsed = Number(amount);
    const found: { amount?: string; description?: string } = {};
    // @IsNumber() @IsPositive() — an empty box parses to 0, which is not
    // positive, and NaN is not a number. Both are refused here so the
    // reader is told which field is wrong rather than shown a 400.
    if (!Number.isFinite(parsed) || parsed <= 0) found.amount = labels.errorAmount;
    if (description.trim().length === 0) found.description = labels.errorDescription;
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setFailure(null);

    try {
      await apiClient.post(
        `/admin/invoice-drafts/${encodeURIComponent(documentId)}/adjustments`,
        {
          amount: parsed,
          sourceDescription: description.trim(),
          // Omitted entirely when blank: the DTO is closed, and an empty
          // string would fail `@IsString() @MinLength` on some servers
          // and be stored as an empty reference on this one.
          ...(reference.trim() ? { sourceReferenceId: reference.trim() } : {}),
        },
        { idempotencyKey: key },
      );
      router.refresh();
      onDone();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-3" noValidate>
      <p className="text-sm font-medium text-content">{labels.legend}</p>

      <div className="grid gap-3 sm:grid-cols-6">
        {/* An amount is short. It gets two columns of six, not a row. */}
        <div className="sm:col-span-2">
          <Field
            label={`${labels.amount} — ${labels.currencySuffix}`}
            error={errors.amount}
            required
            requiredLabel={labels.required}
          >
            {({ inputId, errorId, invalid }) => (
              <Input
                id={inputId}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={busy}
                describedById={errorId}
                invalid={invalid}
              />
            )}
          </Field>
        </div>

        <div className="sm:col-span-4">
          <Field
            label={labels.sourceDescription}
            error={errors.description}
            required
            requiredLabel={labels.required}
          >
            {({ inputId, errorId, invalid }) => (
              <Input
                id={inputId}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={busy}
                describedById={errorId}
                invalid={invalid}
              />
            )}
          </Field>
        </div>

        <div className="sm:col-span-3">
          <Field label={`${labels.sourceReferenceId} — ${labels.sourceReferenceOptional}`}>
            {({ inputId, errorId, invalid }) => (
              <Input
                id={inputId}
                value={reference}
                className="font-mono"
                onChange={(event) => setReference(event.target.value)}
                disabled={busy}
                describedById={errorId}
                invalid={invalid}
              />
            )}
          </Field>
        </div>
      </div>

      {failure ? (
        <p role="alert" className="text-sm text-danger">
          {labels.errorTitle}: {root(failure.messageKey)}
          {failure.requestId ? (
            <span className="block font-mono text-xs text-content-muted">
              {labels.requestIdLabel} {failure.requestId}
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? labels.working : labels.submit}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onDone}
        >
          {labels.cancel}
        </Button>
      </div>
    </form>
  );
}
