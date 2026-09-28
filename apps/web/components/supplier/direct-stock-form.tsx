"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/field";

/**
 * RAISING AND LOWERING THE SHELF.
 *
 * «المورد يستطيع تعديل المخزون صعودًا أو هبوطًا بشرط
 *  `new target_quantity >= funded_quantity + activeLocks`.»
 *
 * IT IS NOT THE EDIT FORM, and that is the point. Editing a listing —
 * its price, its branch, its preparation days — is refused the moment a
 * buyer has committed, because those are what a buyer was shown.
 * Restocking is the opposite: it happens BECAUSE units were sold, and
 * it changes nothing anybody already agreed to. So it has its own
 * control, its own endpoint, and no confirmation step — putting units
 * on a shelf is not a decision anyone needs protecting from.
 *
 * AN ABSOLUTE NUMBER, NOT A DELTA. A supplier who counted forty units
 * means forty; `+15` depends on both sides agreeing about the previous
 * value, which they will not the moment a sale lands between the page
 * loading and the button being pressed.
 *
 * THE FLOOR IS THE SERVER'S TO ENFORCE and it is the only place that
 * can: it reads what is sold and what is held in open baskets under the
 * offer's own row lock. A refusal comes back naming the number — «لا
 * يمكن أن ينزل المخزون دون ٧» — and is shown as it arrived.
 */
export interface DirectStockFormProps {
  opportunityId: string;
  /** The stock as the page read it. The field opens on this figure. */
  targetQuantity: number;
  labels: {
    title: string;
    field: string;
    hint: string;
    save: string;
    saving: string;
    errorTitle: string;
    requestIdLabel: string;
    notANumber: string;
  };
}

export function DirectStockForm({
  opportunityId,
  targetQuantity,
  labels,
}: DirectStockFormProps) {
  const router = useRouter();
  // FROM THE ROOT, because `messageKey` is already a full path —
  // `errors.codes.CONFLICT`. The server's own English detail is never
  // printed: it is written for an operator, not for a supplier.
  const root = useTranslations();
  const [value, setValue] = useState(String(targetQuantity));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [invalid, setInvalid] = useState(false);

  async function save() {
    if (busy) return;

    const parsed = Number(value.trim());
    // WHOLE UNITS ONLY, and more than none. Everything else — the
    // floor, the platform's own bounds — is the server's answer, which
    // is the only one that can be true at the moment it is given.
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setInvalid(true);
      return;
    }

    setInvalid(false);
    setBusy(true);
    setFailure(null);
    try {
      await apiClient.post(`/companies/me/opportunities/${opportunityId}/stock`, {
        targetQuantity: parsed,
      });
      // The page re-reads: what is AVAILABLE after the change depends on
      // live baskets this screen cannot see.
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="direct-stock">{labels.field}</Label>
          <Input
            id="direct-stock"
            appearance="outlined"
            type="number"
            inputMode="numeric"
            className="w-32"
            value={value}
            invalid={invalid}
            describedById={invalid ? "direct-stock-error" : undefined}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>

        <Button type="button" onClick={() => void save()} disabled={busy} isLoading={busy}>
          {busy ? labels.saving : labels.save}
        </Button>
      </div>

      {invalid ? (
        <FieldError id="direct-stock-error">{labels.notANumber}</FieldError>
      ) : null}

      <p className="text-xs text-content-muted">{labels.hint}</p>

      {failure ? (
        <div
          role="alert"
          className="rounded-md border border-danger bg-danger-surface px-3 py-2 text-sm text-danger-text"
        >
          <p className="font-medium">{labels.errorTitle}</p>
          <p>{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="mt-1 text-xs">
              {labels.requestIdLabel} {failure.requestId}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
