"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AdminRecoveryCodesIssued } from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * The operator's own credentials.
 *
 * BOTH ACTIONS REQUIRE THE CURRENT PASSWORD, and the server enforces it
 * independently. A live session is not proof of knowing the credential
 * being replaced — an unattended terminal would otherwise be enough to
 * change a password or mint a new set of recovery codes.
 *
 * CHANGING THE PASSWORD ENDS EVERY OTHER SESSION. That is the point of
 * changing it — the usual reason is that a session might be in the wrong
 * hands — so the screen states it before the operator commits, not
 * afterwards as a surprise sign-out.
 *
 * NEW RECOVERY CODES ARE SHOWN EXACTLY ONCE. Only hashes are stored, so
 * nothing can display them again, and this screen says so plainly rather
 * than offering a "view codes" button that could never work. Regenerating
 * also invalidates the previous set — printed copies stop working, which
 * is the fact an operator needs before they press it.
 */
export interface AdminOwnAccountLabels {
  email: string;
  twoFactor: string;
  twoFactorOn: string;
  twoFactorOff: string;

  changePassword: string;
  currentPassword: string;
  newPassword: string;
  passwordHint: string;
  passwordSaved: string;
  signedOutElsewhere: string;

  regenerate: string;
  regenerateWarning: string;
  regeneratedTitle: string;
  regeneratedWarning: string;

  submit: string;
  cancel: string;
  working: string;
  required: string;
  errorTitle: string;
  requestIdLabel: string;
}

/** The API's own minimum for an admin password. */
const PASSWORD_MIN = 12;

type Panel = "none" | "password" | "recovery";

export function AdminOwnAccount({
  email,
  twoFactorEnabled,
  labels,
}: {
  email: string;
  twoFactorEnabled: boolean;
  labels: AdminOwnAccountLabels;
}) {
  const router = useRouter();
  const root = useTranslations();
  const ids = useId();

  const [panel, setPanel] = useState<Panel>("none");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [passwordDone, setPasswordDone] = useState(false);
  const [issued, setIssued] = useState<AdminRecoveryCodesIssued | null>(null);

  function open(next: Panel) {
    setPanel(next);
    setCurrentPassword("");
    setNewPassword("");
    setFailure(null);
    setPasswordDone(false);
    // The previous set is cleared from the screen when the panel is
    // reopened, so an old list cannot linger behind a new request.
    setIssued(null);
  }

  function close() {
    setPanel("none");
    setCurrentPassword("");
    setNewPassword("");
    setFailure(null);
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (busy || newPassword.length < PASSWORD_MIN || currentPassword === "") return;

    setBusy(true);
    setFailure(null);

    try {
      await apiClient.post("/admin/auth/password/change", { currentPassword, newPassword });
      // Both values are dropped the instant the request succeeds.
      setCurrentPassword("");
      setNewPassword("");
      setPasswordDone(true);
      setBusy(false);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  async function regenerate(event: React.FormEvent) {
    event.preventDefault();
    if (busy || currentPassword === "") return;

    setBusy(true);
    setFailure(null);

    try {
      const result = await apiClient.post<AdminRecoveryCodesIssued>(
        "/admin/auth/recovery-codes/regenerate",
        { currentPassword }
      );
      setCurrentPassword("");
      setIssued(result);
      setBusy(false);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  const failureBlock = failure ? (
    <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger p-3">
      <p className="text-sm font-medium text-content">{labels.errorTitle}</p>
      <p className="text-sm text-content-muted">{root(failure.messageKey)}</p>
      {failure.requestId ? (
        <p className="text-xs text-content-muted">
          {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <Card>
      <CardBody>
        <div className="flex flex-col gap-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex flex-wrap gap-2">
              <dt className="text-content-muted">{labels.email}</dt>
              <dd className="break-all text-content">{email}</dd>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <dt className="text-content-muted">{labels.twoFactor}</dt>
              <dd>
                <StatusBadge
                  label={twoFactorEnabled ? labels.twoFactorOn : labels.twoFactorOff}
                  tone={twoFactorEnabled ? "done" : "attention"}
                />
              </dd>
            </div>
          </dl>

          {panel === "none" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-11"
                onClick={() => open("password")}
              >
                {labels.changePassword}
              </Button>
              {/* Regenerating replaces codes that only exist because 2FA
                  is enrolled. Offering it before enrolment would be a
                  button with nothing to replace. */}
              {twoFactorEnabled ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="min-h-11"
                  onClick={() => open("recovery")}
                >
                  {labels.regenerate}
                </Button>
              ) : null}
            </div>
          ) : null}

          {passwordDone ? (
            <p role="status" className="rounded-md border border-success p-3 text-sm text-content">
              {labels.passwordSaved}
            </p>
          ) : null}

          {panel === "password" ? (
            <form onSubmit={changePassword} className="flex flex-col gap-3" noValidate>
              <p className="text-sm text-content-muted">{labels.signedOutElsewhere}</p>

              <div className="flex flex-col gap-1">
                <Label htmlFor={`${ids}-current`} required requiredLabel={labels.required}>
                  {labels.currentPassword}
                </Label>
                <Input
                  id={`${ids}-current`}
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor={`${ids}-new`} required requiredLabel={labels.required}>
                  {labels.newPassword}
                </Label>
                <Input
                  id={`${ids}-new`}
                  type="password"
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  aria-describedby={`${ids}-password-hint`}
                  required
                />
                <p id={`${ids}-password-hint`} className="text-xs text-content-muted">
                  {labels.passwordHint}
                </p>
              </div>

              {failureBlock}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  size="sm"
                  className="min-h-11"
                  isLoading={busy}
                  disabled={busy || newPassword.length < PASSWORD_MIN || currentPassword === ""}
                >
                  {busy ? labels.working : labels.submit}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11"
                  disabled={busy}
                  onClick={close}
                >
                  {labels.cancel}
                </Button>
              </div>
            </form>
          ) : null}

          {panel === "recovery" ? (
            <form onSubmit={regenerate} className="flex flex-col gap-3" noValidate>
              <p className="rounded-md border border-warning bg-warning-surface p-3 text-sm text-warning-text">
                {labels.regenerateWarning}
              </p>

              <div className="flex flex-col gap-1">
                <Label htmlFor={`${ids}-recovery-password`} required requiredLabel={labels.required}>
                  {labels.currentPassword}
                </Label>
                <Input
                  id={`${ids}-recovery-password`}
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                />
              </div>

              {failureBlock}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  size="sm"
                  className="min-h-11"
                  isLoading={busy}
                  disabled={busy || currentPassword === ""}
                >
                  {busy ? labels.working : labels.submit}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11"
                  disabled={busy}
                  onClick={close}
                >
                  {labels.cancel}
                </Button>
              </div>
            </form>
          ) : null}

          {issued ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-content">{labels.regeneratedTitle}</p>
              <ul className="grid list-none gap-1 rounded-md border border-warning bg-warning-surface p-3 sm:grid-cols-2">
                {issued.codes.map((code) => (
                  <li key={code} className="font-mono text-sm text-content">
                    {code}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-warning-text">{labels.regeneratedWarning}</p>
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
