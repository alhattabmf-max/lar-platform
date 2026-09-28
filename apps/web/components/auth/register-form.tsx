"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PASSWORD_MIN_LENGTH } from "@platform/types";
import { apiClient } from "@/lib/api-client";
import {
  isRegistrationConflict,
  toUserFacingError,
  type UserFacingError,
} from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  AccountTypeChoice,
  type AccountTypeLabels,
  type AccountTypeValue,
} from "./account-type-choice";
import {
  PoliciesDialog,
  type PoliciesDialogLabels,
  type PolicyDocument,
} from "./policies-dialog";

export interface RegisterFormProps {
  locale: string;

  /**
   * The published versions, already resolved for the active locale.
   *
   * Both documents, in the order the API returned them. The form does
   * not fetch them: a Server Component reads `/policies/active` and
   * hands them down, so what is agreed to is what the server published.
   */
  policies: PolicyDocument[];
  labels: {
    accountType: AccountTypeLabels;
    policiesDialog: PoliciesDialogLabels;
  };
}

/**
 * Company registration.
 *
 * No one-time code: the account is created with a CR number, an email
 * and a password, and the user signs in with the CR number afterwards.
 *
 * NOTHING ABOUT A LOCATION IS COLLECTED HERE. The company's first
 * branch — its name, city, national address, contact and map link — is
 * asked for after the account exists, from "complete your profile". No
 * branch is invented in the meantime: an account simply has none until
 * somebody enters one.
 *
 * Submission is blocked until the kind of account has been CHOSEN and
 * the consent box is TICKED. Neither has a default and neither can be
 * satisfied by arriving from a particular link.
 */
