"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PASSWORD_MIN_LENGTH } from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { isApiError } from "@/lib/errors";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { useOneTimeToken } from "@/lib/use-one-time-token";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { LoadingState } from "@/components/ui/states";

/**
 * Sets a new password from a recovery link.
 *
 * The token is read from the URL on the CLIENT, deliberately. Passing
 * it through a server component would embed it in the RSC hydration
 * payload — i.e. into the HTML the browser stores and that any page-
 * scraping error reporter would capture. Reading it here keeps it in
 * the address bar and in the request body, and nowhere else.
 *
 * It is never placed in an input value, never in a hidden field, never
 * in an error message, and never logged.
 *
 * The API answers missing, already-used and expired tokens with ONE
 * indistinguishable 400, so this form shows one message for all three.
 * Saying "this link already been used" would confirm a real token
 * existed.
 */
export function ResetPasswordForm({ locale }: { locale: string }) {
  const t = useTranslations("auth.resetPassword");
  const common = useTranslations("common");
  const root = useTranslations();

  const router = useRouter();
  const errorId = useId();

  // Captured into memory and stripped from the address bar on mount.
  // It is held only until submit.
  const { token, ready } = useOneTimeToken();

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [linkRejected, setLinkRejected] = useState(false);

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const mismatch = confirmation.length > 0 && password !== confirmation;

  const canSubmit =
    !submitting &&
    ready &&
    token !== null &&
    password.length >= PASSWORD_MIN_LENGTH &&
    password === confirmation;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guarded, not merely disabled: Enter can submit a form whose
    // button is disabled in some browsers.
    if (!canSubmit || token === null) return;

    setSubmitting(true);
    setFailure(null);
    setLinkRejected(false);

    try {
      await apiClient.post("/auth/password/reset", { token, newPassword: password });

      // The API revokes every session for this user on success, so
      // there is nothing to preserve — go to sign-in.
      router.replace(`/${locale}/login?reset=success`);
      router.refresh();
    } catch (error) {
      // A 400 here is the token being unusable: the password length is
      // already enforced above, so it cannot be the cause.
      setLinkRejected(isApiError(error) && error.status === 400);
      setFailure(toUserFacingError(error));
      setSubmitting(false);
    }
  }

  // Until capture and URL cleanup finish, nothing is decided yet —
  // rendering the "missing link" state here would flash it for every
  // legitimate visitor.
  if (!ready) {
    return <LoadingState label={common("loading")} rows={2} />;
  }

  if (token === null) {
    return (
      <div role="alert" className="flex flex-col gap-3">
        <p className="text-sm text-content">{t("missingToken")}</p>
        <Link href={`/${locale}/forgot-password`} className="text-sm text-secondary hover:opacity-90">
          {t("requestNewLink")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field
        label={t("newPassword")}
        required
        requiredLabel={common("required")}
        error={tooShort ? t("tooShort", { min: PASSWORD_MIN_LENGTH }) : undefined}
      >
        {({ inputId, errorId: fieldErrorId, invalid }) => (
          <Input
            id={inputId}
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            invalid={invalid}
            describedById={fieldErrorId}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>

      <Field
        label={t("confirmPassword")}
        required
        requiredLabel={common("required")}
        error={mismatch ? t("mismatch") : undefined}
      >
        {({ inputId, errorId: fieldErrorId, invalid }) => (
          <Input
            id={inputId}
            type="password"
            autoComplete="new-password"
            required
            invalid={invalid}
            describedById={fieldErrorId}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        )}
      </Field>

      <div id={errorId} role="alert" aria-live="assertive">
        {failure ? (
          <div className="rounded-md border border-danger bg-surface px-3 py-3">
            <p className="text-sm text-content">
              {linkRejected ? t("linkUnusable") : root(failure.messageKey)}
            </p>
            {linkRejected ? (
              <p className="mt-2 text-sm">
                <Link
                  href={`/${locale}/forgot-password`}
                  className="text-secondary hover:opacity-90"
                >
                  {t("requestNewLink")}
                </Link>
              </p>
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

      <Button type="submit" variant="secondary" disabled={!canSubmit} isLoading={submitting}>
        {submitting ? common("loading") : t("submit")}
      </Button>
    </form>
  );
}
