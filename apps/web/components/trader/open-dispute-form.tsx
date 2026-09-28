"use client";

import { useId, useRef, useState } from "react";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/field";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  DISPUTE_DESCRIPTION_MAX_LENGTH,
  DISPUTE_DESCRIPTION_MIN_LENGTH,
  DISPUTE_EVIDENCE_CONTENT_TYPES,
  DISPUTE_EVIDENCE_MAX_BYTES,
  DISPUTE_EVIDENCE_MAX_COUNT,
  DISPUTE_REASON_CODES,
  type DisputeReasonCode,
} from "@platform/types";
import { apiClient, uploadFile } from "@/lib/api-client";
import { claimKey, releaseKey } from "@/lib/idempotency-store";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";

/**
 * Opening a dispute on a delivered allocation.
 *
 * THE ORDER OF OPERATIONS IS THE API'S, and it is two steps:
 *
 *   1. each file is POSTed to `/trader/evidence-uploads`, which stores
 *      it and returns an upload record;
 *   2. the dispute is POSTed to
 *      `/trader/order-allocations/:id/disputes` with the storage keys
 *      of those uploads.
 *
 * That ordering is not a choice — the dispute endpoint takes keys, so
 * the files must exist first. It has a consequence worth stating: a
 * failure at step 2 leaves uploaded files with no dispute attached.
 * `EvidenceUpload.usedInDisputeId` stays null, which is what makes them
 * identifiable as orphans; nothing here pretends the dispute opened.
 *
 * THE KEYS NEVER REACH THE SCREEN. They are held in state because step
 * 2 needs them, and they are rendered nowhere — a storage key is an
 * internal address, and there is no authorised delivery endpoint to
 * pair one with, so a client can do nothing with it but construct a
 * request the platform never sanctioned. What the reader sees is the
 * file's own name, type and size, from the `File` they chose.
 *
 * Every limit comes from the shared contract, which mirrors the
 * server's: three content types, 10 MiB each, ten files. Enforcing
 * them here means a file is rejected before it uploads rather than
 * after.
 */
export interface OpenDisputeFormProps {
  orderAllocationId: string;
  locale: string;
  /** Where to go once the dispute exists. */
  orderHref: string;
}

/** A chosen file, plus the key its upload returned. */
interface Attachment {
  /** From the `File`. Shown to the reader. */
  name: string;
  contentType: string;
  sizeBytes: number;
  /** Held for step 2. NEVER rendered. */
  storageObjectKey: string;
}

/** Failures after which retrying with the same key would replay a refusal. */
function isTerminalFailure(error: UserFacingError): boolean {
  return (
    error.kind === "conflict" ||
    error.kind === "validation" ||
    error.kind === "forbidden" ||
    error.kind === "notFound"
  );
}

