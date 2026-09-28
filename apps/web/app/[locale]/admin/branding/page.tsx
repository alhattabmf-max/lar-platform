import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import {
  loadAdminBranding,
  loadAdminBrandTheme,
  loadAdminFooter,
  loadBrandLogos,
} from "@/lib/admin-data";
import { formatDateTime } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandIdentityForm } from "@/components/admin/brand-identity-form";
import { ErrorState } from "@/components/ui/states";
import { BrandThemeEditor } from "@/components/admin/brand-theme-editor";
import { BrandLogoManager } from "@/components/admin/brand-logo-manager";
import { FooterEditor } from "@/components/admin/footer-editor";

/**
 * The site's identity: its names, its logos, and its colours.
 *
 * THE NAMES AND DESCRIPTIONS ARE EDITABLE. They were read-only while
 * `PUT /admin/branding` accepted all four, which left the one thing an
 * operator could not change about their own platform being its name. The
 * form writes those four fields and nothing else.
 *
 * THE LOGO URL FIELDS ARE STILL NOT OFFERED. `UpdateBrandingDto` takes
 * five `@IsUrl()` fields —
 * free-text destinations for the main logo, the small logo, the favicon,
 * the invoice logo and the email logo. A text box for a URL that the
 * public site, every invoice and every outgoing email then loads is a
 * surface this portal does not open: a pasted address would be fetched
 * by every visitor's browser and embedded in documents sent to
 * customers. Changing them stays an operational task with its own
 * review, and the page says so rather than leaving the omission to look
 * like an unfinished screen.
 *
 * THE COLOURS ARE EDITABLE, because they are four validated hex values
 * that cannot reference anything off-site, and because a contrast check
 * runs before anything can go live.
 */

