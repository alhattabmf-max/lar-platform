"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  FOOTER_LIMITS,
  FOOTER_PAGES,
  FOOTER_PAGE_KEYS,
  FOOTER_SOCIAL_NETWORK_KEYS,
  isAllowedSocialUrl,
  type FooterConfig,
  type FooterLink,
  type FooterPageKey,
  type FooterSocialNetwork,
} from "@platform/types";
import type { AdminFooterView } from "@/lib/admin-data";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * The site footer: arrange, check, publish.
 *
 * NO JSON ANYWHERE ON THIS SCREEN. An operator moves a link with two
 * buttons, switches it off with a checkbox, and types a telephone
 * number into a telephone field. The stored value is JSON; that is an
 * implementation detail of the column, and asking someone to hand-write
 * it would put a syntax error between them and their own footer.
 *
 * THERE IS NO FIELD FOR AN INTERNAL DESTINATION. Every link is chosen
 * from the list the platform defines and the app resolves the route.
 * That is what makes "the footer cannot point off-site" a property of
 * the design rather than of a validator.
 *
 * A SOCIAL ADDRESS IS THE ONE PLACE A URL IS TYPED, and it is checked
 * against that network's own hosts as it is typed — by the SAME
 * function the server uses, imported from the shared contract rather
 * than reimplemented. The two cannot disagree about what counts as a
 * LinkedIn address.
 *
 * THE PREVIEW IS THE DRAFT, DRAWN. It is what makes publishing a
 * decision rather than a leap: the operator sees the order, the
 * wording, and — crucially — which links the site will actually show,
 * since a policy that is not published is struck through here rather
 * than silently missing later.
 */

export interface FooterEditorLabels {
  publishedTitle: string;
  draftTitle: string;
  noDraft: string;
  linksTitle: string;
  linksHint: string;
  moveUp: string;
  moveDown: string;
  enabled: string;
  labelAr: string;
  labelEn: string;
  labelHint: string;
  addLink: string;
  removeLink: string;
  contactTitle: string;
  email: string;
  phone: string;
  addressAr: string;
  addressEn: string;
  socialTitle: string;
  socialHint: string;
  socialUrl: string;
  addSocial: string;
  removeSocial: string;
  invalidSocialUrl: string;
  copyrightTitle: string;
  copyrightAr: string;
  copyrightEn: string;
  showDescription: string;
  previewTitle: string;
  previewHint: string;
  policyUnpublished: string;
  saveDraft: string;
  publish: string;
  publishPrompt: string;
  discard: string;
  discardPrompt: string;
  confirm: string;
  cancel: string;
  working: string;
  saved: string;
  errorTitle: string;
  requestIdLabel: string;
}

const emptyContact = {
  email: null,
  phone: null,
  addressAr: null,
  addressEn: null,
};

/** An empty field means "not set", which is null — never an empty string. */
const orNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : value;
};

