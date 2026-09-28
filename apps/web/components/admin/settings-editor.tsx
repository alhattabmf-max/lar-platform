"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import type { AdminSettingItem } from "@/lib/admin-data";

/**
 * One registry setting.
 *
 * `adminWritable` IS HONOURED HERE. A setting marked false renders as a
 * read-only value with no control at all — not a disabled input, not a
 * greyed button. The server refuses the write regardless, so this is a
 * courtesy rather than the rule, but drawing an editor for something
 * that cannot be saved is the kind of courtesy that wastes an
 * operator's afternoon.
 *
 * ONLY `boolean` AND `enum` ARE EDITABLE HERE. The `json` settings —
 * homepage content and header navigation — are edited on the content
 * screen, which has a field per value and validates each against the
 * shared limits. A raw JSON textarea for them would be a way to paste an
 * arbitrary object into a setting the public homepage reads, which is
 * precisely what the field-by-field editor exists to prevent.
 *
 * A boolean is a SELECT of two named options rather than a checkbox. The
 * stored value has three meaningful states — true, false, and never set
 * — and a checkbox cannot show the third: an unset setting would render
 * unchecked and read as a deliberate "off".
 */
/**
 * Database key → the message that NAMES it for an operator.
 *
 * A closed map on purpose. The registry may grow a key at any time, and
 * the failure mode has to be a generic label rather than the identifier
 * leaking back onto the screen — which is the bug this map exists to
 * fix. A new key showing "إعداد" is a prompt to name it; a new key
 * showing `promotional_banner_policy` is the old bug returning.
 */
const SETTING_NAMES: Record<string, string> = {
  email_verification_enabled: "emailVerification",
  company_verification_mode: "companyVerification",
  homepage_content: "homepageContent",
  promotional_banner_policy: "bannerPolicy",
  faq_items: "faqItems",
  header_nav: "headerNav",
};

export function SettingEditor({
  setting,
  labels,
}: {
  setting: AdminSettingItem;
  labels: {
    value: string;
    notSet: string;
    yes: string;
    no: string;
    readOnly: string;
    save: string;
    working: string;
    saved: string;
    editElsewhere: string;
    errorTitle: string;
    requestIdLabel: string;
    /** Shown for a registry key this build has no name for. */
    unnamed: string;
  };
}) {
  const router = useRouter();
  const root = useTranslations();
  const ids = useId();

  const nameKey = SETTING_NAMES[setting.key];
  const name = nameKey ? root(`admin.settings.names.${nameKey}`) : labels.unnamed;

  const initial =
    setting.value === null || setting.value === undefined ? "" : String(setting.value);

  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const editable =
    setting.adminWritable && (setting.type === "boolean" || setting.type === "enum");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !editable || value === "") return;

    setBusy(true);
    setFailure(null);
    setSaved(false);

    try {
      await apiClient.put(`/admin/settings/${encodeURIComponent(setting.key)}`, {
        // A boolean setting is sent as a real boolean. The registry's
        // validator is `typeof value === "boolean"`, so the string
        // "true" is rejected — correctly, because a setting stored as a
        // string would then fail every read that expects a boolean.
        value: setting.type === "boolean" ? value === "true" : value,
      });
      setSaved(true);
      setBusy(false);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  const current =
    setting.value === null || setting.value === undefined
      ? labels.notSet
      : setting.type === "boolean"
        ? setting.value === true
          ? labels.yes
          : labels.no
        : String(setting.value);

  return (
    <div className="flex flex-col gap-3 rounded-card bg-surface shadow-card px-card-x py-card-y">
      <div className="flex flex-col gap-1">
        {/* THE NAME, NOT THE COLUMN. `setting.key` is a database
            identifier and `setting.description` is a paragraph written
            for whoever maintains the registry — English, and full of
            words like "getBoolean fallback". Neither belongs on an
            operator's screen, so neither is rendered.

            The map is closed: a key with no name here shows the generic
            label rather than falling back to the identifier, because
            falling back to the identifier is the bug being fixed. */}
        <p className="text-sm font-medium text-content">{name}</p>
      </div>

      {editable ? (
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-value`}>{labels.value}</Label>
            <Select
              id={`${ids}-value`}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setSaved(false);
              }}
            >
              {/* The unset state is offered as an option only while the
                  setting IS unset, so it can be shown without becoming a
                  way to un-set something deliberately configured. */}
              {initial === "" ? <option value="">{labels.notSet}</option> : null}
              {setting.type === "boolean" ? (
                <>
                  <option value="true">{labels.yes}</option>
                  <option value="false">{labels.no}</option>
                </>
              ) : (
                (setting.allowedValues ?? []).map((allowed) => (
                  <option key={allowed} value={allowed}>
                    {allowed}
                  </option>
                ))
              )}
            </Select>
          </div>

          {failure ? (
            <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger p-3">
              <p className="text-sm font-medium text-content">{labels.errorTitle}</p>
              <p className="text-sm text-content-muted">{root(failure.messageKey)}</p>
              {failure.requestId ? (
                <p className="text-xs text-content-muted">
                  {labels.requestIdLabel}:{" "}
                  <span className="font-mono">{failure.requestId}</span>
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
            <Button
              type="submit"
              size="sm"
             
              isLoading={busy}
              disabled={busy || value === "" || value === initial}
            >
              {busy ? labels.working : labels.save}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-content">
            <span className="text-content-muted">{labels.value}: </span>
            {setting.type === "json" ? labels.editElsewhere : current}
          </p>
          {!setting.adminWritable ? (
            <p className="text-xs text-content-muted">{labels.readOnly}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
