import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadPayoutHoldDays, loadSecuritySettings } from "@/lib/admin-data";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { SettingsGroupForm } from "@/components/admin/settings-group-form";

/**
 * Security and payout timing.
 *
 * FOUR ENDPOINTS, FOUR FORMS. One GET returns the three login-side
 * values together, but each is written on its own PUT with its own
 * bounds — so a form per endpoint is not a stylistic choice, it is what
 * keeps a save from carrying a value the operator did not touch.
 *
 * THE SESSION DURATION IS IN SECONDS because the endpoint is, and the
 * bound (900–2,592,000) is checked in seconds. Showing minutes and
 * multiplying would put a rounding step between what an operator types
 * and what the platform stores, for the sake of a friendlier box.
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
    namespace: "admin.settings",
  });
  return { title: t("securityGroup.title") };
}

export default async function AdminSecuritySettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.settings" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("securityGroup.title")}</h1>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <SecurityGroups locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function SecurityGroups({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.settings" });
  const states = await getTranslations({ locale, namespace: "states" });

  const [security, payout] = await Promise.all([
    loadSecuritySettings(),
    loadPayoutHoldDays(),
  ]);

  const formLabels = {
    save: t("save"),
    working: t("working"),
    saved: t("saved"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
    yes: t("yes"),
    no: t("no"),
  };

  const failed = (result: { error: { requestId: string | null } }) => (
    <ErrorState
      title={states("errorTitle")}
      description={states("errorDescription")}
      requestId={result.error.requestId}
      requestIdLabel={states("requestIdLabel")}
    />
  );

  const rateFields = (labelKey: string) =>
    [
      {
        kind: "int" as const,
        name: "limit",
        label: t(`${labelKey}.limit`),
        unit: t("unit.attempts"),
        min: 1,
        max: 20,
      },
      {
        kind: "int" as const,
        name: "ttlSeconds",
        label: t(`${labelKey}.ttlSeconds`),
        unit: t("unit.seconds"),
        min: 10,
        max: 300,
      },
    ];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("loginRateLimit.title")}</CardTitle>
        </CardHeader>
        <CardBody>
          {security.ok ? (
            <SettingsGroupForm
              path="/admin/settings/security/login-rate-limit"
              initial={{ ...security.data.loginRateLimit }}
              labels={formLabels}
              fields={rateFields("loginRateLimit")}
            />
          ) : (
            failed(security)
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("twoFaRateLimit.title")}</CardTitle>
        </CardHeader>
        <CardBody>
          {security.ok ? (
            <SettingsGroupForm
              path="/admin/settings/security/2fa-rate-limit"
              initial={{ ...security.data.twoFaRateLimit }}
              labels={formLabels}
              fields={rateFields("twoFaRateLimit")}
            />
          ) : (
            failed(security)
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("sessionDuration.title")}</CardTitle>
        </CardHeader>
        <CardBody>
          {security.ok ? (
            <SettingsGroupForm
              path="/admin/settings/security/session-duration"
              initial={{ seconds: security.data.sessionDurationSeconds }}
              labels={formLabels}
              fields={[
                {
                  kind: "int",
                  name: "seconds",
                  label: t("sessionDuration.seconds"),
                  unit: t("unit.seconds"),
                  min: 900,
                  max: 2592000,
                },
              ]}
            />
          ) : (
            failed(security)
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("payoutHold.title")}</CardTitle>
        </CardHeader>
        <CardBody>
          {payout.ok ? (
            <SettingsGroupForm
              path="/admin/settings/security/payout-hold-days"
              initial={{ days: payout.data.days }}
              labels={formLabels}
              fields={[
                {
                  kind: "int",
                  name: "days",
                  label: t("payoutHold.days"),
                  unit: t("unit.days"),
                  min: 1,
                  max: 30,
                },
              ]}
            />
          ) : (
            failed(payout)
          )}
        </CardBody>
      </Card>
    </div>
  );
}
