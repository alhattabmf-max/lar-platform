import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadPlatformBillingProfile } from "@/lib/admin-data";
import { loadCities } from "@/lib/marketplace-data";
import { formatDateTime } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { ButtonLink } from "@/components/ui/button";
import { PlatformBillingProfileForm } from "@/components/admin/platform-billing-profile-form";

/**
 * The platform's own billing identity.
 *
 * VERSIONED, NEVER EDITED. Creating a new profile writes a new version;
 * the previous ones stay exactly as they were, because documents already
 * issued were computed against them and must remain reproducible. There
 * is no update endpoint anywhere in the API, and this screen does not
 * pretend otherwise — the button says which version it will create.
 *
 * INVOICE DRAFTS ARE RAISED PER ORDER, on the order's own page — they
 * need a `masterOrderId` and there is no platform-wide "issue invoices"
 * operation to offer. The page links there rather than leaving an
 * operator looking for a button that does not exist.
 *
 * THE ADDRESS IS SHOWN ONLY WHERE IT IS UNDERSTOOD. `addressSnapshot` is
 * an unvalidated blob, so the two keys this platform writes — `city` and
 * `shortAddress`, its own address vocabulary — are rendered as rows and
 * anything else is left alone rather than printed as raw JSON.
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
    namespace: "admin.invoicing",
  });
  return { title: t("title") };
}

export default async function AdminInvoicingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.invoicing" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const [result, cities] = await Promise.all([
    loadPlatformBillingProfile(),
    loadCities(),
  ]);
  const profile = result.ok ? result.data : null;

  // The address is a declared shape now, so these are fields rather than
  // guesses at a blob. A version written before the shape existed comes
  // back with empty strings, which read as "not recorded".
  const cityName =
    appLocale === "ar-SA"
      ? profile?.addressSnapshot.cityNameAr
      : profile?.addressSnapshot.cityNameEn;
  const shortAddress = profile?.addressSnapshot.shortAddress;

  const formLabels = {
    legalName: t("legalName"),
    crNumber: t("crNumber"),
    vatRegistered: t("vatRegistered"),
    vatNumber: t("vatNumber"),
    city: t("city"),
    cityPlaceholder: t("cityPlaceholder"),
    shortAddress: t("shortAddress"),
    yes: t("vatYes"),
    no: t("vatNo"),
    required: t("required"),
    create: t("create"),
    // Resolved here because the page knows the number, and a function
    // cannot be handed to a client component.
    newVersion: profile ? t("newVersion", { version: profile.version + 1 }) : "",
    working: t("working"),
    saved: t("saved"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
    errorLegalName: t("errorLegalName"),
    errorCrNumber: t("errorCrNumber"),
    errorVatNumber: t("errorVatNumber"),
    errorAddress: t("errorAddress"),
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
      </header>

      {!result.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : (
        <>
          {profile === null ? (
            // A real state on a fresh installation. Reported plainly, with
            // what it means: no invoice document can be issued until a
            // billing identity exists — and the form to fix it is below.
            <div className="rounded-lg border border-warning bg-warning-surface p-4">
              <p className="text-sm font-medium text-content">{t("notConfiguredTitle")}</p>
              <p className="text-sm text-warning-text">{t("notConfiguredDescription")}</p>
            </div>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{t("profileTitle")}</CardTitle>
              </CardHeader>
              <CardBody>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("version")}</dt>
                    <dd className="text-content">{profile.version}</dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("legalName")}</dt>
                    <dd className="text-content">{profile.legalName}</dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("crNumber")}</dt>
                    <dd className="font-mono text-content">{profile.crNumber}</dd>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <dt className="text-content-muted">{t("vatRegistered")}</dt>
                    <dd>
                      <StatusBadge
                        label={profile.isVatRegistered ? t("vatYes") : t("vatNo")}
                        tone={profile.isVatRegistered ? "done" : "neutral"}
                      />
                    </dd>
                  </div>
                  {/* Shown only when registered. A VAT number on a profile
                      that is not VAT-registered would be a contradiction, and
                      an empty row invites someone to wonder if it is missing. */}
                  {profile.isVatRegistered ? (
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-content-muted">{t("vatNumber")}</dt>
                      <dd className="font-mono text-content">{profile.vatNumber ?? "—"}</dd>
                    </div>
                  ) : null}
                  {cityName ? (
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-content-muted">{t("city")}</dt>
                      {/* THE NAME AS IT WAS when this version was written,
                          not as the city is called today: the document
                          computed against this version has to keep
                          reading the same. */}
                      <dd className="text-content">{cityName}</dd>
                    </div>
                  ) : null}
                  {shortAddress ? (
                    <div className="flex flex-wrap gap-2">
                      <dt className="text-content-muted">{t("shortAddress")}</dt>
                      <dd className="font-mono text-content">{shortAddress}</dd>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <dt className="text-content-muted">{t("createdAt")}</dt>
                    <dd className="text-content">
                      <time dateTime={profile.createdAt}>
                        {formatDateTime(profile.createdAt, appLocale)}
                      </time>
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>
                {profile === null ? t("formTitleCreate") : t("formTitleNew")}
              </CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <p className="text-sm text-content-muted">
                {profile === null ? t("formIntroCreate") : t("formIntroNew")}
              </p>
              <PlatformBillingProfileForm
            current={profile}
            cities={
              cities.ok
                ? cities.data.map((city) => ({
                    id: city.id,
                    name: appLocale === "ar-SA" ? city.nameAr : city.nameEn,
                  }))
                : []
            }
            labels={formLabels}
          />
            </CardBody>
          </Card>
        </>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("draftsTitle")}</h2>
        <div>
          <ButtonLink href={`/${appLocale}/admin/orders`} variant="secondary" size="sm">
            {t("openOrders")}
          </ButtonLink>
        </div>
      </section>

      <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-content-muted">
        {t("versioningNotice")}
      </p>
    </div>
  );
}
