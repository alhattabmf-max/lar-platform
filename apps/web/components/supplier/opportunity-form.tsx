"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type {
  OpportunityLimits,
  ProductSummary,
  SupplierOpportunityReasonCode,
} from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import type { SupplierLocation } from "@/lib/supplier-data";
import {
  OPPORTUNITY_FIELD_ORDER,
  firstOpportunityErrorField,
  hasOpportunityErrors,
  isOpportunityDirty,
  reasonField,
  toCreateOpportunityBody,
  toUpdateOpportunityBody,
  validateOpportunityForm,
  type OpportunityFormErrors,
  type OpportunityFormValues,
} from "@/lib/opportunity-form";
import { localized } from "@/lib/localized";
import type { AppLocale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { ErrorSummary, FormSection, useUnsavedChangesWarning } from "@/components/forms/form-shell";

/**
 * Creating and editing an opportunity.
 *
 * One component for both, as with the product form: the two differ only in
 * initial values, request builder and where success goes.
 *
 * PRICE IS THE ONLY MONEY HERE, and nothing is derived from it. The tax
 * split, the total value and the share size are computed and FROZEN
 * server-side at publish; showing a client-side estimate of any of them
 * would produce a second figure that eventually disagrees with what traders
 * were charged.
 *
 * THE DURATION AND QUANTITY BOUNDS ARE STATED, and warned about before a
 * submit. They are admin-configured in `OpportunitySettingsService` and
 * reach this form through `GET /companies/me/policy-limits`. When that
 * read fails the form says the bounds exist without naming figures — a
 * number invented here would be worse than no number, because it would
 * refuse a listing the server would have accepted.
 *
 * The warnings never block. The server re-checks every bound against the
 * live policy at the moment of the request, and this component's copy
 * may be a minute old.
 */
export interface OpportunityFormProps {
  mode: "create" | "edit";
  locale: AppLocale;
  opportunityId?: string;
  initialValues: OpportunityFormValues;
  /** APPROVED, unarchived products only — nothing else can be published on. */
  products: readonly ProductSummary[];
  locations: readonly SupplierLocation[];
  backHref: string;
  /** Present in edit mode when the listing is blocked; drives the inline fix. */
  reasonCode?: SupplierOpportunityReasonCode | null;
  /**
   * The admin-configured listing limits, when they could be read.
   *
   * OPTIONAL on purpose. `GET /companies/me/policy-limits` can fail, and
   * a failed read degrades to the figure-free hint that was here before
   * — never to invented defaults, which would state a bound this app
   * made up and reject a listing the server would have accepted.
   *
   * THE SERVER REMAINS THE AUTHORITY. These figures let the form warn
   * before a submit; they do not let it decide. Every bound is
   * re-checked server side, and a listing that passed these warnings can
   * still be refused.
   */
  limits?: OpportunityLimits;
  labels: OpportunityFormLabels;
}

export interface OpportunityFormLabels {
  sections: { what: string; terms: string; window: string; description: string };
  sectionHints: { what: string; terms: string; window: string; description: string };
  fields: Record<keyof OpportunityFormValues, string>;
  hints: {
    /** Shown when the limits could not be read — no figures. */
    boundsUnknown: string;
    /** Already interpolated by the caller, with the real figures. */
    bounds: string;
    frozenAtPublish: string;
  };
  /** Pre-submit warnings, already interpolated. Shown, never blocking. */
  warnings: {
    quantityTooLow: string;
    quantityTooHigh: string;
    durationTooShort: string;
    durationTooLong: string;
  };
  placeholderProduct: string;
  placeholderLocation: string;
  noProducts: string;
  required: string;
  submitCreate: string;
  submitEdit: string;
  submitting: string;
  cancel: string;
  cancelPrompt: string;
  close: string;
  errorSummaryTitle: string;
  errorTitle: string;
  requestIdLabel: string;
  noChanges: string;
  /** ICU with {reason} — the translated blocking reason. */
  fixHere: string;
}

const fieldId = (field: keyof OpportunityFormValues) => `opportunity-field-${field}`;
const errorId = (field: keyof OpportunityFormValues) => `${fieldId(field)}-error`;

export function OpportunityForm({
  mode,
  locale,
  opportunityId,
  initialValues,
  products,
  locations,
  backHref,
  reasonCode,
  limits,
  labels,
}: OpportunityFormProps) {
  const router = useRouter();
  const root = useTranslations();
  const fieldErrors = useTranslations("supplier.opportunities.validation");
  const reasons = useTranslations("supplier.status.opportunityReason");

  const [values, setValues] = useState<OpportunityFormValues>(initialValues);
  const [errors, setErrors] = useState<OpportunityFormErrors>({});
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const dirty = isOpportunityDirty(values, initialValues);
  useUnsavedChangesWarning(dirty && !submitting);

  /**
   * What the admin-configured policy would refuse, checked as the reader
   * types.
   *
   * WARNINGS, NOT VALIDATION. Nothing here blocks a submit. The server
   * re-checks every bound against the live policy at the moment of the
   * request, and this component's copy may be a minute old — a form that
   * refused a value the server would accept is a worse failure than one
   * that warns and lets the server answer.
   *
   * Silent when the policy could not be read: with no limits there is
   * nothing to compare against, and warning on a guess would be
   * inventing a bound.
   */
  const warnings = limits
    ? [
        ...quantityWarnings(values.targetQuantity, limits, labels.warnings),
        ...durationWarnings(values.startAt, values.endAt, limits, labels.warnings),
      ]
    : [];

  // The field a blocking reason points at, when there is one. Four of the
  // ten reasons are fixed elsewhere entirely and resolve to null.
  const blockedField = reasonCode ? reasonField(reasonCode) : null;

  function set(field: keyof OpportunityFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function focusField(field: keyof OpportunityFormValues) {
    const element = document.getElementById(fieldId(field));
    if (!element) return;
    element.focus();
    element.scrollIntoView?.({ block: "center" });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const found = validateOpportunityForm(values);
    setErrors(found);
    setFailure(null);

    if (hasOpportunityErrors(found)) {
      const first = firstOpportunityErrorField(found);
      if (first) focusField(first);
      return;
    }

    setSubmitting(true);

    try {
      if (mode === "create") {
        const created = await apiClient.post<{ id: string }>(
          "/companies/me/opportunities",
          toCreateOpportunityBody(values)
        );
        router.replace(`/${locale}/supplier/opportunities/${created.id}`);
        router.refresh();
        return;
      }

      await apiClient.patch(
        `/companies/me/opportunities/${opportunityId}`,
        toUpdateOpportunityBody(values, initialValues)
      );
      router.replace(backHref);
      router.refresh();
    } catch (error) {
      // Values are untouched — the reader keeps everything they typed.
      setFailure(toUserFacingError(error));
      setSubmitting(false);
    }
  }

  const summaryEntries = OPPORTUNITY_FIELD_ORDER.filter((field) => errors[field]).map((field) => ({
    targetId: fieldId(field),
    message: `${labels.fields[field]}: ${fieldErrors(errors[field]!.key, errors[field]!.values)}`,
  }));

  /** A field, with the blocking-reason note attached when it is the one to fix. */
  const wrap = (field: keyof OpportunityFormValues, control: React.ReactNode) => {
    const issue = errors[field];
    const blocked = blockedField === field;

    return (
      <div className="flex flex-col gap-1.5">
        {control}
        {blocked ? (
          // The concrete fix, on the field that fixes it — rather than a
          // banner at the top saying something is wrong somewhere.
          <p className="rounded-md border border-warning bg-warning-surface px-3 py-2 text-xs text-warning-text">
            {labels.fixHere.replace("{reason}", reasons(reasonCode!))}
          </p>
        ) : null}
        <FieldError id={errorId(field)}>
          {issue ? fieldErrors(issue.key, issue.values) : null}
        </FieldError>
      </div>
    );
  };

  const textField = (
    field: keyof OpportunityFormValues,
    options: { required?: boolean; multiline?: boolean; inputMode?: "decimal" | "numeric"; type?: string } = {}
  ) => {
    const issue = errors[field];

    return wrap(
      field,
      <>
        <Label
          htmlFor={fieldId(field)}
          required={options.required}
          requiredLabel={options.required ? labels.required : undefined}
        >
          {labels.fields[field]}
        </Label>
        {options.multiline ? (
          <textarea
            id={fieldId(field)}
            value={values[field]}
            onChange={(event) => set(field, event.target.value)}
            aria-invalid={issue ? true : undefined}
            aria-describedby={issue ? errorId(field) : undefined}
            rows={4}
            className={`block w-full rounded-md border bg-surface px-3 py-2 text-sm text-content ${
              issue ? "border-danger" : "border-line-strong"
            }`}
          />
        ) : (
          <Input
            id={fieldId(field)}
            // Amounts and counts stay TEXT inputs: a number input accepts
            // `1e3` and, in several browsers, reports an empty string for
            // anything it dislikes — the typed value would be gone before
            // validation saw it. Dates use the real control.
            type={options.type ?? "text"}
            inputMode={options.inputMode}
            value={values[field]}
            onChange={(event) => set(field, event.target.value)}
            invalid={Boolean(issue)}
            describedById={issue ? errorId(field) : undefined}
            className="min-h-11"
          />
        )}
      </>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <ErrorSummary title={labels.errorSummaryTitle} entries={summaryEntries} />

      {failure ? (
        <div role="alert" className="flex flex-col gap-1 rounded-lg border border-danger p-4 text-sm">
          <p className="font-medium text-danger-text">{labels.errorTitle}</p>
          {/* The closed, translated message for a known code. A refused
              publish or edit returns operator-facing English. */}
          <p className="text-content">{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="text-content-muted">
              {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <FormSection title={labels.sections.what} description={labels.sectionHints.what}>
        {wrap(
          "productId",
          <>
            <Label htmlFor={fieldId("productId")} required requiredLabel={labels.required}>
              {labels.fields.productId}
            </Label>
            <Select
              id={fieldId("productId")}
              value={values.productId}
              onChange={(event) => set("productId", event.target.value)}
              invalid={Boolean(errors.productId)}
              describedById={errors.productId ? errorId("productId") : undefined}
              className="min-h-11"
              disabled={products.length === 0}
            >
              {/* No pre-selected first product: a default nobody chose is a
                  listing built on the wrong item. */}
              <option value="">{labels.placeholderProduct}</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {localized(locale, product.nameAr, product.nameEn)}
                </option>
              ))}
            </Select>
            {products.length === 0 ? (
              // Publishing requires an APPROVED product; there is nothing
              // to choose from, and the form says why rather than showing
              // an empty picker.
              <p className="text-xs text-content-muted">{labels.noProducts}</p>
            ) : null}
          </>
        )}

        {wrap(
          "fulfillmentLocationId",
          <>
            <Label
              htmlFor={fieldId("fulfillmentLocationId")}
              required
              requiredLabel={labels.required}
            >
              {labels.fields.fulfillmentLocationId}
            </Label>
            <Select
              id={fieldId("fulfillmentLocationId")}
              value={values.fulfillmentLocationId}
              onChange={(event) => set("fulfillmentLocationId", event.target.value)}
              invalid={Boolean(errors.fulfillmentLocationId)}
              describedById={
                errors.fulfillmentLocationId ? errorId("fulfillmentLocationId") : undefined
              }
              className="min-h-11"
            >
              <option value="">{labels.placeholderLocation}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </>
        )}
      </FormSection>

      <FormSection title={labels.sections.terms} description={labels.sectionHints.terms}>
        {textField("unitPriceAmount", { required: true, inputMode: "decimal" })}
        {textField("targetQuantity", { required: true, inputMode: "numeric" })}

        {/* PRE-SUBMIT WARNINGS, not validation.
            They appear as the reader types, and they never disable the
            submit button: the server re-checks every bound against the
            live policy, and a form that refused a value the server would
            accept is worse than one that warns and lets it through.
            Announced politely so a screen reader hears the warning
            appear rather than discovering it after a failed submit. */}
        {warnings.length > 0 ? (
          <ul
            role="status"
            aria-live="polite"
            className="flex list-none flex-col gap-1 rounded-md border border-warning bg-warning-surface p-3"
          >
            {warnings.map((warning) => (
              <li key={warning} className="text-xs text-warning-text">
                {warning}
              </li>
            ))}
          </ul>
        ) : null}

        {/* Said once: the tax split and the share size are the server's,
            frozen at publish. Nothing on this form estimates them. */}
        <p className="text-xs text-content-muted">{labels.hints.frozenAtPublish}</p>
      </FormSection>

      <FormSection title={labels.sections.window} description={labels.sectionHints.window}>
        {textField("startAt", { required: true, type: "datetime-local" })}
        {textField("endAt", { required: true, type: "datetime-local" })}
        {textField("expectedPreparationDays", { required: true, inputMode: "numeric" })}
        {/* The real figures when the policy could be read; the
            figure-free hint when it could not. A number invented here
            would be worse than no number at all. */}
        <p className="text-xs text-content-muted">
          {limits ? labels.hints.bounds : labels.hints.boundsUnknown}
        </p>
      </FormSection>

      <FormSection title={labels.sections.description} description={labels.sectionHints.description}>
        {textField("descriptionAr", { multiline: true })}
        {textField("descriptionEn", { multiline: true })}
      </FormSection>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            className="min-h-11"
            isLoading={submitting}
            disabled={submitting || (mode === "edit" && !dirty)}
          >
            {submitting
              ? labels.submitting
              : mode === "create"
                ? labels.submitCreate
                : labels.submitEdit}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            disabled={submitting}
            onClick={() => (dirty ? setConfirmingCancel(true) : router.push(backHref))}
          >
            {labels.cancel}
          </Button>
        </div>

        {mode === "edit" && !dirty ? (
          <p className="text-sm text-content-muted">{labels.noChanges}</p>
        ) : null}

        {confirmingCancel ? (
          <div className="flex flex-col gap-2 rounded-md border border-line p-3">
            <p role="status" aria-live="polite" className="text-sm text-content">
              {labels.cancelPrompt}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="min-h-11"
                onClick={() => router.push(backHref)}
              >
                {labels.cancel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => setConfirmingCancel(false)}
              >
                {labels.close}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Whether the typed quantity sits inside the configured range.
 *
 * A blank or non-numeric field produces no warning: that is what the
 * form's own required-field validation is for, and stacking a bounds
 * warning on top of "this field is required" tells the reader nothing
 * they do not already know.
 */
function quantityWarnings(
  raw: string,
  limits: OpportunityLimits,
  labels: OpportunityFormLabels["warnings"]
): string[] {
  const quantity = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(quantity)) return [];

  if (quantity < limits.minTargetQuantity) return [labels.quantityTooLow];
  if (quantity > limits.maxTargetQuantity) return [labels.quantityTooHigh];
  return [];
}

/**
 * Whether the listing window sits inside the configured duration range.
 *
 * Both bounds are compared in HOURS, because the policy states a minimum
 * in hours and a maximum in days: converting the maximum to hours once
 * is one conversion, whereas comparing each in its own unit would be two
 * places for a unit mistake to hide.
 *
 * An incomplete or reversed window produces no warning — an end before a
 * start is a different error, and the form reports that one itself.
 */
function durationWarnings(
  startAt: string,
  endAt: string,
  limits: OpportunityLimits,
  labels: OpportunityFormLabels["warnings"]
): string[] {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const hours = (end - start) / 3_600_000;

  if (hours < limits.minDurationHours) return [labels.durationTooShort];
  if (hours > limits.maxDurationDays * 24) return [labels.durationTooLong];
  return [];
}
