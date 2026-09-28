"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * What a control panel screen shows when it throws.
 *
 * WHY THIS EXISTS. Without it, one failing page replaces the whole
 * document with Next's own English error screen — no sidebar, no way
 * back, and a sentence an Arabic operator cannot read. Placed on the
 * admin SEGMENT, it is scoped: the frame stays, the other sections stay
 * reachable, and only the panel that failed is replaced.
 *
 * THE DIGEST IS THE POINT. React replaces a server error's message with
 * an opaque hash before it reaches the browser — deliberately, because
 * the message can name a file path, a query or a row. That hash is the
 * one thing that ties what the operator saw to the line in the server
 * log, so it is shown plainly and made easy to copy rather than being
 * treated as noise.
 *
 * NO CAUSE IS GUESSED. It offers a retry and the reference, and says
 * nothing about what went wrong: an error screen that speculates sends
 * whoever reads it looking in the wrong place.
 */
export default function ControlPanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("admin.error");
  const states = useTranslations("states");

  useEffect(() => {
    // The browser console gets it too, so a developer with the screen
    // open does not have to go to the server log to see that anything
    // happened. `error.message` is already the redacted one.
    console.error("Control panel error", error.digest ?? "", error.message);
  }, [error]);

  return (
    <div
      role="alert"
      data-testid="control-panel-error"
      className="mx-auto flex max-w-xl flex-col items-start gap-4 rounded-md border border-danger bg-surface p-6"
    >
      <div className="flex items-center gap-3">
        <TriangleAlert
          aria-hidden="true"
          className="size-6 shrink-0 text-danger"
        />
        <h1 className="text-xl font-semibold text-content">{t("title")}</h1>
      </div>

      <p className="text-sm text-content-muted">{t("description")}</p>

      {error.digest ? (
        <p className="text-sm text-content-muted">
          {states("requestIdLabel")}:{" "}
          <span
            className="select-all font-mono text-content"
            data-testid="control-panel-error-digest"
          >
            {error.digest}
          </span>
        </p>
      ) : null}

      <Button
        type="button"
       
        onClick={reset}
        data-testid="control-panel-retry"
      >
        {t("retry")}
      </Button>
    </div>
  );
}
