import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminBranding, loadAdminBrandTheme } from "@/lib/admin-data";
import { formatDateTime } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { BrandThemeEditor } from "@/components/admin/brand-theme-editor";

/**
 * The site's identity: its names, its logos, and its colours.
 *
 * THE NAMES AND DESCRIPTIONS ARE READ-ONLY HERE, and the logo fields are
 * not offered at all. `UpdateBrandingDto` takes five `@IsUrl()` fields —
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
export default async function AdminBrandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.branding" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const [branding, theme] = await Promise.all([loadAdminBranding(), loadAdminBrandTheme()]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("identityTitle")}</h2>
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-content-muted">
          {t("identityReadOnlyNotice")}
        </p>

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
          <p className="text-sm text-content-muted">{t("identityNotConfigured")}</p>
        ) : (
          <Card>
            <CardBody>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="flex flex-wrap gap-2">
                  <dt className="text-content-muted">{t("nameAr")}</dt>
                  <dd className="text-content">{branding.data.nameAr ?? "—"}</dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <dt className="text-content-muted">{t("nameEn")}</dt>
                  <dd className="text-content">{branding.data.nameEn ?? "—"}</dd>
                </div>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <dt className="text-content-muted">{t("shortDescriptionAr")}</dt>
                  <dd className="whitespace-pre-wrap text-content">
                    {branding.data.shortDescriptionAr ?? "—"}
                  </dd>
                </div>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <dt className="text-content-muted">{t("shortDescriptionEn")}</dt>
                  <dd className="whitespace-pre-wrap text-content">
                    {branding.data.shortDescriptionEn ?? "—"}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <dt className="text-content-muted">{t("updatedAt")}</dt>
                  <dd className="text-content">
                    <time dateTime={branding.data.updatedAt}>
                      {formatDateTime(branding.data.updatedAt, appLocale)}
                    </time>
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("themeTitle")}</h2>
        <p className="text-sm text-content-muted">{t("themeHint")}</p>

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
    </div>
  );
}
