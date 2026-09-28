"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

/**
 * Signing in to the admin portal.
 *
 * THE WHOLE FLOW LIVES IN ONE COMPONENT, on purpose. It is a three-stage
 * exchange around a single-use `ticket`, and that ticket is the reason:
 *
 *   1. `POST /admin/auth/login` returns `{ stage, ticket }`. The stage
 *      says whether this administrator has an authenticator app yet.
 *   2a. VERIFY_REQUIRED — `POST /admin/auth/2fa/verify` with the ticket
 *       and either a TOTP code or a one-time recovery code.
 *   2b. SETUP_REQUIRED — `POST /admin/auth/2fa/setup` returns a secret
 *       and recovery codes, then `.../setup/confirm` proves the app
 *       works and issues the session.
 *
 * The ticket is a CREDENTIAL. It lives in component state and nowhere
 * else: not in the URL, not in `localStorage`, not in a cookie this code
 * writes. Splitting the stages across routes would have meant passing it
 * through the address bar, where it would land in browser history,
 * server logs and any referrer header the page emits.
 *
 * The recovery codes shown after enrolment come back EXACTLY ONCE and
 * are stored nowhere — only their hashes are written. So the confirm
 * step is gated behind an explicit "I have saved these" acknowledgement:
 * an administrator who navigates away without copying them has lost
 * their only way back in without a colleague.
 *
 * There is no `returnTo`. After signing in the operator lands on the
 * dashboard; a destination taken from the query string would need an
 * internal-path allowlist before it could be trusted, and that is a
 * redirect surface this screen does not need to have.
 *
 * `router.refresh()` rather than a push: the session cookie is now set,
 * so re-running the layout's server-side guard renders the portal at the
 * same address. Nothing about the URL changes, so nothing needs to.
 */
type Stage =
  | { name: "CREDENTIALS" }
  | { name: "VERIFY"; ticket: string }
  | {
      name: "SETUP";
      ticket: string;
      secret: string;
      recoveryCodes: string[];
    };

export interface AdminLoginLabels {
  email: string;
  password: string;
  signIn: string;
  working: string;

  verifyTitle: string;
  code: string;
  codeHint: string;
  verify: string;
  useRecovery: string;
  useAuthenticator: string;
  recoveryCode: string;
  recoveryHint: string;

  setupTitle: string;
  setupSecret: string;
  setupSecretHint: string;
  setupRecoveryTitle: string;
  setupRecoveryWarning: string;
  setupConfirm: string;
  setupSaved: string;

  back: string;
  errorTitle: string;
  requestIdLabel: string;
  required: string;
}

