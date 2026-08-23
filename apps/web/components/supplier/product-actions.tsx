"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import type { ProductActionGate } from "@/lib/product-actions";

/**
 * Submit and archive, for one product.
 *
 * A client component because the API's CSRF guard requires a browser
 * `Origin` header on state-changing requests, and the session cookie rides
 * along with `credentials: "include"` — both of which `apiClient` supplies.
 * Neither endpoint takes an `Idempotency-Key`: they are not in the API's
 * idempotent set, so a duplicate is prevented here by refusing to fire while
 * one request is in flight, and by the server's own state guard behind that.
 *
 * ELIGIBILITY IS THE SERVER'S. `productActions()` transcribes the service's
 * guards so a button that cannot work is never drawn, but when the two
 * disagree the server wins and its refusal is what the reader sees.
 *
 * There is no optimistic update and no fabricated status. `submit` may
 * approve the product or refuse it with a list of failed technical checks,
 * and `archive` is not reversible by the supplier — neither outcome is
 * knowable here, so `router.refresh()` re-reads the server's answer.
 */
export interface ProductActionsProps {
  productId: string;
  gate: ProductActionGate;
  labels: {
    submit: string;
    submitPrompt: string;
    archive: string;
    archivePrompt: string;
    confirm: string;
    cancel: string;
    submitting: string;
    errorTitle: string;
    requestIdLabel: string;
  };
}

type Pending = "submit" | "archive" | null;

export function ProductActions({ productId, gate, labels }: ProductActionsProps) {
  const router = useRouter();
  const root = useTranslations();

  const [asking, setAsking] = useState<Pending>(null);
  const [submitting, setSubmitting] = useState<Pending>(null);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  async function run(action: "submit" | "archive") {
    // Double-submit protection: the second press while a request is in
    // flight does nothing at all, rather than sending a second write.
    if (submitting !== null) return;

    setSubmitting(action);
    setFailure(null);

    try {
      await apiClient.post(`/companies/me/products/${productId}/${action}`);
      setAsking(null);
      setSubmitting(null);
      // The server decides what the page now shows. A submit either
      // approved the product or changed nothing at all.
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setSubmitting(null);
    }
  }

  if (!gate.canSubmit && !gate.canArchive) return null;

  if (asking !== null) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-line p-3">
        {/* Announced when it appears, because the question replaces the
            button the person just pressed. */}
        <p role="status" aria-live="polite" className="text-sm text-content">
          {asking === "submit" ? labels.submitPrompt : labels.archivePrompt}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => run(asking)}
            isLoading={submitting !== null}
            disabled={submitting !== null}
          >
            {submitting !== null ? labels.submitting : labels.confirm}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAsking(null)}
            disabled={submitting !== null}
          >
            {labels.cancel}
          </Button>
        </div>

        <Failure failure={failure} labels={labels} root={root} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {/* Both ask first. Submitting runs the technical checks and can
            approve the product outright; archiving cannot be undone by
            the supplier — there is no unarchive endpoint. */}
        {gate.canSubmit ? (
          <Button type="button" size="sm" onClick={() => setAsking("submit")}>
            {labels.submit}
          </Button>
        ) : null}
        {gate.canArchive ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setAsking("archive")}>
            {labels.archive}
          </Button>
        ) : null}
      </div>

      <Failure failure={failure} labels={labels} root={root} />
    </div>
  );
}

function Failure({
  failure,
  labels,
  root,
}: {
  failure: UserFacingError | null;
  labels: ProductActionsProps["labels"];
  root: ReturnType<typeof useTranslations>;
}) {
  if (!failure) return null;

  return (
    <div role="alert" className="flex flex-col gap-1 text-sm">
      <p className="font-medium text-danger-text">{labels.errorTitle}</p>
      {/* The translated message for a KNOWN code, never the API's own
          text — that is an English developer string, and for a failed
          submit it lists internal technical-check names. */}
      <p className="text-content">{root(failure.messageKey)}</p>
      {failure.requestId ? (
        <p className="text-content-muted">
          {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
        </p>
      ) : null}
    </div>
  );
}
