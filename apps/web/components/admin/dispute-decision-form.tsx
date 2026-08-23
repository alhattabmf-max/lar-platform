"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { newIdempotencyKey, type IdempotencyKey } from "@/lib/idempotency";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

/**
 * Deciding one dispute.
 *
 * MONEY STAYS A STRING the entire way. The two refund amounts live in
 * state as the digits the operator typed and are sent as decimal
 * strings — the endpoint validates them with `@IsDecimalString()`.
 * Nothing here parses them into a JavaScript number, and nothing here
 * adds them up: the server checks each against the allocation's frozen
 * financial snapshot, and a total computed in a browser is a second
 * source of truth that will eventually disagree with what was refunded.
 *
 * WHICH FIELDS APPEAR depends on the decision, because the server's
 * requirements do:
 *   FULL_REFUND, REJECTED — reason only.
 *   PARTIAL_REFUND        — both amounts required.
 *   REPLACEMENT           — a quantity required, bounded by the
 *                           original allocation quantity.
 * Showing an amount field for a full refund would invite someone to
 * type a figure that is then ignored.
 *
 * IDEMPOTENCY is mandatory on this endpoint — the API rejects the
 * request without the header. The key is minted once when the form is
 * opened and reused for every retry, so a resubmission after a timeout
 * cannot issue a second refund obligation for the same dispute.
 *
 * The `decisionType` options are passed in already filtered by the
 * caller, which knows whether this is the first decision or the one
 * allowed after a failed replacement — the server permits only a refund
 * in that second case.
 */
export interface DisputeDecisionFormProps {
  disputeId: string;
  /** Decision types the server will accept right now. Already filtered. */
  allowed: readonly string[];
  /** Upper bound the server enforces on a replacement quantity. */
  maxReplacementQuantity: number;
  labels: {
    legend: string;
    decisionType: string;
    decisionOption: (value: string) => string;
    productRefund: string;
    shippingRefund: string;
    amountHint: string;
    replacementQuantity: string;
    replacementHint: string;
    reasonNote: string;
    reasonHint: string;
    submit: string;
    working: string;
    required: string;
    errorTitle: string;
    requestIdLabel: string;
  };
}

/** Exactly the canonical money form: digits, a dot, two digits. */
const AMOUNT_PATTERN = /^\d+\.\d{2}$/;

const REASON_MIN = 5;
const REASON_MAX = 2000;

export function DisputeDecisionForm({
  disputeId,
  allowed,
  maxReplacementQuantity,
  labels,
}: DisputeDecisionFormProps) {
  const router = useRouter();
  const root = useTranslations();
  const ids = useId();

  const [decisionType, setDecisionType] = useState(allowed[0] ?? "");
  const [productRefund, setProductRefund] = useState("");
  const [shippingRefund, setShippingRefund] = useState("");
  const [replacementQuantity, setReplacementQuantity] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [key, setKey] = useState<IdempotencyKey>(() => newIdempotencyKey());

  const needsAmounts = decisionType === "PARTIAL_REFUND";
  const needsQuantity = decisionType === "REPLACEMENT";

  const quantity = Number.parseInt(replacementQuantity, 10);
  const quantityValid =
    Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= maxReplacementQuantity;

  const ready =
    decisionType !== "" &&
    reasonNote.trim().length >= REASON_MIN &&
    (!needsAmounts ||
      (AMOUNT_PATTERN.test(productRefund) && AMOUNT_PATTERN.test(shippingRefund))) &&
    (!needsQuantity || quantityValid);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;

    setBusy(true);
    setFailure(null);

    try {
      await apiClient.post(
        `/admin/disputes/${disputeId}/decide`,
        {
          decisionType,
          reasonNote: reasonNote.trim(),
          // Sent only when the decision needs them. An unused amount in
          // the body would be rejected outright: the global validation
          // pipe runs with `forbidNonWhitelisted`, and sending fields
          // the decision does not use is how a stale value gets stored.
          ...(needsAmounts
            ? { productRefundAmountInclTax: productRefund, shippingRefundAmount: shippingRefund }
            : {}),
          ...(needsQuantity ? { replacementQuantity: quantity } : {}),
        },
        { idempotencyKey: key }
      );
      setBusy(false);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setBusy(false);
      // A NEW key for the next attempt only after a failure that the
      // server definitively rejected would be wrong — the same intent is
      // being retried, so the key is deliberately kept. It is replaced
      // only when the operator changes the decision below.
    }
  }

  /**
   * Changing the decision makes this a different instruction, so it gets
   * a different key. Reusing the old one would make the API replay the
   * FIRST decision and report success for a decision that never
   * happened.
   */
  function changeDecision(value: string) {
    setDecisionType(value);
    setKey(newIdempotencyKey());
    setFailure(null);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <fieldset className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
        <legend className="px-1 text-base font-medium text-content">{labels.legend}</legend>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-type`} required requiredLabel={labels.required}>
            {labels.decisionType}
          </Label>
          <Select
            id={`${ids}-type`}
            value={decisionType}
            onChange={(event) => changeDecision(event.target.value)}
          >
            {allowed.map((value) => (
              <option key={value} value={value}>
                {labels.decisionOption(value)}
              </option>
            ))}
          </Select>
        </div>

        {needsAmounts ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-product`} required requiredLabel={labels.required}>
                {labels.productRefund}
              </Label>
              <Input
                id={`${ids}-product`}
                // `inputMode="decimal"` gives a numeric keypad without
                // making this a number input: `type="number"` would let
                // the browser reformat, round, or hand back an
                // exponential string for a money value.
                inputMode="decimal"
                value={productRefund}
                onChange={(event) => setProductRefund(event.target.value)}
                aria-describedby={`${ids}-amount-hint`}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-shipping`} required requiredLabel={labels.required}>
                {labels.shippingRefund}
              </Label>
              <Input
                id={`${ids}-shipping`}
                inputMode="decimal"
                value={shippingRefund}
                onChange={(event) => setShippingRefund(event.target.value)}
                aria-describedby={`${ids}-amount-hint`}
              />
            </div>
            <p id={`${ids}-amount-hint`} className="text-xs text-content-muted sm:col-span-2">
              {labels.amountHint}
            </p>
          </div>
        ) : null}

        {needsQuantity ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-quantity`} required requiredLabel={labels.required}>
              {labels.replacementQuantity}
            </Label>
            <Input
              id={`${ids}-quantity`}
              inputMode="numeric"
              value={replacementQuantity}
              onChange={(event) => setReplacementQuantity(event.target.value)}
              aria-describedby={`${ids}-quantity-hint`}
            />
            <p id={`${ids}-quantity-hint`} className="text-xs text-content-muted">
              {labels.replacementHint}
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-reason`} required requiredLabel={labels.required}>
            {labels.reasonNote}
          </Label>
          <textarea
            id={`${ids}-reason`}
            value={reasonNote}
            onChange={(event) => setReasonNote(event.target.value)}
            minLength={REASON_MIN}
            maxLength={REASON_MAX}
            rows={4}
            aria-describedby={`${ids}-reason-hint`}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-content"
          />
          <p id={`${ids}-reason-hint`} className="text-xs text-content-muted">
            {labels.reasonHint}
          </p>
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

        <Button type="submit" className="min-h-11" isLoading={busy} disabled={busy || !ready}>
          {busy ? labels.working : labels.submit}
        </Button>
      </fieldset>
    </form>
  );
}
