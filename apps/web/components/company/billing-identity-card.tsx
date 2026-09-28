"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BadgePercent, FileText, ReceiptText } from "lucide-react";
import { IconInvoice, IconVat } from "./field-icons";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * Who a supplier's commission documents are addressed to, and whether
 * it charges VAT.
 *
 * ONE CARD, TWO STATES, ONE COMPONENT. Filled in before the supplier
 * asks to be approved, and read back afterwards on the same card — so
 * there is one place the answer lives and one control that changes it.
 * Two cards that had to agree about the same two fields would drift the
 * first time either was touched.
 *
 * IT IS ASKED FOR BEFORE APPROVAL, and that is the point. These are
 * part of the record an administrator reviews; requiring approval first
 * made the review incomplete and made the supplier wait for an approval
 * that was waiting for them. The API's guard was split for exactly
 * this, as it was for the bank account before it.
 *
 * THE VAT NUMBER IS CHECKED AGAINST THE RULE THE SERVER ENFORCES —
 * fifteen digits — and the check is stated here so the reason appears
 * beside the field rather than arriving as a refusal after a save. The
 * server still refuses independently; this does not replace it.
 *
 * THE COMMERCIAL REGISTRATION IS NOT HERE. It is verified, it is the
 * company's identity, and it is shown read-only on the details card
 * above. A second place to type it would be a second answer to a
 * question that already has one.
 *
 * TWO WRITES, ONE BUTTON. The billing name and the VAT answer are two
 * endpoints — they were built as two profiles and the wire is not
 * being reshaped for a screen — but they are one decision to the person
 * making it, so one press saves both. The name goes first: if the VAT
 * write then fails, the supplier is told, and re-pressing sends both
 * again with the same values.
 */

/**
 * THE TINTS ARE MIXED, NOT DIMMED.
 *
 * `bg-secondary/10` and its neighbours look right and paint nothing:
 * the utility resolves to `var(--color-secondary)`, a plain hex with no
 * `<alpha-value>` placeholder, so Tailwind cannot build a colour from
 * the `/10` modifier and drops the declaration. The discs came out
 * transparent — the same failure that made a whole navigation bar
 * illegible. `color-mix` takes the tenant's own identity colour and
 * mixes it into the card's surface, so the tint follows a re-themed
 * brand exactly as an opacity would have.
 */

/** The rule the server enforces, restated where the field is typed. */
const SAUDI_VAT_NUMBER_PATTERN = /^\d{15}$/;

export interface BillingIdentityLabels {
  title: string;
  /** Shown while nothing has been entered yet. */
  requiredPill: string;
  /** Shown once both answers are there. */
  completePill: string;
  invoicingName: string;
  invoicingNameHint: string;
  vatQuestion: string;
  vatYes: string;
  vatNo: string;
  vatNumber: string;
  vatNumberHint: string;
  vatNumberInvalid: string;
  /** The one control that opens the fields again. */
  edit: string;
  save: string;
  saveChanges: string;
  cancel: string;
  working: string;
  required: string;
  errorTitle: string;
  requestIdLabel: string;
  /** Read mode, when the company says it is not registered. */
  notRegistered: string;
}

export interface BillingIdentityValue {
  invoicingLegalName: string | null;
  isVatRegistered: boolean | null;
  vatNumber: string | null;
}

