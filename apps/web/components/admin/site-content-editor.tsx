"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  HEADER_NAV_MAX_ITEMS,
  SITE_CONTENT_FIELDS,
  SITE_CONTENT_LIMITS,
  SITE_CONTENT_SETTING_KEY,
  HEADER_NAV_SETTING_KEY,
  type SiteContent,
  type SiteContentField,
} from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

/**
 * Homepage copy and header categories.
 *
 * NOT A CMS. Two settings rows, validated and audited by the machinery
 * that already exists for every other setting — no content table, no
 * versioning, no draft/publish, no migration.
 *
 * TEXT ONLY, and the API stores it as text. Nothing on the public site
 * renders any of this as markup: no HTML, no Markdown, no
 * `dangerouslySetInnerHTML`. A stored-content surface that renders
 * markup is a stored cross-site-scripting hole waiting for one careless
 * paste, and the way to not have one is to never have the code path.
 *
 * THE HEADER HOLDS TAXONOMY IDS, NEVER URLS. An operator picks from the
 * categories that exist; they cannot type a destination. That is why
 * there is nothing to allowlist here and no way to point the site's
 * navigation somewhere else. The names shown in the menu are read from
 * the taxonomy at request time, so renaming a category renames the menu
 * item and there is no second copy to drift.
 *
 * EVERY FIELD IS OPTIONAL. A blank field is sent as null, which means
 * "use the shipped copy" — not "show nothing". The two are the same
 * state and the built-in catalogue is the right answer to both.
 *
 * The reorder controls are BUTTONS, operable from the keyboard. Drag and
 * drop is not offered as the only way to do anything here: it is
 * unusable with a keyboard, unreliable with a screen reader, and awkward
 * on a touch screen.
 */
export interface TaxonomyChoice {
  id: string;
  label: string;
}

export interface SiteContentEditorLabels {
  contentLegend: string;
  navLegend: string;
  arabic: string;
  english: string;
  // fieldLabel, navRemove, navMoveUp and navMoveDown are NOT here. Each
  // needs a runtime argument, and a function cannot cross the
  // server/client boundary — React serializes these props, and passing
  // one throws "Functions cannot be passed directly to Client
  // Components", taking the whole page down as a server-side exception.
  // This is a client component with its own translator.
  blankMeansDefault: string;

  navHint: string;
  navAdd: string;
  navChoose: string;
  navFull: string;
  navEmpty: string;
  navMissing: string;

  save: string;
  working: string;
  saved: string;
  errorTitle: string;
  requestIdLabel: string;
}

type TextState = Record<SiteContentField, { ar: string; en: string }>;

function initialText(content: SiteContent): TextState {
  const state = {} as TextState;
  for (const field of SITE_CONTENT_FIELDS) {
    state[field] = {
      ar: content[field].ar ?? "",
      en: content[field].en ?? "",
    };
  }
  return state;
}