export function OpenDisputeForm({ orderAllocationId, locale, orderHref }: OpenDisputeFormProps) {
  const t = useTranslations("trader.disputes.open");
  const states = useTranslations("states");
  const root = useTranslations();
  const router = useRouter();

  const formId = useId();
  const reasonId = `${formId}-reason`;
  const descriptionId = `${formId}-description`;
  const errorId = `${formId}-errors`;

  const [reasonCode, setReasonCode] = useState<DisputeReasonCode>(DISPUTE_REASON_CODES[0]);
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [terminal, setTerminal] = useState(false);

  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const trimmed = description.trim();
  const busy = uploading || submitting;

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0 || busy) return;

    setIssue(null);
    setFailure(null);

    const chosen = Array.from(files);

    // Checked BEFORE uploading: a file rejected after it has been sent
    // has already cost the person their bandwidth and left a record on
    // the server.
    if (attachments.length + chosen.length > DISPUTE_EVIDENCE_MAX_COUNT) {
      setIssue(t("issues.tooMany", { max: DISPUTE_EVIDENCE_MAX_COUNT }));
      return;
    }
    for (const file of chosen) {
      if (!(DISPUTE_EVIDENCE_CONTENT_TYPES as readonly string[]).includes(file.type)) {
        setIssue(t("issues.type"));
        return;
      }
      if (file.size === 0 || file.size > DISPUTE_EVIDENCE_MAX_BYTES) {
        setIssue(t("issues.size", { max: Math.floor(DISPUTE_EVIDENCE_MAX_BYTES / (1024 * 1024)) }));
        return;
      }
    }

    setUploading(true);
    try {
      for (const file of chosen) {
        // One at a time, so a failure halfway leaves the files that DID
        // upload listed rather than losing the whole batch.
        const upload = await uploadFile<{ storageObjectKey: string }>(
          "/trader/evidence-uploads",
          file
        );

        setAttachments((current) => [
          ...current,
          {
            name: file.name,
            contentType: file.type,
            sizeBytes: file.size,
            storageObjectKey: upload.storageObjectKey,
          },
        ]);
      }
    } catch {
      // Deliberately generic: the upload endpoint's own message is a
      // developer string, and a partial batch may have succeeded — the
      // list below shows exactly which files did.
      setIssue(t("issues.uploadFailed"));
    } finally {
      setUploading(false);
      // Lets the same file be chosen again after a failure.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeAttachment(index: number) {
    // Removes it from THIS dispute. The uploaded object is not deleted
    // — no endpoint exists for that — and it simply stays unattached,
    // with `usedInDisputeId` null.
    setAttachments((current) => current.filter((_, i) => i !== index));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    if (trimmed.length < DISPUTE_DESCRIPTION_MIN_LENGTH) {
      setIssue(t("issues.descriptionShort", { min: DISPUTE_DESCRIPTION_MIN_LENGTH }));
      setFailure(null);
      descriptionRef.current?.focus();
      return;
    }
    if (trimmed.length > DISPUTE_DESCRIPTION_MAX_LENGTH) {
      setIssue(t("issues.descriptionLong", { max: DISPUTE_DESCRIPTION_MAX_LENGTH }));
      setFailure(null);
      descriptionRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setIssue(null);
    setFailure(null);

    // Keyed by the ALLOCATION: one dispute per allocation is the thing
    // being made idempotent, and the key survives a reload so a retry
    // after a lost response is recognisable as a retry rather than a
    // second dispute.
    const key = claimKey("dispute-open", orderAllocationId);

    try {
      const dispute = await apiClient.post<{ id: string }>(
        `/trader/order-allocations/${orderAllocationId}/disputes`,
        {
          reasonCode,
          description: trimmed,
          evidenceStorageObjectKeys: attachments.map((a) => a.storageObjectKey),
        },
        { idempotencyKey: key }
      );

      releaseKey("dispute-open", orderAllocationId);

      // Navigates to the dispute the SERVER created. Only reached when
      // the request actually succeeded, so nothing here can claim a
      // dispute opened when the transaction did not complete.
      router.push(`/${locale}/trader/disputes/${dispute.id}`);
    } catch (error) {
      // Every input stays on screen — the reason, the text, and the
      // files already uploaded. Making someone retype a description
      // they just wrote, and re-upload photos already on the server, is
      // the worst possible response to a transient failure.
      const userFacing = toUserFacingError(error);
      setFailure(userFacing);
      setTerminal(isTerminalFailure(userFacing));
      setSubmitting(false);
    }
  }

  function retryAfterTerminalFailure() {
    releaseKey("dispute-open", orderAllocationId);
    setTerminal(false);
    setFailure(null);
  }

  return (
    <form onSubmit={submit} noValidate aria-label={t("title")} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={reasonId} className="text-sm font-medium text-content">
          {t("reasonLabel")}
        </label>
        {/* A closed vocabulary from the contract, so the options are
            exactly what the server's enum accepts. */}
        <Select
          id={reasonId}
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value as DisputeReasonCode)}
        >
          {DISPUTE_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {t(`reason.${code}`)}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={descriptionId} className="text-sm font-medium text-content">
          {t("descriptionLabel")}
        </label>
        <Textarea
          id={descriptionId}
          ref={descriptionRef}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          maxLength={DISPUTE_DESCRIPTION_MAX_LENGTH}
          className="rounded-md border border-line bg-background p-3 text-content"
        />
      </div>

      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="text-sm font-medium text-content">{t("evidenceLabel")}</legend>
        <p className="text-sm text-content-muted">
          {t("evidenceHint", {
            max: DISPUTE_EVIDENCE_MAX_COUNT,
            size: Math.floor(DISPUTE_EVIDENCE_MAX_BYTES / (1024 * 1024)),
          })}
        </p>

        <input
          ref={fileRef}
          type="file"
          multiple
          // Exactly what the server accepts, so the picker cannot offer
          // a file that would be rejected.
          accept={DISPUTE_EVIDENCE_CONTENT_TYPES.join(",")}
          disabled={busy || attachments.length >= DISPUTE_EVIDENCE_MAX_COUNT}
          onChange={(e) => addFiles(e.target.files)}
          aria-label={t("evidenceLabel")}
          className="text-sm text-content file:me-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-sm file:text-content"
        />

        {attachments.length > 0 ? (
          <ul className="flex list-none flex-col gap-2">
            {attachments.map((attachment, index) => (
              <li
                key={`${attachment.name}-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2 text-sm"
              >
                {/* The file's OWN name, type and size — never the
                    storage key, and no download link: there is no
                    authorised delivery endpoint, so any link would be
                    forged from the key. */}
                <span className="min-w-0 flex-1 break-all text-content">{attachment.name}</span>
                <span className="text-content-muted">
                  {t("fileMeta", {
                    type: attachment.contentType,
                    kb: Math.max(1, Math.round(attachment.sizeBytes / 1024)),
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(index)}
                  disabled={busy}
                  className="inline-flex min-h-control items-center rounded-control px-control-x py-control-y text-[length:var(--control-font-size)] leading-[var(--control-line-height)] border border-line text-content hover:bg-background"
                >
                  {t("removeFile")}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {uploading ? (
          <p role="status" aria-live="polite" className="text-sm text-content-muted">
            {t("uploading")}
          </p>
        ) : null}
      </fieldset>

      <div id={errorId} role="alert" aria-live="assertive" className="empty:hidden">
        {issue ? (
          <p className="rounded-md border border-danger bg-background p-3 text-sm text-danger-text">
            {issue}
          </p>
        ) : failure ? (
          <div className="flex flex-col gap-1 rounded-md border border-danger bg-background p-3 text-sm">
            <p className="font-medium text-danger-text">{states("errorTitle")}</p>
            <p className="text-content">{root(failure.messageKey)}</p>
            {failure.requestId ? (
              <p className="text-content-muted">
                {states("requestIdLabel")}:{" "}
                <span className="font-mono">{failure.requestId}</span>
              </p>
            ) : null}
            {/* Says plainly what did and did not happen. Files already
                uploaded are still attached to this form. */}
            <p className="text-content-muted">{t("notOpened")}</p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          isLoading={submitting}
          disabled={busy}
          onClick={terminal ? retryAfterTerminalFailure : undefined}
        >
          {submitting ? t("submitting") : terminal ? t("retry") : t("submit")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push(orderHref)} disabled={busy}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