export function RegisterForm({ locale, policies, labels }: RegisterFormProps) {
  const t = useTranslations("register");
  const common = useTranslations("common");
  const root = useTranslations();

  const router = useRouter();
  const errorId = useId();

  const [form, setForm] = useState({
    crNumber: "",
    legalName: "",
    email: "",
    password: "",
    primaryMobile1: "",
  });
  /** NULL UNTIL CHOSEN. There is no default kind of account. */
  const [accountType, setAccountType] = useState<AccountTypeValue | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [policiesOpen, setPoliciesOpen] = useState(false);
  const policiesButton = useRef<HTMLButtonElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [conflict, setConflict] = useState(false);

  /**
   * WHAT IS WRONG WITH A FIELD, SAID BESIDE THAT FIELD.
   *
   * Only after somebody has typed something: marking an untouched form
   * red is scolding a person for not having started yet. The rules are
   * the SERVER'S — `PASSWORD_MIN_LENGTH` is the shared constant the
   * API's own DTO is asserted against — so the form cannot promise to
   * accept something the API will refuse.
   */
  const fieldErrors = {
    email:
      form.email.trim() !== "" && !form.email.includes("@")
        ? t("validation.email")
        : undefined,
    password:
      form.password !== "" && form.password.length < PASSWORD_MIN_LENGTH
        ? t("validation.passwordTooShort", { min: PASSWORD_MIN_LENGTH })
        : undefined,
  };

  const canSubmit =
    !submitting &&
    // THE KIND IS REQUIRED. It decides the endpoint, the stored
    // `accountType`, the permissions and the portal.
    accountType !== null &&
    // OPENING THE DIALOG IS NOT AGREEING. Only this box is.
    accepted &&
    policies.length > 0 &&
    form.crNumber.trim() !== "" &&
    form.legalName.trim() !== "" &&
    form.email.trim() !== "" &&
    form.password !== "" &&
    // A form that submits what the server will refuse teaches people
    // to distrust the button.
    fieldErrors.email === undefined &&
    fieldErrors.password === undefined &&
    form.primaryMobile1.trim() !== "";

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function closePolicies() {
    setPoliciesOpen(false);
    // Focus returns to the button that opened it — a keyboard user
    // dropped at the top of the document has lost their place.
    policiesButton.current?.focus();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guarded rather than merely disabled: a disabled button is a UI
    // affordance, not a constraint, and Enter can still submit a form.
    if (!canSubmit || accountType === null) return;

    setSubmitting(true);
    setFailure(null);
    setConflict(false);

    const path =
      accountType === "TRADER"
        ? "/auth/register/trader"
        : "/auth/register/supplier";

    try {
      await apiClient.post(path, {
        crNumber: form.crNumber.trim(),
        legalName: form.legalName.trim(),
        email: form.email.trim(),
        password: form.password,
        primaryMobile1: form.primaryMobile1.trim(),
        // EVERY VERSION, SEPARATELY. One checkbox covers both documents
        // on screen, but each is its own agreement and each is recorded
        // against its own version id — which is what the acceptance
        // table stores and what an audit would be read from.
        acceptedPolicyVersionIds: policies.map((policy) => policy.id),
      });

      router.replace(`/${locale}/login`);
      router.refresh();
    } catch (error) {
      // The API answers every identity conflict identically, on
      // purpose — it does not say whether the CR number or the email is
      // taken, because that would let anyone enumerate the platform's
      // members. The UI must not speculate either; it offers the two
      // routes a legitimate returning user needs.
      setConflict(isRegistrationConflict(error));
      setFailure(toUserFacingError(error));
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <AccountTypeChoice
          value={accountType}
          onChange={setAccountType}
          disabled={submitting}
          labels={labels.accountType}
        />

        <Field
          label={t("crNumber")}
          required
          requiredLabel={common("required")}
        >
          {({ inputId }) => (
            <Input
              id={inputId}
              inputMode="numeric"
              autoComplete="off"
              required
              value={form.crNumber}
              onChange={(e) => set("crNumber", e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t("legalName")}
          required
          requiredLabel={common("required")}
        >
          {({ inputId }) => (
            <Input
              id={inputId}
              required
              value={form.legalName}
              onChange={(e) => set("legalName", e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t("email")}
          required
          requiredLabel={common("required")}
          error={fieldErrors.email}
        >
          {({ inputId, errorId, invalid }) => (
            <Input
              id={inputId}
              type="email"
              autoComplete="email"
              required
              invalid={invalid}
              describedById={invalid ? errorId : undefined}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t("password")}
          required
          requiredLabel={common("required")}
          error={fieldErrors.password}
        >
          {({ inputId, errorId, invalid }) => (
            <Input
              id={inputId}
              type="password"
              autoComplete="new-password"
              // The SHARED constant, not a number typed twice: a contract
              // test asserts the API's DTO uses the same one.
              minLength={PASSWORD_MIN_LENGTH}
              required
              invalid={invalid}
              describedById={invalid ? errorId : undefined}
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
            />
          )}
        </Field>

        {/* ONE NUMBER, AND IT IS REQUIRED. A second mobile and a named
          contact person used to stand between a company and an account.
          They are a DETAIL of the company's record and are collected —
          optionally, and only as a pair — from «بيانات المنشأة» inside
          the portal. */}
        <Field label={t("mobile1")} required requiredLabel={common("required")}>
          {({ inputId }) => (
            <Input
              id={inputId}
              inputMode="tel"
              required
              value={form.primaryMobile1}
              onChange={(e) => set("primaryMobile1", e.target.value)}
            />
          )}
        </Field>

        {/* NO CITY, NO ADDRESS, NO MAP. Registration opens an account;
          the branch is added afterwards from "complete your profile",
          against the endpoint that already exists for it. */}

        {/* ONE BUTTON, ONE CHECKBOX.

          The button opens both documents in a dialog over this form —
          it navigates nowhere, so nothing typed above is lost. Opening
          it is NOT agreeing: the checkbox below is the only thing that
          records consent, and the submit button stays unpressable until
          it is ticked. */}
        <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-medium text-content">
            {t("policies.legend")}
          </legend>

          {policies.length === 0 ? (
            <p
              className="text-sm text-warning-text"
              data-testid="policies-unavailable"
            >
              {t("policies.unavailable")}
            </p>
          ) : (
            <>
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  ref={policiesButton}
                  onClick={() => setPoliciesOpen(true)}
                  aria-haspopup="dialog"
                  data-testid="open-policies"
                >
                  {t("policies.openButton")}
                </Button>
              </div>

              {/* THE BOX STAYS 13 PIXELS; WHAT GREW IS THE REACH.

                  Measured: a 13×13 checkbox inside a 356×20 label — the
                  whole target twenty pixels tall, on the one control
                  that stands between a person and an account.

                  `min-h-[44px]` with vertical padding gives the label
                  the reach without touching the box, the type size or
                  the layout: the negative margin puts the row back
                  where it was, so nothing around it moves.

                  A LABEL WRAPPING ITS INPUT is already the whole of it
                  — pressing anywhere in it toggles the box, with no
                  `htmlFor` to keep in step. */}
              <label className="-my-2 flex min-h-[44px] items-center gap-2 py-2 text-sm text-content">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  data-testid="accept-policies"
                  className="shrink-0 border-line-strong"
                />
                <span>{t("policies.consent")}</span>
              </label>
            </>
          )}
        </fieldset>

        <div id={errorId} role="alert" aria-live="assertive">
          {failure ? (
            <div className="rounded-md border border-danger bg-surface px-3 py-3">
              <p className="text-sm text-content">{root(failure.messageKey)}</p>

              {conflict ? (
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  <Link
                    href={`/${locale}/login`}
                    className="text-secondary hover:opacity-[var(--state-hover-opacity)]"
                  >
                    {t("conflict.signIn")}
                  </Link>
                  <Link
                    href={`/${locale}/forgot-password`}
                    className="text-secondary hover:opacity-[var(--state-hover-opacity)]"
                  >
                    {t("conflict.recoverAccess")}
                  </Link>
                </div>
              ) : null}

              {failure.requestId ? (
                <p className="mt-2 text-xs text-content-muted">
                  {root("errors.requestIdLabel")}:{" "}
                  <span className="font-mono">{failure.requestId}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <Button
          type="submit"
          variant="secondary"
          disabled={!canSubmit}
          isLoading={submitting}
        >
          {submitting ? common("loading") : t("submit")}
        </Button>
      </form>

      {policiesOpen ? (
        <PoliciesDialog
          documents={policies}
          labels={labels.policiesDialog}
          onClose={closePolicies}
        />
      ) : null}
    </>
  );
}