export function AdminLoginFlow({ labels }: { labels: AdminLoginLabels }) {
  const router = useRouter();
  const root = useTranslations();
  const ids = useId();

  const [stage, setStage] = useState<Stage>({ name: "CREDENTIALS" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [usingRecovery, setUsingRecovery] = useState(false);
  const [savedCodes, setSavedCodes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  function fail(error: unknown) {
    setFailure(toUserFacingError(error));
    setBusy(false);
  }

  function done() {
    setBusy(false);
    // The cookie is set; re-running the layout's guard renders the
    // portal at this same address.
    router.refresh();
  }

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);

    try {
      const result = await apiClient.post<{ stage: string; ticket: string }>("/admin/auth/login", {
        email,
        password,
      });

      // The password is dropped from state the moment it is no longer
      // needed. It cannot help the remaining stages, and holding it in
      // a live component is holding it for no reason.
      setPassword("");

      if (result.stage === "SETUP_REQUIRED") {
        const enrolment = await apiClient.post<{
          otpauthUri: string;
          secret: string;
          recoveryCodes: string[];
        }>("/admin/auth/2fa/setup", { ticket: result.ticket });

        setStage({
          name: "SETUP",
          ticket: result.ticket,
          secret: enrolment.secret,
          recoveryCodes: enrolment.recoveryCodes,
        });
      } else {
        setStage({ name: "VERIFY", ticket: result.ticket });
      }
      setBusy(false);
    } catch (error) {
      fail(error);
    }
  }

  async function submitVerify(event: React.FormEvent) {
    event.preventDefault();
    if (busy || stage.name !== "VERIFY") return;
    setBusy(true);
    setFailure(null);

    try {
      // Exactly one of the two is sent. Sending both would leave the
      // server to choose, and a recovery code is single-use — burning
      // one because a TOTP field happened to be filled is not a
      // recoverable mistake.
      await apiClient.post("/admin/auth/2fa/verify", {
        ticket: stage.ticket,
        ...(usingRecovery ? { recoveryCode: recoveryCode.trim() } : { code: code.trim() }),
      });
      done();
    } catch (error) {
      fail(error);
    }
  }

  async function submitSetup(event: React.FormEvent) {
    event.preventDefault();
    if (busy || stage.name !== "SETUP" || !savedCodes) return;
    setBusy(true);
    setFailure(null);

    try {
      await apiClient.post("/admin/auth/2fa/setup/confirm", {
        ticket: stage.ticket,
        code: code.trim(),
      });
      done();
    } catch (error) {
      fail(error);
    }
  }

  function restart() {
    setStage({ name: "CREDENTIALS" });
    setCode("");
    setRecoveryCode("");
    setUsingRecovery(false);
    setSavedCodes(false);
    setFailure(null);
  }

  const failureBlock = failure ? (
    <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger p-3">
      <p className="text-sm font-medium text-content">{labels.errorTitle}</p>
      {/* The translated message for a KNOWN code, never the API's own
          text. On this screen especially: the server deliberately
          answers the same way for a wrong password and an unknown
          email, and echoing its wording could undo that. */}
      <p className="text-sm text-content-muted">{root(failure.messageKey)}</p>
      {failure.requestId ? (
        <p className="text-xs text-content-muted">
          {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
        </p>
      ) : null}
    </div>
  ) : null;

  if (stage.name === "CREDENTIALS") {
    return (
      <form onSubmit={submitCredentials} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-email`} required requiredLabel={labels.required}>
            {labels.email}
          </Label>
          <Input
            id={`${ids}-email`}
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-password`} required requiredLabel={labels.required}>
            {labels.password}
          </Label>
          <Input
            id={`${ids}-password`}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {failureBlock}

        <Button type="submit" isLoading={busy} disabled={busy}>
          {busy ? labels.working : labels.signIn}
        </Button>
      </form>
    );
  }

  if (stage.name === "VERIFY") {
    return (
      <form onSubmit={submitVerify} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-content">{labels.verifyTitle}</h2>
        </div>

        {usingRecovery ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-recovery`} required requiredLabel={labels.required}>
              {labels.recoveryCode}
            </Label>
            <Input
              id={`${ids}-recovery`}
              name="recoveryCode"
              autoComplete="one-time-code"
              required
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-code`} required requiredLabel={labels.required}>
              {labels.code}
            </Label>
            <Input
              id={`${ids}-code`}
              name="code"
              // `inputMode` and `autoComplete` together are what make a
              // phone offer the code from its own SMS/authenticator
              // surface and show a numeric keypad.
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
        )}

        {failureBlock}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" isLoading={busy} disabled={busy}>
            {busy ? labels.working : labels.verify}
          </Button>
          <Button
            type="button"
            variant="ghost"
           
            disabled={busy}
            onClick={() => {
              setUsingRecovery((value) => !value);
              setFailure(null);
            }}
          >
            {usingRecovery ? labels.useAuthenticator : labels.useRecovery}
          </Button>
          <Button
            type="button"
            variant="ghost"
           
            disabled={busy}
            onClick={restart}
          >
            {labels.back}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitSetup} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-content">{labels.setupTitle}</h2>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-content">{labels.setupSecret}</p>
        {/* The secret as text, not a QR image. Rendering one would mean
            either an external image service — which would be handed the
            shared secret — or a bundled QR library on the sign-in path.
            Every authenticator app accepts a typed key. */}
        <p className="break-all rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-content">
          {stage.secret}
        </p>
        <p className="text-xs text-content-muted">{labels.setupSecretHint}</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-content">{labels.setupRecoveryTitle}</p>
        <ul className="grid list-none gap-1 rounded-md border border-warning bg-warning-surface p-3 sm:grid-cols-2">
          {stage.recoveryCodes.map((recovery) => (
            <li key={recovery} className="font-mono text-sm text-content">
              {recovery}
            </li>
          ))}
        </ul>
        <p className="text-xs text-warning-text">{labels.setupRecoveryWarning}</p>

        <label className="flex items-start gap-2 text-sm text-content">
          <input
            type="checkbox"
            checked={savedCodes}
            onChange={(event) => setSavedCodes(event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>{labels.setupSaved}</span>
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-setup-code`} required requiredLabel={labels.required}>
          {labels.code}
        </Label>
        <Input
          id={`${ids}-setup-code`}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>

      {failureBlock}

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
         
          isLoading={busy}
          // Gated on the acknowledgement: these codes are shown once and
          // are the only way back in if the authenticator is lost.
          disabled={busy || !savedCodes}
        >
          {busy ? labels.working : labels.setupConfirm}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={restart}>
          {labels.back}
        </Button>
      </div>
    </form>
  );
}
