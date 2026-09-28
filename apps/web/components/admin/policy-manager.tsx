"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AdminPolicyDocument, AdminPolicyVersion } from "@platform/types";
import { POLICY_TEXT_MIN, POLICY_VERSION_LABEL_MAX } from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * Writing the platform's legal documents.
 *
 * WHAT THIS SCREEN REPLACES: nothing. There was no way to author a
 * policy at all — the two documents in force carry seventy characters of
 * placeholder text apiece, published, and accepted by everyone who has
 * registered.
 *
 * THE TEXT IS TEXT. Two plain textareas, no rich editor and no markup
 * pipeline: the public viewer renders these with `whitespace-pre-wrap`
 * and never as HTML, so anything that let an author paste markup would
 * either be shown as literal angle brackets or, if that were ever
 * "fixed", become a way to inject a script into every visitor's page.
 *
 * PUBLISHED VERSIONS ARE READ-ONLY HERE, because they are read-only on
 * the server: people accepted that exact wording. Editing a published
 * document means writing a NEW version, which is what the button on a
 * published version offers.
 *
 * NOTHING DELETES. There is no delete control because there is no delete
 * endpoint, and there is no delete endpoint because an acceptance row
 * points at a version id.
 */

export interface PolicyManagerLabels {
  documentsTitle: string;
  addDocument: string;
  documentCode: string;
  documentCodeHint: string;
  create: string;
  cancel: string;
  save: string;
  working: string;
  /**
   * A display name per document code, RESOLVED BY THE PAGE.
   *
   * A record and not a function: a function prop cannot cross the
   * server-to-client boundary — Next refuses to serialise one — and a
   * guard test in this repo enforces that. The page knows every code it
   * loaded, so it can resolve them all before handing them over.
   */
  documentNames: Record<string, string>;

  versionsTitle: string;
  newVersion: string;
  newVersionFrom: string;
  editDraft: string;
  versionLabel: string;
  versionLabelHint: string;
  textAr: string;
  textEn: string;
  textHint: string;
  isMandatory: string;
  isMandatoryHint: string;
  requiresReacceptance: string;
  requiresReacceptanceHint: string;
  yes: string;
  no: string;

  published: string;
  draft: string;
  publishedAt: string;
  acceptances: string;
  publish: string;
  publishPrompt: string;
  preview: string;
  hidePreview: string;
  confirm: string;
  noVersions: string;
  readOnlyPublished: string;

  required: string;
  errorTitle: string;
  requestIdLabel: string;
}

type Draft = {
  /** The document a new version belongs to. */
  documentId: string;
  /** Present when editing an existing draft rather than writing a new one. */
  versionId: string | null;
  versionLabel: string;
  textAr: string;
  textEn: string;
  isMandatory: string;
  requiresReacceptance: string;
};

