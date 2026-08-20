"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { isApiError } from "@/lib/errors";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { useOneTimeToken } from "@/lib/use-one-time-token";
import { ButtonLink } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/states";

type Phase = "missing-token" | "verifying" | "verified" | "link-unusable" | "failed";

/**
 * Confirms an email address from a verification link.
 *
 * Verification happens on mount rather than behind a button: the user
 * already expressed intent by following the link, and a second click
 * adds nothing. The token is read from the URL on the CLIENT so it
 * never enters the server-rendered payload, and it is never rendered,
 * never placed in a field, and never logged.
 *
 * The API returns ONE 400 for missing, already-consumed and expired
 * tokens alike. That is treated as a single "this link no longer
 * works" state — distinguishing them would confirm which tokens once
 * existed.
 *
 * If an administrator has disabled email verification, the API's own
 * response governs; nothing here second-guesses it or invents a
 * client-side check.
 */
export function VerifyEmailPanel({ locale }: { locale: string }) {
  const t = useTranslations("auth.verifyEmail");
  const root = useTranslations();

  // Captured into memory and stripped from the address bar first.
  const { token, ready } = useOneTimeToken();

  const [phase, setPhase] = useState<Phase>("verifying");
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  // Strict Mode mounts effects twice in development; the token is
  // single-use, so a second POST would consume nothing and report a
  // spurious failure.
  const attempted = useRef(false);

  useEffect(() => {
    // The gate that matters: no request is issued until `ready`, which
    // means the token is out of the address bar. A fetch fired earlier
    // could carry the tokened URL as its Referer.
    if (!ready || attempted.current) return;
    attempted.current = true;

    if (token === null) {
      setPhase("missing-token");
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await apiClient.post("/auth/email/verify", { token });
        if (!cancelled) setPhase("verified");
      } catch (error) {
        if (cancelled) return;
        setFailure(toUserFacingError(error));
        setPhase(isApiError(error) && error.status === 400 ? "link-unusable" : "failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, token]);

  if (phase === "verifying") {
    return <LoadingState label={t("verifying")} rows={2} />;
  }

  if (phase === "verified") {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-4">
        <p className="text-sm text-success">{t("verified")}</p>
        <p className="text-sm text-content-muted">{t("verifiedDetail")}</p>
        <div>
          <ButtonLink href={`/${locale}/login`} variant="secondary">
            {t("goToLogin")}
          </ButtonLink>
        </div>
      </div>
    );
  }

  const message =
    phase === "missing-token"
      ? t("missingToken")
      : phase === "link-unusable"
        ? t("linkUnusable")
        : failure
          ? root(failure.messageKey)
          : root("errors.unknown");

  return (
    <div role="alert" aria-live="assertive" className="flex flex-col gap-4">
      <p className="text-sm text-content">{message}</p>

      {phase !== "missing-token" && failure?.requestId ? (
        <p className="text-xs text-content-muted">
          {root("errors.requestIdLabel")}:{" "}
          <span className="font-mono">{failure.requestId}</span>
        </p>
      ) : null}

      <div className="flex flex-col gap-2 text-sm">
        <Link href={`/${locale}/login`} className="text-secondary hover:opacity-90">
          {t("signInToResend")}
        </Link>
        <span className="text-content-muted">{t("resendHint")}</span>
      </div>
    </div>
  );
}