export function BillingIdentityCard({
  current,
  labels,
  /**
   * Whether the card opens as a form.
   *
   * TRUE ON THE COMPLETION SCREEN while nothing has been entered: a
   * supplier assembling their record should not have to press "edit" to
   * reach a field that has never been filled. FALSE once there is an
   * answer to read, on both screens.
   */
  startOpen = false,
  /** Read-only while a verification request is under review. */
  locked = false,
}: {
  current: BillingIdentityValue;
  labels: BillingIdentityLabels;
  startOpen?: boolean;
  locked?: boolean;
}) {
  const router = useRouter();
  const root = useTranslations();

  const answered =
    (current.invoicingLegalName ?? "").trim() !== "" &&
    current.isVatRegistered !== null &&
    (!current.isVatRegistered || (current.vatNumber ?? "").trim() !== "");

  const [editing, setEditing] = useState(!answered && startOpen);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [form, setForm] = useState({
    invoicingLegalName: current.invoicingLegalName ?? "",
    isVatRegistered: current.isVatRegistered ?? false,
    vatNumber: current.vatNumber ?? "",
  });

  const vatNumberBad =
    form.isVatRegistered &&
    form.vatNumber.trim() !== "" &&
    !SAUDI_VAT_NUMBER_PATTERN.test(form.vatNumber.trim());

  const ready =
    !submitting &&
    form.invoicingLegalName.trim() !== "" &&
    (!form.isVatRegistered ||
      SAUDI_VAT_NUMBER_PATTERN.test(form.vatNumber.trim()));

  function reset() {
    setForm({
      invoicingLegalName: current.invoicingLegalName ?? "",
      isVatRegistered: current.isVatRegistered ?? false,
      vatNumber: current.vatNumber ?? "",
    });
    setFailure(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guarded rather than merely disabled: a disabled button is an
    // affordance, and Enter can still submit a form.
    if (!ready) return;

    setSubmitting(true);
    setFailure(null);
    try {
      await apiClient.put("/companies/me/invoicing-profile", {
        invoicingLegalName: form.invoicingLegalName.trim(),
      });
      await apiClient.put("/companies/me/tax-profile", {
        isVatRegistered: form.isVatRegistered,
        // SENT ONLY WHEN REGISTERED. The server refuses a number
        // alongside «not registered», which is the right refusal — a
        // company that says it does not charge VAT has no number to
        // record, and keeping a stale one would put it on a document.
        ...(form.isVatRegistered ? { vatNumber: form.vatNumber.trim() } : {}),
      });
      setEditing(false);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      data-testid="billing-identity-card"
      className="flex flex-col gap-4 rounded-card bg-surface shadow-card px-card-x py-card-y"
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* THE CARD'S OWN MARK. A tinted disc rather than a bare glyph:
            at a glance the four cards on this screen are told apart by
            their icons, and a glyph on the page's own background reads
            as decoration beside a heading rather than as its emblem. */}
        <span
          aria-hidden="true"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-card bg-[color-mix(in_srgb,var(--color-secondary)_12%,var(--color-surface))] text-secondary"
        >
          <ReceiptText className="size-5" />
        </span>

        <h3 className="flex-1 text-base font-semibold text-content">
          {labels.title}
        </h3>

        <StatusBadge
          label={answered ? labels.completePill : labels.requiredPill}
          tone={answered ? "done" : "attention"}
        />
      </div>

      {editing ? (
        <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
          {/* The hint sits under the field rather than as a `Field`
              prop: `Field` composes a label, a control and an error,
              and giving it a fourth slot for one screen would change a
              component every form on the platform uses. */}
          <div className="flex flex-col gap-1">
            <Field
              label={labels.invoicingName}
              icon={IconInvoice}
              required
              requiredLabel={labels.required}
            >
              {({ inputId }) => (
                <Input
                  id={inputId}
                  value={form.invoicingLegalName}
                  maxLength={200}
                  onChange={(event) =>
                    setForm((f) => ({
                      ...f,
                      invoicingLegalName: event.target.value,
                    }))
                  }
                  data-testid="billing-name"
                />
              )}
            </Field>
            <p className="text-xs text-content-muted">
              {labels.invoicingNameHint}
            </p>
          </div>

          {/* THE QUESTION, AS A QUESTION. Two radios rather than a
              checkbox: «not registered» is an answer a supplier gives,
              not the absence of one, and a cleared checkbox cannot tell
              those two apart. */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-content">
              {labels.vatQuestion}
            </legend>
            <div className="flex flex-wrap gap-3">
              {[
                { value: true, label: labels.vatYes, testId: "vat-yes" },
                { value: false, label: labels.vatNo, testId: "vat-no" },
              ].map((option) => (
                <label
                  key={option.testId}
                  className={
                    "inline-flex min-h-nav cursor-pointer items-center gap-2 rounded-control border px-3 text-sm " +
                    (form.isVatRegistered === option.value
                      ? "border-secondary bg-[color-mix(in_srgb,var(--color-secondary)_7%,var(--color-surface))] text-content"
                      : "border-line text-content-muted hover:border-secondary")
                  }
                >
                  <input
                    type="radio"
                    name="isVatRegistered"
                    checked={form.isVatRegistered === option.value}
                    onChange={() =>
                      setForm((f) => ({ ...f, isVatRegistered: option.value }))
                    }
                    data-testid={option.testId}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          {/* ONLY WHEN REGISTERED. A number field beside «no» is a
              question with no answer, and the server refuses a value
              sent with it. */}
          {form.isVatRegistered ? (
            <div className="flex flex-col gap-1">
              <Field
                label={labels.vatNumber}
                icon={IconVat}
                required
                requiredLabel={labels.required}
                error={vatNumberBad ? labels.vatNumberInvalid : undefined}
              >
                {({ inputId, errorId, invalid }) => (
                  <Input
                    id={inputId}
                    dir="ltr"
                    inputMode="numeric"
                    value={form.vatNumber}
                    maxLength={15}
                    aria-invalid={invalid || undefined}
                    aria-describedby={vatNumberBad ? errorId : undefined}
                    onChange={(event) =>
                      setForm((f) => ({ ...f, vatNumber: event.target.value }))
                    }
                    data-testid="vat-number"
                  />
                )}
              </Field>
              <p className="text-xs text-content-muted">
                {labels.vatNumberHint}
              </p>
            </div>
          ) : null}

          {failure ? (
            <div role="alert" className="flex flex-col gap-1">
              <p className="text-sm font-medium text-danger">
                {labels.errorTitle}
              </p>
              <p className="text-sm text-content-muted">
                {root(failure.messageKey)}
              </p>
              {failure.requestId ? (
                <p className="text-xs text-content-muted">
                  {labels.requestIdLabel}:{" "}
                  <span className="font-mono">{failure.requestId}</span>
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              isLoading={submitting}
              disabled={!ready}
              data-testid="billing-save"
            >
              {submitting
                ? labels.working
                : answered
                  ? labels.saveChanges
                  : labels.save}
            </Button>

            {/* NO WAY OUT WHILE NOTHING HAS BEEN ANSWERED. Cancelling
                back to an empty card would leave the supplier looking
                at a requirement with no control to meet it. */}
            {answered ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={submitting}
                onClick={() => {
                  reset();
                  setEditing(false);
                }}
                data-testid="billing-cancel"
              >
                {labels.cancel}
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-[color-mix(in_srgb,var(--color-primary)_8%,var(--color-surface))] text-primary"
              >
                <FileText className="size-4" />
              </span>
              <div className="flex min-w-0 flex-col">
                <dt className="text-xs text-content-muted">
                  {labels.invoicingName}
                </dt>
                <dd className="truncate text-sm font-medium text-content">
                  {current.invoicingLegalName ?? "—"}
                </dd>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-[color-mix(in_srgb,var(--color-accent)_18%,var(--color-surface))] text-accent-interactive"
              >
                <BadgePercent className="size-4" />
              </span>
              <div className="flex min-w-0 flex-col">
                <dt className="text-xs text-content-muted">
                  {labels.vatNumber}
                </dt>
                {/* «NOT REGISTERED» IS AN ANSWER, and it reads as one
                    rather than as an empty field. */}
                <dd className="truncate text-sm font-medium text-content" dir="ltr">
                  {current.isVatRegistered
                    ? (current.vatNumber ?? "—")
                    : labels.notRegistered}
                </dd>
              </div>
            </div>
          </dl>

          {/* ONE CONTROL, and it is absent while the record is under
              review — the platform closes the whole record to edits
              then, and a button that only produces a refusal is worse
              than no button. */}
          {locked ? null : (
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  reset();
                  setEditing(true);
                }}
                data-testid="billing-edit"
              >
                {labels.edit}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