/**
 * The tab's name. The layout supplies « | لوحة التحكم ».
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as AppLocale,
    namespace: "admin.branding",
  });
  return { title: t("title") };
}

export default async function AdminBrandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({
    locale: appLocale,
    namespace: "admin.branding",
  });
  const states = await getTranslations({
    locale: appLocale,
    namespace: "states",
  });
  const actions = await getTranslations({
    locale: appLocale,
    namespace: "admin.actions",
  });

  const tFooter = await getTranslations({
    locale: appLocale,
    namespace: "admin.footer",
  });

  const [branding, theme, logos, footer] = await Promise.all([
    loadAdminBranding(),
    loadAdminBrandTheme(),
    loadBrandLogos(),
    loadAdminFooter(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">
          {t("identityTitle")}
        </h2>

        {!branding.ok ? (
          <ErrorState
            title={states("errorTitle")}
            description={states("errorDescription")}
            requestId={branding.error.requestId}
            requestIdLabel={states("requestIdLabel")}
          />
        ) : branding.data === null ? (
          // A real state on a fresh installation, reported rather than
          // papered over with empty strings.
          <p className="text-sm text-content-muted">
            {t("identityNotConfigured")}
          </p>
        ) : (
          <Card>
            <CardBody className="flex flex-col gap-4">
              {/* A FORM, NOT A LIST. All four fields were rendered
                  read-only while `PUT /admin/branding` accepted every one
                  of them — so the one thing an operator could not change
                  about their own platform was what it is called. */}
              <BrandIdentityForm
                current={branding.data}
                labels={{
                  nameAr: t("nameAr"),
                  nameEn: t("nameEn"),
                  shortDescriptionAr: t("shortDescriptionAr"),
                  shortDescriptionEn: t("shortDescriptionEn"),
                  save: t("identitySave"),
                  working: actions("working"),
                  saved: t("identitySaved"),
                  required: actions("required"),
                  errorTitle: states("errorTitle"),
                  requestIdLabel: states("requestIdLabel"),
                  errorName: t("identityErrorName"),
                  hint: t("identityHint"),
                }}
              />
              <p className="text-xs text-content-muted">
                {t("updatedAt")}:{" "}
                <time dateTime={branding.data.updatedAt}>
                  {formatDateTime(branding.data.updatedAt, appLocale)}
                </time>
              </p>
            </CardBody>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">
          {t("themeTitle")}
        </h2>

        {!theme.ok ? (
          <ErrorState
            title={states("errorTitle")}
            description={states("errorDescription")}
            requestId={theme.error.requestId}
            requestIdLabel={states("requestIdLabel")}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{t("themeTitle")}</CardTitle>
            </CardHeader>
            <CardBody>
              <BrandThemeEditor
                view={theme.data}
                labels={{
                  // colorLabel / issueContrast / issueFormat are absent
                  // on purpose: they take a runtime argument, and a
                  // function cannot be serialized across the
                  // server/client boundary. BrandThemeEditor resolves
                  // them itself.
                  draftTitle: t("draftTitle"),
                  activeTitle: t("activeTitle"),
                  noDraft: t("noDraft"),
                  contrastPasses: t("contrastPasses"),
                  contrastFails: t("contrastFails"),
                  saveDraft: t("saveDraft"),
                  publish: t("publish"),
                  publishPrompt: t("publishPrompt"),
                  reset: t("reset"),
                  resetPrompt: t("resetPrompt"),
                  confirm: t("confirm"),
                  cancel: t("cancel"),
                  working: t("working"),
                  saved: t("saved"),
                  invalidHex: t("invalidHex"),
                  errorTitle: states("errorTitle"),
                  requestIdLabel: states("requestIdLabel"),
                }}
              />
            </CardBody>
          </Card>
        )}
      </section>

      {/*
        THE THIRD SECTION, on this page rather than its own.

        A logo is part of the identity, and a separate screen would mean
        an operator changing the brand has to visit two places and
        remember both — plus one more entry in an admin sidebar that is
        already long.
      */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">
          {t("logosTitle")}
        </h2>

        {!logos.ok ? (
          <ErrorState
            title={states("errorTitle")}
            description={states("errorDescription")}
            requestId={logos.error.requestId}
            requestIdLabel={states("requestIdLabel")}
          />
        ) : (
          <Card>
            <CardBody>
              <BrandLogoManager
                view={logos.data}
                labels={{
                  // `logoUploadFor`, `logoReplace` and `logoConstraints`
                  // are NOT passed: each carries a placeholder — the
                  // language, or a limit — and the values come from the
                  // shared constant, so the component resolves them
                  // itself rather than being handed a half-rendered
                  // string with `{locale}` still in it.
                  present: t("logoPresent"),
                  missing: t("logoMissing"),
                  publish: t("logoPublish"),
                  published: t("logoPublished"),
                  unpublished: t("logoUnpublished"),
                  publishNeedsBoth: t("logoPublishNeedsBoth"),
                  deleteSet: t("logoDelete"),
                  deletePrompt: t("logoDeletePrompt"),
                  deleteConfirm: t("logoDeleteConfirm"),
                  cancel: t("cancel"),
                  working: t("working"),
                  errorTitle: states("errorTitle"),
                  requestIdLabel: states("requestIdLabel"),
                }}
              />
            </CardBody>
          </Card>
        )}
      </section>

      {/*
        THE FOURTH SECTION, here for the same reason the logos are.

        What the footer says is part of the site's identity — its name,
        its address, the accounts it points at. Splitting it onto its own
        screen would mean an operator setting up a platform visits two
        places and remembers both, and adds an entry to a sidebar that is
        already long.
      */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">
          {tFooter("title")}
        </h2>

        {!footer.ok ? (
          <ErrorState
            title={states("errorTitle")}
            description={states("errorDescription")}
            requestId={footer.error.requestId}
            requestIdLabel={states("requestIdLabel")}
          />
        ) : (
          <Card>
            <CardBody>
              <FooterEditor
                view={footer.data}
                labels={{
                  publishedTitle: tFooter("publishedTitle"),
                  draftTitle: tFooter("draftTitle"),
                  noDraft: tFooter("noDraft"),
                  linksTitle: tFooter("linksTitle"),
                  linksHint: tFooter("linksHint"),
                  moveUp: tFooter("moveUp"),
                  moveDown: tFooter("moveDown"),
                  enabled: tFooter("enabled"),
                  labelAr: tFooter("labelAr"),
                  labelEn: tFooter("labelEn"),
                  labelHint: tFooter("labelHint"),
                  addLink: tFooter("addLink"),
                  removeLink: tFooter("removeLink"),
                  contactTitle: tFooter("contactTitle"),
                  email: tFooter("email"),
                  phone: tFooter("phone"),
                  addressAr: tFooter("addressAr"),
                  addressEn: tFooter("addressEn"),
                  socialTitle: tFooter("socialTitle"),
                  socialHint: tFooter("socialHint"),
                  socialUrl: tFooter("socialUrl"),
                  addSocial: tFooter("addSocial"),
                  removeSocial: tFooter("removeSocial"),
                  invalidSocialUrl: tFooter("invalidSocialUrl"),
                  copyrightTitle: tFooter("copyrightTitle"),
                  copyrightAr: tFooter("copyrightAr"),
                  copyrightEn: tFooter("copyrightEn"),
                  showDescription: tFooter("showDescription"),
                  previewTitle: tFooter("previewTitle"),
                  previewHint: tFooter("previewHint"),
                  policyUnpublished: tFooter("policyUnpublished"),
                  saveDraft: tFooter("saveDraft"),
                  publish: tFooter("publish"),
                  publishPrompt: tFooter("publishPrompt"),
                  discard: tFooter("discard"),
                  discardPrompt: tFooter("discardPrompt"),
                  confirm: t("confirm"),
                  cancel: t("cancel"),
                  working: t("working"),
                  saved: t("saved"),
                  errorTitle: states("errorTitle"),
                  requestIdLabel: states("requestIdLabel"),
                }}
              />
            </CardBody>
          </Card>
        )}
      </section>
    </div>
  );
}
