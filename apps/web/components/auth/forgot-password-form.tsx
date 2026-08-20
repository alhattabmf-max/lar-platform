"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/**
 * Password recovery request.
 *
 * The API answers identically whether or not the address is registered,
 * so this form shows the SAME confirmation either way. Reporting
 * "no such account" would reintroduce exactly the enumeration oracle
 * the registration flow was changed to close.
 */
export function ForgotPasswordForm() {
  const t = useTranslations("auth.forgotPassword");
  const common = useTranslations("common");
  const root = useTranslations();

  const statusId = useId();

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFailure(null);

    try {
      await apiClient.post("/auth/password/forgot", { email: email.trim() });
      setSent(true);
    } catch (error) {
      // Only transport or rate-limit failures land here; the endpoint
      // itself does not distinguish known from unknown addresses.
      setFailure(toUserFacingError(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div id={statusId} role="status" aria-live="polite" className="flex flex-col gap-2">
        <p className="text-sm text-content">{t("sent")}</p>
        <p className="text-sm text-content-muted">{t("sentDetail")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label={t("email")} required requiredLabel={common("required")}>
        {({ inputId }) => (
          <Input
            id={inputId}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </Field>

      <div role="alert" aria-live="assertive">
        {failure ? (
          <div className="rounded-md border border-danger bg-surface px-3 py-2">
            <p className="text-sm text-content">{root(failure.messageKey)}</p>
          </div>
        ) : null}
      </div>

      <Button type="submit" variant="secondary" isLoading={submitting}>
        {submitting ? common("loading") : t("submit")}
      </Button>
    </form>
  );
}
