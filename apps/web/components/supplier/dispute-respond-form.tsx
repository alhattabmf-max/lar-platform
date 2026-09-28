"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  DISPUTE_SUPPLIER_RESPONSE_TYPES,
  type DisputeSupplierResponseType,
} from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { IdempotentOperation } from "@/lib/idempotency";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Label, FieldError, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

/**
 * The supplier's answer to a dispute.
 *
 * Four response types, from the shared vocabulary — the same four the API's
 * `SupplierRespondDto` enum accepts. `REPLACEMENT_OFFER` is one of them and
 * is easy to miss: a supplier may offer to send a replacement instead of
 * accepting or rejecting.
 *
 * IDEMPOTENT. `POST /supplier/disputes/:id/respond` REQUIRES an
 * `Idempotency-Key` header and rejects the request without one. The key is
 * created ONCE per logical response and reused across every retry of it —
 * a fresh key per attempt would let a double-click record two responses.
 * `IdempotentOperation` has no way to rotate its key, which is what makes
 * that structural rather than a convention.
 *
 * The description is bounded 5–2000 by the DTO; both bounds are checked
 * here so the reader is told which one they missed.
 */
export const DESCRIPTION_MIN = 5;
export const DESCRIPTION_MAX = 2000;

export interface DisputeRespondFormProps {
  disputeId: string;
  labels: {
    heading: string;
    responseType: string;
    /** Keyed by response type. */
    responseTypeOption: Record<string, string>;
    description: string;
    descriptionHint: string;
    placeholder: string;
    required: string;
    submit: string;
    submitting: string;
    prompt: string;
    confirm: string;
    cancel: string;
    errorTitle: string;
    requestIdLabel: string;
    /** ICU with {min} and {max}. */
    descriptionLength: string;
    typeRequired: string;
  };
}

export function DisputeRespondForm({ disputeId, labels }: DisputeRespondFormProps) {
  const router = useRouter();
  const root = useTranslations();

  const [responseType, setResponseType] = useState<DisputeSupplierResponseType | "">("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ type?: boolean; description?: boolean }>({});
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  /**
   * ONE key for this response, for the life of this form.
   *
   * A ref rather than state: it must survive re-renders without ever being
   * regenerated, and nothing may cause it to change.
   */
  const operation = useRef(new IdempotentOperation());

  function validate() {
    const trimmed = description.trim();
    const found = {
      type: responseType === "",
      description: trimmed.length < DESCRIPTION_MIN || trimmed.length > DESCRIPTION_MAX,
    };
    setErrors(found);
    return !found.type && !found.description;
  }

  async function send() {
    // Double-submit protection. Behind it, the idempotency key means even
    // a duplicate that reaches the server records one response.
    if (busy) return;

    setBusy(true);
    setFailure(null);

    try {
      await apiClient.post(
        `/supplier/disputes/${disputeId}/respond`,
        { responseType, description: description.trim() },
        { idempotencyKey: operation.current.get() }
      );

      setAsking(false);
      setBusy(false);
      // The server decides what the dispute now is: responding moves it on
      // and an administrator decides next.
      router.refresh();
    } catch (error) {
      // The typed response survives.
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  return (
    <section aria-label={labels.heading} className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-content">{labels.heading}</h2>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dispute-response-type" required requiredLabel={labels.required}>
          {labels.responseType}
        </Label>
        <Select
          id="dispute-response-type"
          value={responseType}
          onChange={(event) => {
            setResponseType(event.target.value as DisputeSupplierResponseType);
            setErrors((current) => ({ ...current, type: false }));
          }}
          invalid={errors.type}
          describedById={errors.type ? "dispute-response-type-error" : undefined}
          disabled={busy}
         
        >
          {/* No default answer: which of the four this is, is the whole
              decision, and pre-selecting one would make it by accident. */}
          <option value="">{labels.placeholder}</option>
          {DISPUTE_SUPPLIER_RESPONSE_TYPES.map((type) => (
            <option key={type} value={type}>
              {labels.responseTypeOption[type]}
            </option>
          ))}
        </Select>
        <FieldError id="dispute-response-type-error">
          {errors.type ? labels.typeRequired : null}
        </FieldError>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dispute-response-description" required requiredLabel={labels.required}>
          {labels.description}
        </Label>
        <Textarea
          id="dispute-response-description"
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            setErrors((current) => ({ ...current, description: false }));
          }}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={
            errors.description
              ? "dispute-response-description-error"
              : "dispute-response-description-hint"
          }
          rows={5}
          disabled={busy}
          className={`block w-full rounded-md border bg-surface px-3 py-2 text-sm text-content ${
            errors.description ? "border-danger" : "border-line-strong"
          }`}
        />
        <p id="dispute-response-description-hint" className="text-xs text-content-muted">
          {labels.descriptionHint}
        </p>
        <FieldError id="dispute-response-description-error">
          {errors.description
            ? labels.descriptionLength
                .replace("{min}", String(DESCRIPTION_MIN))
                .replace("{max}", String(DESCRIPTION_MAX))
            : null}
        </FieldError>
      </div>

      {asking ? (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3">
          {/* A response cannot be withdrawn — an administrator decides on
              it next — so it asks first. */}
          <p role="status" aria-live="polite" className="text-sm text-content">
            {labels.prompt}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
             
              onClick={send}
              isLoading={busy}
              disabled={busy}
            >
              {busy ? labels.submitting : labels.confirm}
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
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
           
            onClick={() => {
              if (validate()) setAsking(true);
            }}
          >
            {labels.submit}
          </Button>
        </div>
      )}

      {failure ? (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <p className="font-medium text-danger-text">{labels.errorTitle}</p>
          <p className="text-content">{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="text-content-muted">
              {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
