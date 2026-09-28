"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { ShareTier } from "@/lib/admin-data";

/**
 * The share-tier ladder.
 *
 * The only settings group that is a LIST rather than a set of fields:
 * a tier is a ceiling and a share, and the platform reads them in
 * order. So this needs rows that can be added and removed, which no
 * generic field form can express.
 *
 * THE LAST TIER IS OPEN-ENDED. `maxTotalValueInclTax` is optional in
 * the DTO precisely so the final tier can carry no ceiling — leaving
 * that box empty is how an operator says "and everything above". It is
 * not a missing value, so it is not an error.
 *
 * WRITING APPENDS A VERSION. The server does not overwrite the ladder;
 * it records a new one and stamps who wrote it. Opportunities already
 * published keep the version they were priced against — which is why
 * this screen never offers to "edit" a past version.
 */

const MAX_SHARE_BP = 10000;

export function ShareTierEditor({
  initialTiers,
  labels,
}: {
  initialTiers: ShareTier[];
  labels: {
    ceiling: string;
    share: string;
    openEnded: string;
    addTier: string;
    removeTier: string;
    emptyTitle: string;
    save: string;
    working: string;
    saved: string;
    errorTitle: string;
    requestIdLabel: string;
  };
}) {
  const router = useRouter();
  const root = useTranslations();

  const [rows, setRows] = useState(() =>
    initialTiers.map((t) => ({
      ceiling: t.maxTotalValueInclTax === null ? "" : String(t.maxTotalValueInclTax),
      share: String(t.shareBasisPoints),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const touch = () => setSaved(false);

  const setRow = (index: number, key: "ceiling" | "share", value: string) => {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
    touch();
  };

  const addRow = () => {
    setRows((current) => [...current, { ceiling: "", share: "" }]);
    touch();
  };

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_, i) => i !== index));
    touch();
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setFailure(null);
    setSaved(false);

    // An empty ceiling is the open-ended tier and is sent as null, not
    // dropped: the DTO marks it optional, and omitting the key entirely
    // would read as "unset" rather than "no ceiling".
    const tiers = rows.map((row) => ({
      maxTotalValueInclTax: row.ceiling.trim() === "" ? null : Number(row.ceiling),
      shareBasisPoints: Number(row.share),
    }));

    try {
      await apiClient.put("/admin/settings/share-tiers", { tiers });
      setSaved(true);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className="text-sm text-content-muted">{labels.emptyTitle}</p>
      ) : (
        <ul className="flex list-none flex-col gap-3">
          {rows.map((row, index) => (
            <li key={index} className="flex items-end gap-3">
              <div className="flex-1">
                <Field label={labels.ceiling}>
                  {({ inputId, errorId, invalid }) => (
                    <Input
                      id={inputId}
                      type="number"
                      min={0}
                      step="any"
                      placeholder={labels.openEnded}
                      value={row.ceiling}
                      onChange={(event) => setRow(index, "ceiling", event.target.value)}
                      disabled={busy}
                      describedById={errorId}
                      invalid={invalid}
                    />
                  )}
                </Field>
              </div>
              <div className="flex-1">
                <Field label={labels.share}>
                  {({ inputId, errorId, invalid }) => (
                    <Input
                      id={inputId}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={MAX_SHARE_BP}
                      step={1}
                      value={row.share}
                      onChange={(event) => setRow(index, "share", event.target.value)}
                      disabled={busy}
                      describedById={errorId}
                      invalid={invalid}
                    />
                  )}
                </Field>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => removeRow(index)}
                disabled={busy}
              >
                {labels.removeTier}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {failure ? (
        <p role="alert" className="text-sm text-danger">
          {labels.errorTitle}: {root(failure.messageKey)}
          {failure.requestId ? (
            <span className="block font-mono text-xs text-content-muted">
              {labels.requestIdLabel}: {failure.requestId}
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" onClick={addRow} disabled={busy}>
          {labels.addTier}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? labels.working : labels.save}
        </Button>
        {saved ? (
          <span role="status" className="text-sm text-success">
            {labels.saved}
          </span>
        ) : null}
      </div>
    </form>
  );
}
