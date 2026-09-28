import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import {
  loadCheckoutSettings,
  loadFulfillmentSettings,
  loadOpportunitySettings,
  loadPaymentSettings,
} from "@/lib/admin-data";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { SettingsGroupForm } from "@/components/admin/settings-group-form";

/**
 * The operating settings: what the platform does while a purchase is in
 * flight, and what an offer is allowed to be.
 *
 * None of these are policy-versioned — they take effect at once, on the
 * next checkout or the next publish. That is the difference from the
 * financial screen, and it is why the version line is absent here
 * rather than showing a nil.
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
  return { title: t("operations.title") };
}

export default async function AdminOperationsSettingsPage({
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
        <h1 className="text-2xl font-semibold text-content">{t("operations.title")}</h1>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <OperationsGroups locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function OperationsGroups({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.settings" });
  const states = await getTranslations({ locale, namespace: "states" });

  const [checkout, payment, fulfillment, opportunity] = await Promise.all([
    loadCheckoutSettings(),
    loadPaymentSettings(),
    loadFulfillmentSettings(),
    loadOpportunitySettings(),
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

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("checkout.title")}</CardTitle>
        </CardHeader>
        <CardBody>
          {checkout.ok ? (
            <SettingsGroupForm
              path="/admin/settings/checkout"
              initial={{ ...checkout.data }}
              labels={formLabels}
              fields={[
                {
                  kind: "int",
                  name: "lockDurationMinutes",
                  label: t("checkout.lockDurationMinutes"),
                  unit: t("unit.minutes"),
                  min: 1,
                  max: 180,
                },
                {
                  kind: "int",
                  name: "abuseThresholdCount",
                  label: t("checkout.abuseThresholdCount"),
                  min: 1,
                  max: 20,
                },
                {
                  kind: "int",
                  name: "abuseWindowMinutes",
                  label: t("checkout.abuseWindowMinutes"),
                  unit: t("unit.minutes"),
                  min: 1,
                  max: 1440,
                },
                {
                  kind: "int",
                  name: "cooldownMinutes",
                  label: t("checkout.cooldownMinutes"),
                  unit: t("unit.minutes"),
                  min: 1,
                  max: 1440,
                },
              ]}
            />
          ) : (
            failed(checkout)
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("payment.title")}</CardTitle>
        </CardHeader>
        <CardBody>
          {payment.ok ? (
            <SettingsGroupForm
              path="/admin/settings/payment"
              initial={{ ...payment.data }}
              labels={formLabels}
              fields={[
                {
                  kind: "int",
                  name: "paymentAttemptTimeoutMinutes",
                  label: t("payment.attemptTimeout"),
                  unit: t("unit.minutes"),
                  min: 1,
                  max: 180,
                },
              ]}
            />
          ) : (
            failed(payment)
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("fulfillment.title")}</CardTitle>
        </CardHeader>
        <CardBody>
          {fulfillment.ok ? (
            <SettingsGroupForm
              path="/admin/settings/fulfillment"
              initial={{ ...fulfillment.data }}
              labels={formLabels}
              fields={[
                {
                  kind: "decimal",
                  name: "lateThresholdPercent",
                  label: t("fulfillment.lateThreshold"),
                  unit: t("unit.percent"),
                  min: 100,
                  max: 1000,
                },
                {
                  kind: "decimal",
                  name: "criticalThresholdPercent",
                  label: t("fulfillment.criticalThreshold"),
                  unit: t("unit.percent"),
                  min: 100,
                  max: 1000,
                },
              ]}
            />
          ) : (
            failed(fulfillment)
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("opportunity.title")}</CardTitle>
        </CardHeader>
        <CardBody>
          {opportunity.ok ? (
            <SettingsGroupForm
              path="/admin/settings/opportunity"
              initial={{ ...opportunity.data }}
              labels={formLabels}
              fields={[
                {
                  kind: "int",
                  name: "minDurationHours",
                  label: t("opportunity.minDurationHours"),
                  unit: t("unit.hours"),
                  min: 1,
                  max: 720,
                },
                {
                  kind: "int",
                  name: "maxDurationDays",
                  label: t("opportunity.maxDurationDays"),
                  unit: t("unit.days"),
                  min: 1,
                  max: 90,
                },
                {
                  kind: "int",
                  name: "minTargetQuantity",
                  label: t("opportunity.minTargetQuantity"),
                  unit: t("unit.units"),
                  min: 1,
                  max: 1000000,
                },
                {
                  kind: "int",
                  name: "maxTargetQuantity",
                  // A HUNDRED MILLION, matching the service and the
                  // DTO. This field read 10,000,000 while the value in
                  // force is 100,000,000 — so the form could not save
                  // the configuration the platform was already running,
                  // and the whole group was unsavable. The same
                  // mismatch was corrected in `SetOpportunitySettings`
                  // and this was the last place still carrying it.
                  label: t("opportunity.maxTargetQuantity"),
                  unit: t("unit.units"),
                  min: 1,
                  max: 100000000,
                },
                {
                  kind: "boolean",
                  name: "showScheduledPubliclyEnabled",
                  label: t("opportunity.showScheduledPublicly"),
                },
                {
                  // HOW MANY DAYS one extension adds. There is
                  // deliberately no field for HOW MANY TIMES a listing
                  // may be extended: `opportunities.extended_at` is a
                  // single timestamp that records THAT a listing was
                  // extended, never how often, so the number cannot be
                  // made configurable without a schema change.
                  kind: "int",
                  name: "extensionDays",
                  label: t("opportunity.extensionDays"),
                  unit: t("unit.days"),
                  min: 1,
                  max: 30,
                },
              ]}
            />
          ) : (
            failed(opportunity)
          )}
        </CardBody>
      </Card>
    </div>
  );
}