export function SiteContentEditor({
  content,
  taxonomy,
  labels,
}: {
  content: SiteContent;
  /** Active taxonomy nodes the operator may choose from. */
  taxonomy: readonly TaxonomyChoice[];
  labels: SiteContentEditorLabels;
}) {
  const router = useRouter();
  const root = useTranslations();
  const ids = useId();

  const [text, setText] = useState<TextState>(() => initialText(content));
  const [nav, setNav] = useState<string[]>(() =>
    content.headerNav.map((item) => item.taxonomyNodeId)
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const byId = new Map(taxonomy.map((node) => [node.id, node.label]));

  const available = taxonomy.filter((node) => !nav.includes(node.id));
  const [pending, setPending] = useState("");

  function setField(field: SiteContentField, locale: "ar" | "en", value: string) {
    setText((current) => ({ ...current, [field]: { ...current[field], [locale]: value } }));
    setSaved(false);
  }

  function move(index: number, delta: number) {
    setNav((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setSaved(false);

    // Focus follows the item that moved, so a keyboard user can press
    // the same key again without hunting for where the row went.
    // Optional-called: `scrollIntoView` does not exist in jsdom, and a
    // test environment must not be the reason a real interaction throws.
    queueMicrotask(() => {
      const button = document.getElementById(
        `${ids}-nav-${delta < 0 ? "up" : "down"}-${index + delta}`
      );
      button?.focus();
      button?.scrollIntoView?.({ block: "nearest" });
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setFailure(null);
    setSaved(false);

    // A blank field is sent as NULL, not as "". Null means "fall back to
    // the shipped copy"; an empty string would mean the operator chose
    // to show nothing, and the public page would render a gap.
    const payload: Record<string, { ar: string | null; en: string | null }> = {};
    for (const field of SITE_CONTENT_FIELDS) {
      const ar = text[field].ar.trim();
      const en = text[field].en.trim();
      payload[field] = { ar: ar === "" ? null : ar, en: en === "" ? null : en };
    }

    try {
      // Two settings, two writes. They are separate registry keys with
      // separate validators, and there is no combined endpoint to
      // invent — the first succeeding while the second fails leaves the
      // copy saved and the menu unchanged, which is a state an operator
      // can see and correct.
      await apiClient.put(
        `/admin/settings/${SITE_CONTENT_SETTING_KEY}`,
        { value: payload }
      );
      await apiClient.put(`/admin/settings/${HEADER_NAV_SETTING_KEY}`, { value: nav });
      setSaved(true);
      setBusy(false);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <fieldset className="flex flex-col gap-4 rounded-card bg-surface shadow-card px-card-x py-card-y">
        <legend className="px-1 text-base font-medium text-content">
          {labels.contentLegend}
        </legend>
        <p className="text-sm text-content-muted">{labels.blankMeansDefault}</p>

        {SITE_CONTENT_FIELDS.map((field) => (
          <div key={field} className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-${field}-ar`}>
                {root(`admin.content.fields.${field}`)} — {labels.arabic}
              </Label>
              <Input
                id={`${ids}-${field}-ar`}
                // The SHARED limit, not a number retyped here. The server
                // validates against the same constant, so the field
                // cannot accept what the API will reject.
                maxLength={SITE_CONTENT_LIMITS[field]}
                value={text[field].ar}
                onChange={(event) => setField(field, "ar", event.target.value)}
                dir="rtl"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-${field}-en`}>
                {root(`admin.content.fields.${field}`)} — {labels.english}
              </Label>
              <Input
                id={`${ids}-${field}-en`}
                maxLength={SITE_CONTENT_LIMITS[field]}
                value={text[field].en}
                onChange={(event) => setField(field, "en", event.target.value)}
                dir="ltr"
              />
            </div>
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-card bg-surface shadow-card px-card-x py-card-y">
        <legend className="px-1 text-base font-medium text-content">{labels.navLegend}</legend>
        <p className="text-sm text-content-muted">{labels.navHint}</p>

        {nav.length === 0 ? (
          <p className="text-sm text-content-muted">{labels.navEmpty}</p>
        ) : (
          <ol className="flex list-none flex-col gap-2">
            {nav.map((id, index) => {
              // A configured node that no longer exists or is no longer
              // active. The public header drops it silently; here it is
              // named, because an operator needs to know why their menu
              // is shorter than their list.
              const label = byId.get(id) ?? labels.navMissing;

              return (
                <li
                  key={id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2"
                >
                  <span className="flex-1 text-sm text-content">{label}</span>

                  <Button
                    type="button"
                    id={`${ids}-nav-up-${index}`}
                    variant="ghost"
                    size="sm"
                   
                    // Disabled only at the ends, where there is genuinely
                    // nowhere to move.
                    disabled={index === 0}
                    aria-label={root("admin.content.navMoveUp", { label })}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    id={`${ids}-nav-down-${index}`}
                    variant="ghost"
                    size="sm"
                   
                    disabled={index === nav.length - 1}
                    aria-label={root("admin.content.navMoveDown", { label })}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                   
                    aria-label={root("admin.content.navRemove", { label })}
                    onClick={() => {
                      setNav((current) => current.filter((value) => value !== id));
                      setSaved(false);
                    }}
                  >
                    ✕
                  </Button>
                </li>
              );
            })}
          </ol>
        )}

        {nav.length >= HEADER_NAV_MAX_ITEMS ? (
          <p className="text-sm text-content-muted">{labels.navFull}</p>
        ) : available.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <Label htmlFor={`${ids}-nav-add`}>{labels.navChoose}</Label>
              <Select
                id={`${ids}-nav-add`}
                value={pending}
                onChange={(event) => setPending(event.target.value)}
              >
                <option value="">{labels.navChoose}</option>
                {available.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
             
              disabled={pending === ""}
              onClick={() => {
                if (pending === "") return;
                setNav((current) => [...current, pending]);
                setPending("");
                setSaved(false);
              }}
            >
              {labels.navAdd}
            </Button>
          </div>
        ) : null}
      </fieldset>

      {failure ? (
        <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger p-3">
          <p className="text-sm font-medium text-content">{labels.errorTitle}</p>
          <p className="text-sm text-content-muted">{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="text-xs text-content-muted">
              {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {saved ? (
        <p role="status" className="text-sm text-content">
          {labels.saved}
        </p>
      ) : null}

      <div>
        <Button type="submit" isLoading={busy} disabled={busy}>
          {busy ? labels.working : labels.save}
        </Button>
      </div>
    </form>
  );
}
