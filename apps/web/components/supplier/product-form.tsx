"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { SalesUnitItem, TaxonomyNodeItem } from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { isApiError } from "@/lib/errors";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { buildTaxonomyOptions } from "@/lib/taxonomy-tree";
import { checkTarget, orderChecks } from "@/lib/product-checks";
import {
  EMPTY_PRODUCT_FORM,
  PRODUCT_FIELD_ORDER,
  firstErrorField,
  hasErrors,
  isDirty,
  toCreateRequest,
  toUpdateRequest,
  validateProductForm,
  type ProductFormErrors,
  type ProductFormValues,
} from "@/lib/product-form";
import type { AppLocale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { ErrorSummary, FormSection, useUnsavedChangesWarning } from "@/components/forms/form-shell";

/**
 * Creating and editing a product.
 *
 * One component for both, because the two differ in exactly three ways —
 * the initial values, the request builder, and where a success goes — and a
 * second copy would be the place a rule gets tightened on create and
 * forgotten on edit.
 *
 * A client component because the API's CSRF guard requires a browser
 * `Origin` header on state-changing requests and the session cookie rides
 * along with `credentials: "include"`, both supplied by `apiClient`.
 *
 * VALUES SURVIVE A FAILURE. Nothing is cleared on a rejected submit: the
 * state is the reader's typing, and a network error is the worst possible
 * moment to throw it away.
 *
 * There is no optimistic anything. Creating navigates to the id the SERVER
 * returned; editing refreshes and lets the server say what the product now
 * is. On an APPROVED product an edit re-runs the technical checks and may
 * be refused as a whole, which no client can predict.
 */
export type ProductFormMode = "create" | "edit";

export interface ProductFormProps {
  mode: ProductFormMode;
  locale: AppLocale;
  /** Present in edit mode; the id the PATCH goes to. */
  productId?: string;
  initialValues: ProductFormValues;
  taxonomy: readonly TaxonomyNodeItem[];
  salesUnits: readonly SalesUnitItem[];
  /** Where Cancel goes, and where a successful edit returns to. */
  backHref: string;
  labels: ProductFormLabels;
}

export interface ProductFormLabels {
  sections: { identity: string; classification: string; packaging: string; dimensions: string };
  fields: Record<keyof ProductFormValues, string>;
  placeholderTaxonomy: string;
  placeholderSalesUnit: string;
  required: string;
  optional: string;
  submitCreate: string;
  submitEdit: string;
  submitting: string;
  cancel: string;
  cancelPrompt: string;
  errorSummaryTitle: string;
  checkSummaryTitle: string;
  errorTitle: string;
  requestIdLabel: string;
  noChanges: string;
}

/** Stable DOM ids, so the error summary can anchor to a control. */
const fieldId = (field: keyof ProductFormValues) => `product-field-${field}`;
const errorId = (field: keyof ProductFormValues) => `${fieldId(field)}-error`;

export function ProductForm({
  mode,
  locale,
  productId,
  initialValues,
  taxonomy,
  salesUnits,
  backHref,
  labels,
}: ProductFormProps) {
  const router = useRouter();
  const root = useTranslations();
  const fieldErrors = useTranslations("supplier.products.validation");
  const checkMessages = useTranslations("supplier.products.checks");

  const [values, setValues] = useState<ProductFormValues>(initialValues);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [failedChecks, setFailedChecks] = useState<readonly string[]>([]);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);

  const dirty = isDirty(values, initialValues);
  // Only while there is something to lose, and never mid-submit — the
  // request is already on its way and the browser prompt would be asking
  // about work that is being saved.
  useUnsavedChangesWarning(dirty && !submitting);

  const taxonomyOptions = useMemo(() => buildTaxonomyOptions(taxonomy, locale), [taxonomy, locale]);

  function set(field: keyof ProductFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    // Clear this field's error as soon as it is touched: leaving a stale
    // message under a field someone is fixing reads as a rejection of
    // what they are typing now.
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  /**
   * Choosing a sales unit fills BOTH names from the reference list.
   *
   * They stay editable afterwards, because these are snapshot names: they
   * are copied onto every opportunity and order, and the reference row is
   * never read again. A supplier who sells by a unit the admin list calls
   * something slightly different is entitled to say so.
   *
   * Clearing the selection leaves the names alone — they are required, and
   * emptying them because a soft reference was removed would delete
   * something the supplier typed.
   */
  function chooseSalesUnit(id: string) {
    const unit = salesUnits.find((candidate) => candidate.id === id);

    setValues((current) => ({
      ...current,
      salesUnitId: id,
      ...(unit ? { salesUnitNameAr: unit.nameAr, salesUnitNameEn: unit.nameEn } : {}),
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next.salesUnitNameAr;
      delete next.salesUnitNameEn;
      return next;
    });
  }

  function focusTarget(id: string) {
    const element = document.getElementById(id);
    if (!element) return;

    // Focus is the part that matters — it is what a keyboard and a screen
    // reader follow. Scrolling is a courtesy for a sighted reader, and it
    // is guarded because `scrollIntoView` is absent in some environments;
    // losing the scroll must never cost the focus.
    element.focus();
    element.scrollIntoView?.({ block: "center" });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // Double-submit protection: a second press while the request is in
    // flight does nothing at all.
    if (submitting) return;

    const found = validateProductForm(values);
    setErrors(found);
    setFailedChecks([]);
    setFailure(null);

    if (hasErrors(found)) {
      const first = firstErrorField(found);
      if (first) focusTarget(fieldId(first));
      return;
    }

    setSubmitting(true);

    try {
      if (mode === "create") {
        // The server's id, never one guessed here.
        const created = await apiClient.post<{ id: string }>(
          "/companies/me/products",
          toCreateRequest(values)
        );
        router.replace(`/${locale}/supplier/products/${created.id}`);
        router.refresh();
        return;
      }

      const body = toUpdateRequest(values, initialValues);
      await apiClient.patch(`/companies/me/products/${productId}`, body);

      router.replace(backHref);
      router.refresh();
    } catch (error) {
      // The values are untouched — the reader keeps everything they typed.
      const checks = isApiError(error) ? error.failedChecks : null;

      if (checks && checks.length > 0) {
        const ordered = orderChecks(checks);
        setFailedChecks(ordered);
        const target = checkTarget(ordered[0]);
        focusTarget(target.kind === "field" ? fieldId(target.field) : "product-media-panel");
      } else {
        setFailure(toUserFacingError(error));
        formRef.current?.querySelector<HTMLElement>("[data-error-summary]")?.focus();
      }

      setSubmitting(false);
    }
  }

  function requestCancel() {
    if (!dirty) {
      router.push(backHref);
      return;
    }
    setConfirmingCancel(true);
  }

  const summaryEntries = PRODUCT_FIELD_ORDER.filter((field) => errors[field]).map((field) => ({
    targetId: fieldId(field),
    message: `${labels.fields[field]}: ${fieldErrors(errors[field]!.key, errors[field]!.values)}`,
  }));

  const checkEntries = failedChecks.map((code) => {
    const target = checkTarget(code as never);
    return {
      targetId: target.kind === "field" ? fieldId(target.field) : "product-media-panel",
      message: checkMessages(code),
    };
  });

  const textField = (
    field: keyof ProductFormValues,
    options: { required?: boolean; multiline?: boolean; inputMode?: "decimal" } = {}
  ) => {
    const issue = errors[field];

    return (
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor={fieldId(field)}
          required={options.required}
          requiredLabel={options.required ? labels.required : undefined}
        >
          {labels.fields[field]}
        </Label>
        {options.multiline ? (
          <Textarea
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
            // Decimals stay TEXT inputs: a number input silently accepts
            // `1e3` and, in several browsers, reports an empty string for
            // anything it considers malformed — so the value someone
            // typed would be gone before it could be validated.
            type="text"
            inputMode={options.inputMode}
            value={values[field]}
            onChange={(event) => set(field, event.target.value)}
            invalid={Boolean(issue)}
            describedById={issue ? errorId(field) : undefined}
           
          />
        )}
        <FieldError id={errorId(field)}>
          {issue ? fieldErrors(issue.key, issue.values) : null}
        </FieldError>
      </div>
    );
  };

  // A MAXIMUM WIDTH, because the portal frame has none. `<main>` in
  // `portal-chrome` is `flex-1` with padding and no cap, which is right
  // for a table and wrong for a form: without this, every field below
  // stretches the full width of whatever monitor it is opened on.
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      className="flex max-w-5xl flex-col gap-6"
    >
      <ErrorSummary title={labels.errorSummaryTitle} entries={summaryEntries} />
      <ErrorSummary title={labels.checkSummaryTitle} entries={checkEntries} />

      {failure ? (
        <div role="alert" className="flex flex-col gap-1 rounded-lg border border-danger p-4 text-sm">
          <p className="font-medium text-danger-text">{labels.errorTitle}</p>
          {/* The closed, translated message for a known code — never the
              API's own English text. */}
          <p className="text-content">{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="text-content-muted">
              {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The two names sit side by side because they are the same field
          in two languages, and reading one while typing the other is the
          whole job. The descriptions keep the full row — a paragraph in
          a half-width box is a box nobody can read back. */}
      <FormSection title={labels.sections.identity} columns={2}>
        {textField("nameAr", { required: true })}
        {textField("nameEn", { required: true })}
        {textField("supplierSku")}
        {textField("gtin")}
        <div className="sm:col-span-2">{textField("descriptionAr", { multiline: true })}</div>
        <div className="sm:col-span-2">{textField("descriptionEn", { multiline: true })}</div>
      </FormSection>

      {/* A category, a sales unit, and that unit named in two
          languages — four controls, none of them long. */}
      <FormSection title={labels.sections.classification} columns={2}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldId("taxonomyNodeId")} required requiredLabel={labels.required}>
            {labels.fields.taxonomyNodeId}
          </Label>
          <Select
            id={fieldId("taxonomyNodeId")}
            value={values.taxonomyNodeId}
            onChange={(event) => set("taxonomyNodeId", event.target.value)}
            invalid={Boolean(errors.taxonomyNodeId)}
            describedById={errors.taxonomyNodeId ? errorId("taxonomyNodeId") : undefined}
           
          >
            {/* An empty option, never a pre-selected first category: a
                default nobody chose is a category the product gets filed
                under by accident. */}
            <option value="">{labels.placeholderTaxonomy}</option>
            {taxonomyOptions.map((option) => (
              // EVERY active node is selectable — there is no leaf-only
              // rule, and a parent may legitimately hold products. The
              // full path is the label because indentation is invisible
              // to a screen reader.
              <option key={option.id} value={option.id}>
                {option.path}
              </option>
            ))}
          </Select>
          <FieldError id={errorId("taxonomyNodeId")}>
            {errors.taxonomyNodeId
              ? fieldErrors(errors.taxonomyNodeId.key, errors.taxonomyNodeId.values)
              : null}
          </FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fieldId("salesUnitId")}>{labels.fields.salesUnitId}</Label>
          <Select
            id={fieldId("salesUnitId")}
            value={values.salesUnitId}
            onChange={(event) => chooseSalesUnit(event.target.value)}
          >
            <option value="">{labels.placeholderSalesUnit}</option>
            {salesUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {locale === "ar-SA" ? unit.nameAr : unit.nameEn}
              </option>
            ))}
          </Select>
        </div>

        {textField("salesUnitNameAr", { required: true })}
        {textField("salesUnitNameEn", { required: true })}
      </FormSection>

      <FormSection title={labels.sections.packaging} columns={3}>
        {textField("packageContentQuantity", { inputMode: "decimal" })}
        {textField("packageContentUnitNameAr")}
        {textField("packageContentUnitNameEn")}
      </FormSection>

      {/* FOUR NUMBERS. A weight and three dimensions, each of which is
          three or four characters — the clearest case on the platform of
          a short field given a whole row. */}
      <FormSection title={labels.sections.dimensions} columns={4}>
        {textField("weightPerUnit", { required: true, inputMode: "decimal" })}
        {textField("lengthCm", { required: true, inputMode: "decimal" })}
        {textField("widthCm", { required: true, inputMode: "decimal" })}
        {textField("heightCm", { required: true, inputMode: "decimal" })}
      </FormSection>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
           
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
           
            disabled={submitting}
            onClick={requestCancel}
          >
            {labels.cancel}
          </Button>
        </div>

        {mode === "edit" && !dirty ? (
          <p className="text-sm text-content-muted">{labels.noChanges}</p>
        ) : null}

        {confirmingCancel ? (
          // The one navigation this form can see and ask about. Browser
          // navigations are covered by `beforeunload`; in-app links are
          // not intercepted, because doing so means monkeypatching the
          // router.
          <div className="flex flex-col gap-2 rounded-md border border-line p-3">
            <p role="status" aria-live="polite" className="text-sm text-content">
              {labels.cancelPrompt}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
               
                onClick={() => router.push(backHref)}
              >
                {labels.cancel}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
               
                onClick={() => setConfirmingCancel(false)}
              >
                {root("common.close")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </form>
  );
}

export { EMPTY_PRODUCT_FORM };
