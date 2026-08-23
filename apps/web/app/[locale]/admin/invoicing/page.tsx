import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadPlatformBillingProfile } from "@/lib/admin-data";
import { formatDateTime } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { StatusBadge } from "@/components/trader/status-badge";
import { ButtonLink } from "@/components/ui/button";

/**
 * The platform's own billing identity.
 *
 * VERSIONED, NEVER EDITED. Creating a new profile writes a new version;
 * the previous ones stay exactly as they were, because documents already
 * issued were computed against them and must remain reproducible. There
 * is no update endpoint anywhere in the API, and this screen does not
 * pretend otherwise.
 *
 * INVOICE DRAFTS ARE RAISED PER ORDER, on the order's own page — they
 * need a `masterOrderId` and there is no platform-wide "issue invoices"
 * operation to offer. The page links there rather than leaving an
 * operator looking for a button that does not exist.
 *
 * `addressSnapshot` is not shown. It is an unvalidated JSON blob kept
 * for document generation, and rendering arbitrary JSON on a screen is
 * not a display of an address.
 *
 * Creating a new version is NOT offered here. It takes a structured
 * address object the API validates as an opaque `@IsObject()`, with no
 * declared field shape to build a form against — inventing one would
 * mean this screen deciding what a legal address is, which is exactly
 * the sort of guess that ends up on a tax document.
 */
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

  const result = await loadPlatformBillingProfile();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      {!result.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : result.data === null ? (
        // A real state on a fresh installation. Reported plainly, with
        // what it means: no invoice document can be issued until a
        // billing identity exists.
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
                <dd className="text-content">{result.data.version}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("legalName")}</dt>
                <dd className="text-content">{result.data.legalName}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("crNumber")}</dt>
                <dd className="font-mono text-content">{result.data.crNumber}</dd>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <dt className="text-content-muted">{t("vatRegistered")}</dt>
                <dd>
                  <StatusBadge
                    label={result.data.isVatRegistered ? t("vatYes") : t("vatNo")}
                    tone={result.data.isVatRegistered ? "done" : "neutral"}
                  />
                </dd>
              </div>
              {/* Shown only when registered. A VAT number on a profile
                  that is not VAT-registered would be a contradiction, and
                  an empty row invites someone to wonder if it is missing. */}
              {result.data.isVatRegistered ? (
                <div className="flex flex-wrap gap-2">
                  <dt className="text-content-muted">{t("vatNumber")}</dt>
                  <dd className="font-mono text-content">{result.data.vatNumber ?? "—"}</dd>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <dt className="text-content-muted">{t("createdAt")}</dt>
                <dd className="text-content">
                  <time dateTime={result.data.createdAt}>
                    {formatDateTime(result.data.createdAt, appLocale)}
                  </time>
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-content">{t("draftsTitle")}</h2>
        <p className="text-sm text-content-muted">{t("draftsDescription")}</p>
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