export function FooterEditor({
  view,
  labels,
}: {
  view: AdminFooterView;
  labels: FooterEditorLabels;
}) {
  const router = useRouter();
  const t = useTranslations();
  const ids = useId();

  // Seeded from the DRAFT when one exists, otherwise from what is
  // live. Starting from the shipped default instead would quietly
  // offer to overwrite a published footer with something nobody chose.
  const [config, setConfig] = useState<FooterConfig>(
    view.draft ?? view.published,
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [confirming, setConfirming] = useState<"publish" | "discard" | null>(
    null,
  );

  const published = new Set(view.publishedPolicyCodes);

  /** Whether this destination will actually render on the site. */
  const willRender = (key: FooterPageKey): boolean => {
    const page = FOOTER_PAGES[key];
    const code = "policyCode" in page ? page.policyCode : undefined;
    return code === undefined || published.has(code);
  };

  const patch = (next: Partial<FooterConfig>) => {
    setConfig((current) => ({ ...current, ...next }));
    setSaved(false);
  };

  const patchLink = (index: number, next: Partial<FooterLink>) => {
    patch({
      links: config.links.map((link, i) =>
        i === index ? { ...link, ...next } : link,
      ),
    });
  };

  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= config.links.length) return;
    const links = [...config.links];
    [links[index], links[target]] = [links[target], links[index]];
    patch({ links });
  };

  const unusedPages = FOOTER_PAGE_KEYS.filter(
    (key) => !config.links.some((link) => link.page === key),
  );
  const unusedNetworks = FOOTER_SOCIAL_NETWORK_KEYS.filter(
    (network) => !config.social.some((entry) => entry.network === network),
  );

  /**
   * Every social address that is present and does not belong to its
   * network. Publishing is blocked on these rather than left to fail at
   * the server with a message about a request body.
   */
  const badSocial = config.social.filter(
    (entry) => entry.url.length > 0 && !isAllowedSocialUrl(entry.network, entry.url),
  );

  const run = async (fn: () => Promise<unknown>) => {
    // A second click while the first request is in flight would send a
    // second publish. `disabled` on the button is the visible half of
    // this; the guard is the half that holds when a keystroke or a
    // double-tap outruns the re-render.
    if (busy) return;
    setBusy(true);
    setError(null);
    setConfirming(null);
    try {
      await fn();
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(toUserFacingError(err));
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () =>
    run(() => apiClient.put("/admin/branding/footer/draft", config));

  const publish = () =>
    // Saved first, deliberately: publish promotes what is STORED, so
    // publishing without saving would put the previous draft live and
    // leave the operator certain they had published what was on screen.
    run(async () => {
      await apiClient.put("/admin/branding/footer/draft", config);
      await apiClient.post("/admin/branding/footer/publish", {});
    });

  const discard = () =>
    run(async () => {
      await apiClient.delete("/admin/branding/footer/draft");
      setConfig(view.published);
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge
          tone={view.draft ? "attention" : "neutral"}
          label={view.draft ? labels.draftTitle : labels.noDraft}
        />
      </div>

      {/* ---------- links ---------- */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-content">
            {labels.linksTitle}
          </h3>
          <p className="text-sm text-content-muted">{labels.linksHint}</p>
        </div>

        <ul className="flex list-none flex-col gap-3">
          {config.links.map((link, index) => (
            <li
              key={link.page}
              className="flex flex-col gap-3 rounded border border-line p-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-content">
                  {t(`shell.footer.${link.page}`)}
                </span>
                {!willRender(link.page) ? (
                  <StatusBadge
                    tone="attention"
                    label={labels.policyUnpublished}
                  />
                ) : null}

                <div className="ms-auto flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => move(index, -1)}
                    disabled={index === 0 || busy}
                    aria-label={`${labels.moveUp}: ${t(`shell.footer.${link.page}`)}`}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => move(index, 1)}
                    disabled={index === config.links.length - 1 || busy}
                    aria-label={`${labels.moveDown}: ${t(`shell.footer.${link.page}`)}`}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      patch({
                        links: config.links.filter((_, i) => i !== index),
                      })
                    }
                    disabled={busy}
                  >
                    {labels.removeLink}
                  </Button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-content">
                <input
                  type="checkbox"
                  checked={link.enabled}
                  onChange={(e) =>
                    patchLink(index, { enabled: e.target.checked })
                  }
                  disabled={busy}
                />
                {labels.enabled}
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${ids}-ar-${link.page}`}>
                    {labels.labelAr}
                  </Label>
                  <Input
                    id={`${ids}-ar-${link.page}`}
                    value={link.labelAr ?? ""}
                    maxLength={FOOTER_LIMITS.label}
                    placeholder={t(`shell.footer.${link.page}`)}
                    onChange={(e) =>
                      patchLink(index, { labelAr: orNull(e.target.value) })
                    }
                    disabled={busy}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${ids}-en-${link.page}`}>
                    {labels.labelEn}
                  </Label>
                  <Input
                    id={`${ids}-en-${link.page}`}
                    value={link.labelEn ?? ""}
                    maxLength={FOOTER_LIMITS.label}
                    onChange={(e) =>
                      patchLink(index, { labelEn: orNull(e.target.value) })
                    }
                    disabled={busy}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>

        <p className="text-xs text-content-muted">{labels.labelHint}</p>

        {unusedPages.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-content-muted">
              {labels.addLink}
            </span>
            {unusedPages.map((key) => (
              <Button
                key={key}
                type="button"
                variant="secondary"
                onClick={() =>
                  patch({
                    links: [
                      ...config.links,
                      { page: key, labelAr: null, labelEn: null, enabled: true },
                    ],
                  })
                }
                disabled={busy}
              >
                {t(`shell.footer.${key}`)}
              </Button>
            ))}
          </div>
        ) : null}
      </section>

      {/* ---------- contact ---------- */}
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-content">
          {labels.contactTitle}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-email`}>{labels.email}</Label>
            <Input
              id={`${ids}-email`}
              type="email"
              dir="ltr"
              value={config.contact.email ?? ""}
              maxLength={FOOTER_LIMITS.email}
              onChange={(e) =>
                patch({
                  contact: {
                    ...(config.contact ?? emptyContact),
                    email: orNull(e.target.value),
                  },
                })
              }
              disabled={busy}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-phone`}>{labels.phone}</Label>
            <Input
              id={`${ids}-phone`}
              type="tel"
              dir="ltr"
              value={config.contact.phone ?? ""}
              maxLength={FOOTER_LIMITS.phone}
              onChange={(e) =>
                patch({
                  contact: {
                    ...(config.contact ?? emptyContact),
                    phone: orNull(e.target.value),
                  },
                })
              }
              disabled={busy}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-address-ar`}>{labels.addressAr}</Label>
            <Input
              id={`${ids}-address-ar`}
              value={config.contact.addressAr ?? ""}
              maxLength={FOOTER_LIMITS.address}
              onChange={(e) =>
                patch({
                  contact: {
                    ...(config.contact ?? emptyContact),
                    addressAr: orNull(e.target.value),
                  },
                })
              }
              disabled={busy}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-address-en`}>{labels.addressEn}</Label>
            <Input
              id={`${ids}-address-en`}
              value={config.contact.addressEn ?? ""}
              maxLength={FOOTER_LIMITS.address}
              onChange={(e) =>
                patch({
                  contact: {
                    ...(config.contact ?? emptyContact),
                    addressEn: orNull(e.target.value),
                  },
                })
              }
              disabled={busy}
            />
          </div>
        </div>
      </section>

      {/* ---------- social ---------- */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-content">
            {labels.socialTitle}
          </h3>
          <p className="text-sm text-content-muted">{labels.socialHint}</p>
        </div>

        <ul className="flex list-none flex-col gap-3">
          {config.social.map((entry, index) => {
            const invalid =
              entry.url.length > 0 &&
              !isAllowedSocialUrl(entry.network, entry.url);
            return (
              <li
                key={entry.network}
                className="flex flex-col gap-2 rounded border border-line p-3"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium text-content">
                    {t(`shell.footerSocial.${entry.network}`)}
                  </span>
                  <label className="flex items-center gap-2 text-sm text-content">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(e) =>
                        patch({
                          social: config.social.map((s, i) =>
                            i === index
                              ? { ...s, enabled: e.target.checked }
                              : s,
                          ),
                        })
                      }
                      disabled={busy}
                    />
                    {labels.enabled}
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    className="ms-auto"
                    onClick={() =>
                      patch({
                        social: config.social.filter((_, i) => i !== index),
                      })
                    }
                    disabled={busy}
                  >
                    {labels.removeSocial}
                  </Button>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${ids}-social-${entry.network}`}>
                    {labels.socialUrl}
                  </Label>
                  <Input
                    id={`${ids}-social-${entry.network}`}
                    dir="ltr"
                    value={entry.url}
                    maxLength={FOOTER_LIMITS.socialUrl}
                    aria-invalid={invalid || undefined}
                    aria-describedby={
                      invalid ? `${ids}-social-err-${entry.network}` : undefined
                    }
                    onChange={(e) =>
                      patch({
                        social: config.social.map((s, i) =>
                          i === index ? { ...s, url: e.target.value } : s,
                        ),
                      })
                    }
                    disabled={busy}
                  />
                  {invalid ? (
                    <p
                      id={`${ids}-social-err-${entry.network}`}
                      className="text-sm text-danger"
                    >
                      {labels.invalidSocialUrl}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {unusedNetworks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-content-muted">
              {labels.addSocial}
            </span>
            {unusedNetworks.map((network: FooterSocialNetwork) => (
              <Button
                key={network}
                type="button"
                variant="secondary"
                onClick={() =>
                  patch({
                    social: [
                      ...config.social,
                      { network, url: "", enabled: true },
                    ],
                  })
                }
                disabled={busy}
              >
                {t(`shell.footerSocial.${network}`)}
              </Button>
            ))}
          </div>
        ) : null}
      </section>

      {/* ---------- copyright ---------- */}
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-content">
          {labels.copyrightTitle}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-copy-ar`}>{labels.copyrightAr}</Label>
            <Input
              id={`${ids}-copy-ar`}
              value={config.copyrightAr ?? ""}
              maxLength={FOOTER_LIMITS.copyright}
              onChange={(e) => patch({ copyrightAr: orNull(e.target.value) })}
              disabled={busy}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-copy-en`}>{labels.copyrightEn}</Label>
            <Input
              id={`${ids}-copy-en`}
              value={config.copyrightEn ?? ""}
              maxLength={FOOTER_LIMITS.copyright}
              onChange={(e) => patch({ copyrightEn: orNull(e.target.value) })}
              disabled={busy}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-content">
          <input
            type="checkbox"
            checked={config.showDescription}
            onChange={(e) => patch({ showDescription: e.target.checked })}
            disabled={busy}
          />
          {labels.showDescription}
        </label>
      </section>

      {/* ---------- preview ---------- */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-content">
            {labels.previewTitle}
          </h3>
          <p className="text-sm text-content-muted">{labels.previewHint}</p>
        </div>
        <div className="rounded border border-line bg-surface-muted p-4">
          <ul className="flex list-none flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            {config.links
              .filter((link) => link.enabled)
              .map((link) => (
                <li
                  key={link.page}
                  className={
                    willRender(link.page)
                      ? "text-content"
                      : "text-content-muted line-through"
                  }
                >
                  {link.labelAr ?? t(`shell.footer.${link.page}`)}
                </li>
              ))}
          </ul>
          {config.social.some((s) => s.enabled) ? (
            <ul className="mt-2 flex list-none flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-content-muted">
              {config.social
                .filter((s) => s.enabled)
                .map((s) => (
                  <li key={s.network}>{t(`shell.footerSocial.${s.network}`)}</li>
                ))}
            </ul>
          ) : null}
          <div className="mt-2 flex flex-col items-center gap-1 text-center text-sm text-content-muted">
            {config.contact.email ? <span>{config.contact.email}</span> : null}
            {config.contact.phone ? (
              <span dir="ltr">{config.contact.phone}</span>
            ) : null}
            {config.contact.addressAr ? (
              <span>{config.contact.addressAr}</span>
            ) : null}
            {config.copyrightAr ? (
              <span className="text-xs">{config.copyrightAr}</span>
            ) : null}
          </div>
        </div>
      </section>

      {/* ---------- actions ---------- */}
      {error ? (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-sm font-medium text-danger">{labels.errorTitle}</p>
          <p className="text-sm text-content-muted">{t(error.messageKey)}</p>
          {error.requestId ? (
            <p className="text-xs text-content-muted">
              {labels.requestIdLabel}: {error.requestId}
            </p>
          ) : null}
        </div>
      ) : null}

      {confirming ? (
        <div className="flex flex-col gap-2 rounded border border-line p-3">
          <p className="text-sm text-content">
            {confirming === "publish"
              ? labels.publishPrompt
              : labels.discardPrompt}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={confirming === "publish" ? publish : discard}
              disabled={busy}
            >
              {labels.confirm}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirming(null)}
              disabled={busy}
            >
              {labels.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={saveDraft} disabled={busy}>
            {busy ? labels.working : labels.saveDraft}
          </Button>
          <Button
            type="button"
            onClick={() => setConfirming("publish")}
            // A social address that is not on its network would be
            // refused by the server; blocking here says why, in the
            // field that is wrong.
            disabled={busy || badSocial.length > 0}
          >
            {labels.publish}
          </Button>
          {view.draft ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirming("discard")}
              disabled={busy}
            >
              {labels.discard}
            </Button>
          ) : null}
          {saved ? (
            <span className="text-sm text-content-muted">{labels.saved}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
