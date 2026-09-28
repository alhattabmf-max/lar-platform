"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { newIdempotencyKey, type IdempotencyKey } from "@/lib/idempotency";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";

/**
 * One administrative write, with the confirmation it deserves.
 *
 * A client component because the API's CSRF guard requires a browser
 * `Origin` header on state-changing requests, and the `asid` cookie
 * rides along with `credentials: "include"` — both supplied by
 * `apiClient`.
 *
 * EVERY action here asks first. These are the platform's consequential
 * writes — disabling a colleague's account, rejecting a supplier,
 * cancelling a live opportunity — and none of them should be one
 * mis-aimed click away. The confirmation states what will happen in
 * plain language rather than asking "Are you sure?", which tells a
 * reader nothing about what they are confirming.
 *
 * MANDATORY REASONS are enforced here as well as on the server. When
 * `reason` is configured the confirm button stays disabled until the
 * text meets the server's own minimum, and the field explains the
 * requirement before the reader types rather than after they submit.
 * The server remains the authority: it re-checks, and its refusal is
 * what the reader sees if the two ever disagree.
 *
 * IDEMPOTENCY. A key is minted ONCE per confirmation, when the dialog
 * opens, and reused for every retry of that same intent. Minting one
 * per click would defeat the mechanism entirely — a retry after a
 * timeout would look like a brand-new instruction and could execute a
 * second refund. It is only sent when the caller says the endpoint
 * takes one; the API rejects the header where it is not expected.
 *
 * There is no optimistic update. The server decides the new state, and
 * `router.refresh()` re-reads it.
 */
export interface AdminActionReason {
  /** Body field name the endpoint expects, e.g. "reason" or "reasonNote". */
  field: string;
  label: string;
  /** The server's own minimum. The confirm button stays disabled below it. */
  minLength: number;
  maxLength: number;
  /** Shown under the field, already translated and interpolated. */
  hint: string;
}

export interface AdminActionProps {
  /** API path, e.g. `/admin/admin-users/{id}/disable`. */
  path: string;
  method?: "POST" | "PATCH" | "DELETE";
  /** Extra body fields sent alongside the reason. */
  body?: Record<string, unknown>;
  /** True when this endpoint accepts — and requires — an Idempotency-Key. */
  idempotent?: boolean;
  reason?: AdminActionReason;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  labels: {
    /** The button that opens the confirmation. */
    action: string;
    /** What will happen, in plain language. */
    prompt: string;
    confirm: string;
    cancel: string;
    working: string;
    errorTitle: string;
    requestIdLabel: string;
  };
}

export function AdminAction({
  path,
  method = "POST",
  body,
  idempotent = false,
  reason,
  variant = "primary",
  labels,
}: AdminActionProps) {
  const router = useRouter();
  const root = useTranslations();
  const fieldId = useId();

  const [asking, setAsking] = useState(false);
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  // Minted when the dialog opens, not per click — see above.
  const [idempotencyKey, setIdempotencyKey] = useState<IdempotencyKey | null>(null);

  const trimmed = reasonText.trim();
  const reasonReady = reason ? trimmed.length >= reason.minLength : true;

  function open() {
    setAsking(true);
    setReasonText("");
    setFailure(null);
    setIdempotencyKey(idempotent ? newIdempotencyKey() : null);
  }

  function close() {
    setAsking(false);
    setFailure(null);
  }

  async function run() {
    // The second press while a request is in flight does nothing at
    // all, rather than sending a second write.
    if (busy || !reasonReady) return;

    setBusy(true);
    setFailure(null);

    const payload = {
      ...(body ?? {}),
      ...(reason ? { [reason.field]: trimmed } : {}),
    };

    try {
      const options = idempotencyKey ? { idempotencyKey } : {};
      if (method === "PATCH") {
        await apiClient.patch(path, payload, options);
      } else if (method === "DELETE") {
        // THE BODY TRAVELS WITH IT, because a delete here still takes a
        // reason: the audit entry is the only thing that will outlive
        // the row, so the note cannot be optional and cannot go in the
        // query string where a proxy log would keep it.
        await apiClient.delete(path, payload, options);
      } else {
        await apiClient.post(path, payload, options);
      }
      setAsking(false);
      setBusy(false);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <Button type="button" variant={variant} size="sm" onClick={open}>
        {labels.action}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-3">
      {/* Announced when it appears, because this replaces the button
          the operator just pressed. */}
      <p role="status" aria-live="polite" className="text-sm text-content">
        {labels.prompt}
      </p>

      {reason ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor={fieldId} required requiredLabel={root("common.required")}>
            {reason.label}
          </Label>
          <Textarea
            id={fieldId}
            value={reasonText}
            onChange={(event) => setReasonText(event.target.value)}
            minLength={reason.minLength}
            maxLength={reason.maxLength}
            rows={3}
            className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-content"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={variant}
          size="sm"
         
          onClick={run}
          isLoading={busy}
          // Disabled only while a write is in flight or the mandatory
          // reason is short — never as decoration. A button that can be
          // pressed always does something.
          disabled={busy || !reasonReady}
        >
          {busy ? labels.working : labels.confirm}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
         
          onClick={close}
          disabled={busy}
        >
          {labels.cancel}
        </Button>
      </div>

      {failure ? (
        <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger p-2">
          <p className="text-sm font-medium text-content">{labels.errorTitle}</p>
          <p className="text-sm text-content-muted">{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="text-xs text-content-muted">
              {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
