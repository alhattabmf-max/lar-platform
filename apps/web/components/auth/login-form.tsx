"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AppLocale } from "@/i18n/routing";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { portalPathFor, type PortalRole } from "@/lib/portal-paths";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/**
 * Sign-in by commercial registration number and password.
 *
 * There is NO one-time code anywhere in this flow, by design: a company
 * user authenticates with the CR number and a password, full stop. (The
 * admin portal is a separate surface with its own cookie and its own
 * 2FA — it does not share this form.)
 *
 * The session arrives as an HttpOnly cookie set by the API. This
 * component never reads it, never stores a role, and never decodes a
 * token; after a successful post it simply asks the server to
 * re-render, and the server decides what the user may see.
 */
export interface LoginFormProps {
  locale: AppLocale;
  /** Internal path to return to after signing in. Already validated server-side. */
  returnTo?: string;
}

export function LoginForm({ locale, returnTo }: LoginFormProps) {
  const t = useTranslations("auth.login");
  const common = useTranslations("common");
  const errors = useTranslations();

  const router = useRouter();
  const errorId = useId();

  const [crNumber, setCrNumber] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFailure(null);

    try {
      const { accountType } = await apiClient.post<{ accountType: PortalRole }>(
        "/auth/login",
        { crNumber: crNumber.trim(), password },
      );

      // STRAIGHT INTO THE PORTAL. The login response says which kind
      // of account this is, and that decides which one. Signing in used
      // to land on the public home page, which is why a new account
      // never found its portal; for a while after that it landed on a
      // separate "complete your profile" page, which is now a section
      // inside the portal rather than a gate in front of it.
      //
      // AN INCOMPLETE RECORD CHANGES NOTHING HERE. The dashboard says
      // what is missing and links to it.
      router.replace(returnTo ?? portalPathFor(locale, accountType));
      // The layouts re-read /me on the server and decide what may be
      // shown; nothing about the session is trusted from here.
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label={t("crNumber")} required requiredLabel={common("required")}>
        {({ inputId }) => (
          <Input
            id={inputId}
            name="crNumber"
            inputMode="numeric"
            autoComplete="username"
            required
            value={crNumber}
            onChange={(e) => setCrNumber(e.target.value)}
            describedById={failure ? errorId : undefined}
          />
        )}
      </Field>

      <Field label={t("password")} required requiredLabel={common("required")}>
        {({ inputId }) => (
          <Input
            id={inputId}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            describedById={failure ? errorId : undefined}
          />
        )}
      </Field>

      {/*
        aria-live so the failure is announced when it appears, rather
        than only being visible. The region is always present so screen
        readers observe it from first render.
      */}
      <div id={errorId} role="alert" aria-live="assertive" className="min-h-0">
        {failure ? (
          <div className="rounded-md border border-danger bg-surface px-3 py-2">
            <p className="text-sm text-content">{errors(failure.messageKey)}</p>
            {failure.requestId ? (
              <p className="mt-1 text-xs text-content-muted">
                {errors("errors.requestIdLabel")}:{" "}
                <span className="font-mono">{failure.requestId}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <Button type="submit" variant="secondary" isLoading={submitting}>
        {submitting ? common("loading") : t("submit")}
      </Button>
    </form>
  );
}