export function PolicyManager({
  documents,
  labels,
}: {
  documents: readonly AdminPolicyDocument[];
  labels: PolicyManagerLabels;
}) {
  const router = useRouter();
  const root = useTranslations();

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    // ONE AT A TIME. A second press while the first is in flight would
    // send the same instruction twice.
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await work();
      setDraft(null);
      setNewCode(null);
      setConfirming(null);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  const startVersion = (documentId: string, from?: AdminPolicyVersion) =>
    setDraft({
      documentId,
      // Editing an existing DRAFT keeps its id. Starting FROM a
      // published version copies its text into a new one — which is
      // what "edit the terms" actually means once they are in force.
      versionId: from && !from.isPublished ? from.id : null,
      versionLabel: from && !from.isPublished ? from.versionLabel : "",
      textAr: from?.textAr ?? "",
      textEn: from?.textEn ?? "",
      isMandatory: String(from?.isMandatory ?? true),
      requiresReacceptance: String(from?.requiresReacceptance ?? false),
    });

  const draftReady =
    draft !== null &&
    draft.versionLabel.trim().length > 0 &&
    draft.textAr.trim().length >= POLICY_TEXT_MIN &&
    draft.textEn.trim().length >= POLICY_TEXT_MIN;

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      {failure ? (
        <p role="alert" className="text-sm text-danger">
          {labels.errorTitle}: {root(failure.messageKey)}
          {failure.requestId ? (
            <span className="block font-mono text-xs text-content-muted">
              {labels.requestIdLabel} {failure.requestId}
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {newCode === null ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => setNewCode("")}
            data-testid="policy-add-document"
          >
            {labels.addDocument}
          </Button>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2 rounded-md border border-line-strong bg-background px-3 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() =>
                apiClient.post("/admin/policies", { code: newCode.trim() }),
              );
            }}
          >
            {/* The code is the public anchor — it reaches an address bar
                — so it is a slug, and the hint says so before anyone
                types a sentence into it. */}
            <div className="min-w-[16rem] flex-1">
              <Field label={labels.documentCode} required requiredLabel={labels.required}>
                {({ inputId }) => (
                  <Input
                    id={inputId}
                    dir="ltr"
                    className="font-mono"
                    value={newCode}
                    onChange={(event) => setNewCode(event.target.value)}
                    disabled={busy}
                    data-testid="policy-document-code"
                  />
                )}
              </Field>
            </div>
            <Button type="submit" size="sm" disabled={busy || newCode.trim() === ""}>
              {busy ? labels.working : labels.create}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setNewCode(null)}
            >
              {labels.cancel}
            </Button>
            <p className="w-full text-xs text-content-muted">
              {labels.documentCodeHint}
            </p>
          </form>
        )}
      </div>

      {documents.map((document) => (
        <section
          key={document.id}
          className="rounded-lg border border-line bg-surface"
          data-testid={`policy-document-${document.code}`}
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-base font-semibold text-content">
                {labels.documentNames[document.code] ?? document.code}
              </h2>
              <span dir="ltr" className="font-mono text-xs text-content-muted">
                {document.code}
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => startVersion(document.id)}
              data-testid={`policy-new-version-${document.code}`}
            >
              {labels.newVersion}
            </Button>
          </header>

          <div className="flex flex-col gap-3 p-4">
            {document.versions.length === 0 ? (
              <p className="text-sm text-content-muted">{labels.noVersions}</p>
            ) : (
              document.versions.map((version) => (
                <article
                  key={version.id}
                  className="flex flex-col gap-2 rounded-md border border-line p-3"
                  data-testid={`policy-version-${version.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={version.isPublished ? labels.published : labels.draft}
                      tone={version.isPublished ? "done" : "neutral"}
                    />
                    <span className="text-sm font-medium text-content">
                      {version.versionLabel}
                    </span>
                    {version.isMandatory ? (
                      <StatusBadge label={labels.isMandatory} tone="attention" />
                    ) : null}
                    {version.requiresReacceptance ? (
                      <StatusBadge label={labels.requiresReacceptance} tone="neutral" />
                    ) : null}
                    {version.publishedAt ? (
                      <span className="text-xs text-content-muted">
                        {labels.publishedAt}: {version.publishedAt.slice(0, 10)}
                      </span>
                    ) : null}
                    {/* WHY THERE IS NO DELETE, on the row rather than in
                        a comment nobody reads. */}
                    <span className="text-xs text-content-muted">
                      {labels.acceptances}: {version.acceptanceCount}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setPreviewing((current) =>
                          current === version.id ? null : version.id,
                        )
                      }
                      data-testid={`policy-preview-${version.id}`}
                    >
                      {previewing === version.id ? labels.hidePreview : labels.preview}
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => startVersion(document.id, version)}
                      data-testid={`policy-edit-${version.id}`}
                    >
                      {version.isPublished ? labels.newVersionFrom : labels.editDraft}
                    </Button>

                    {/* NO WITHDRAW CONTROL, and not because it was
                        skipped: `policy_versions` has a database trigger
                        that raises on ANY update to a published row and
                        on any delete of one. Publishing is one-way and
                        permanent, so a button for it could only ever
                        meet a 500 — worse than its absence. */}
                    {version.isPublished ? null : confirming ===
                      `publish:${version.id}` ? (
                      <>
                        <span className="text-xs text-content">
                          {labels.publishPrompt}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              apiClient.post(
                                `/admin/policies/versions/${version.id}/publish`,
                              ),
                            )
                          }
                          data-testid={`policy-publish-confirm-${version.id}`}
                        >
                          {labels.confirm}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirming(null)}
                        >
                          {labels.cancel}
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirming(`publish:${version.id}`)}
                        data-testid={`policy-publish-${version.id}`}
                      >
                        {labels.publish}
                      </Button>
                    )}
                  </div>

                  {version.isPublished ? (
                    <p className="text-xs text-content-muted">
                      {labels.readOnlyPublished}
                    </p>
                  ) : null}

                  {previewing === version.id ? (
                    // AS TEXT, exactly as the public viewer renders it.
                    // Nothing here interprets markup, so what an author
                    // sees is what a visitor sees.
                    <div className="grid gap-3 sm:grid-cols-2">
                      <pre
                        dir="rtl"
                        className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-sm text-content"
                      >
                        {version.textAr}
                      </pre>
                      <pre
                        dir="ltr"
                        className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-background p-3 text-sm text-content"
                      >
                        {version.textEn}
                      </pre>
                    </div>
                  ) : null}
                </article>
              ))
            )}

            {draft && draft.documentId === document.id ? (
              <form
                className="flex flex-col gap-3 rounded-md border border-line-strong bg-background p-3"
                data-testid="policy-draft-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!draftReady) return;
                  const body = {
                    versionLabel: draft.versionLabel.trim(),
                    textAr: draft.textAr.trim(),
                    textEn: draft.textEn.trim(),
                    isMandatory: draft.isMandatory === "true",
                    requiresReacceptance: draft.requiresReacceptance === "true",
                  };
                  void run(() =>
                    draft.versionId
                      ? apiClient.patch(
                          `/admin/policies/versions/${draft.versionId}`,
                          body,
                        )
                      : apiClient.post(
                          `/admin/policies/${draft.documentId}/versions`,
                          body,
                        ),
                  );
                }}
              >
                <div className="grid gap-3 sm:grid-cols-6">
                  {/* A version label is a handful of characters. */}
                  <div className="sm:col-span-2">
                    <Field
                      label={labels.versionLabel}
                      required
                      requiredLabel={labels.required}
                    >
                      {({ inputId }) => (
                        <Input
                          id={inputId}
                          maxLength={POLICY_VERSION_LABEL_MAX}
                          value={draft.versionLabel}
                          onChange={(event) =>
                            setDraft({ ...draft, versionLabel: event.target.value })
                          }
                          disabled={busy}
                          data-testid="policy-draft-label"
                        />
                      )}
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label={labels.isMandatory}>
                      {({ inputId }) => (
                        <Select
                          id={inputId}
                          value={draft.isMandatory}
                          onChange={(event) =>
                            setDraft({ ...draft, isMandatory: event.target.value })
                          }
                          disabled={busy}
                          data-testid="policy-draft-mandatory"
                        >
                          <option value="true">{labels.yes}</option>
                          <option value="false">{labels.no}</option>
                        </Select>
                      )}
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label={labels.requiresReacceptance}>
                      {({ inputId }) => (
                        <Select
                          id={inputId}
                          value={draft.requiresReacceptance}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              requiresReacceptance: event.target.value,
                            })
                          }
                          disabled={busy}
                          data-testid="policy-draft-reacceptance"
                        >
                          <option value="true">{labels.yes}</option>
                          <option value="false">{labels.no}</option>
                        </Select>
                      )}
                    </Field>
                  </div>
                </div>

                {/* A legal document is long. Both languages take the full
                    row, side by side on a wide screen so the two can be
                    read against each other. */}
                <div className="grid gap-3 lg:grid-cols-2">
                  <Field label={labels.textAr} required requiredLabel={labels.required}>
                    {({ inputId }) => (
                      <Textarea
                        id={inputId}
                        dir="rtl"
                        rows={16}
                        value={draft.textAr}
                        onChange={(event) =>
                          setDraft({ ...draft, textAr: event.target.value })
                        }
                        disabled={busy}
                        data-testid="policy-draft-ar"
                      />
                    )}
                  </Field>
                  <Field label={labels.textEn} required requiredLabel={labels.required}>
                    {({ inputId }) => (
                      <Textarea
                        id={inputId}
                        dir="ltr"
                        rows={16}
                        value={draft.textEn}
                        onChange={(event) =>
                          setDraft({ ...draft, textEn: event.target.value })
                        }
                        disabled={busy}
                        data-testid="policy-draft-en"
                      />
                    )}
                  </Field>
                </div>

                <p className="text-xs text-content-muted">{labels.textHint}</p>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={busy || !draftReady}
                    data-testid="policy-draft-save"
                  >
                    {busy ? labels.working : labels.save}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft(null)}
                  >
                    {labels.cancel}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}
