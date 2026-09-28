import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import {
  loadCommissionPolicy,
  loadCommissionTaxPolicy,
  loadShareTierPolicy,
  loadShippingTariff,
  loadTaxRate,
} from "@/lib/admin-data";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { SettingsGroupForm } from "@/components/admin/settings-group-form";
import { Riyal } from "@/components/ui/riyal";
import { ShareTierEditor } from "@/components/admin/share-tier-editor";

/**
 * The money settings, each on its own endpoint with its own bounds.
 *
 * These are the five the generic registry deliberately refuses to
 * touch. Four of them are POLICY-VERSIONED: saving appends a version
 * rather than overwriting, and an opportunity already published keeps
 * the version it was priced against. That is why the current version
 * number is shown beside each — an operator who changes a commission
 * needs to know the change applies from here forward, not backwards.
 *
 * NOTHING ABOUT THE RULES IS DECIDED HERE. The bounds carried on each
 * field are quoted from the server's DTO so the browser can refuse the
 * obvious cases early; the refusal that counts is still the server's,
 * and it is the one whose message is shown.
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
  return { title: t("financial.title") };
}

export default async function AdminFinancialSettingsPage({
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
        <h1 className="text-2xl font-semibold text-content">{t("financial.title")}</h1>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={5} />}>
        <FinancialGroups locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function FinancialGroups({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.settings" });
  const states = await getTranslations({ locale, namespace: "states" });

  const [commission, commissionTax, tax, shareTiers, shipping] = await Promise.all([
    loadCommissionPolicy(),
    loadCommissionTaxPolicy(),
    loadTaxRate(),
    loadShareTierPolicy(),
    loadShippingTariff(),
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

  const failed = (result: { ok: false; error: { requestId: string | null } }) => (
    <ErrorState
      title={states("errorTitle")}
      description={states("errorDescription")}
      requestId={result.error.requestId}
      requestIdLabel={states("requestIdLabel")}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      {/* ---- commission: basis points, versioned ---- */}
      <Card>
        <CardHeader>
          <CardTitle>{t("commission.title")}</CardTitle>
          {commission.ok ? (
            <p className="text-sm text-content-muted">
              {t("version", { version: commission.data.version })}
            </p>
          ) : null}
        </CardHeader>
        <CardBody>
          {commission.ok ? (
            <SettingsGroupForm
              path="/admin/settings/commission"
              initial={{ rateBasisPoints: commission.data.rateBasisPoints }}
              labels={formLabels}
              fields={[
                {
                  kind: "int",
                  name: "rateBasisPoints",
                  label: t("commission.rateBasisPoints"),
                  unit: t("unit.basisPoints"),
                  min: 0,
                  max: 10000,
                },
              ]}
            />
          ) : (
            failed(commission)
          )}
        </CardBody>
      </Card>

      {/* ---- tax on the commission itself, versioned ---- */}
      <Card>
        <CardHeader>
          <CardTitle>{t("commissionTax.title")}</CardTitle>
          {commissionTax.ok ? (
            <p className="text-sm text-content-muted">
              {t("version", { version: commissionTax.data.version })}
            </p>
          ) : null}
        </CardHeader>
        <CardBody>
          {commissionTax.ok ? (
            <SettingsGroupForm
              path="/admin/settings/commission-tax"
              initial={{
                ratePercent: commissionTax.data.ratePercent,
                ruleCode: commissionTax.data.ruleCode,
                ruleVersion: commissionTax.data.ruleVersion,
              }}
              labels={formLabels}
              fields={[
                {
                  kind: "decimal",
                  name: "ratePercent",
                  label: t("commissionTax.ratePercent"),
                  unit: t("unit.percent"),
                  min: 0,
                  max: 100,
                },
                { kind: "text", name: "ruleCode", label: t("commissionTax.ruleCode") },
                { kind: "text", name: "ruleVersion", label: t("commissionTax.ruleVersion") },
              ]}
            />
          ) : (
            failed(commissionTax)
          )}
        </CardBody>
      </Card>

      {/* ---- the default VAT rate ---- */}
      <Card>
        <CardHeader>
          <CardTitle>{t("tax.title")}</CardTitle>
          {tax.ok && tax.data.version !== null ? (
            <p className="text-sm text-content-muted">
              {t("version", { version: tax.data.version })}
            </p>
          ) : null}
        </CardHeader>
        <CardBody>
          {tax.ok ? (
            <SettingsGroupForm
              path="/admin/settings/tax"
              initial={{ ratePercent: tax.data.ratePercent ?? "" }}
              labels={formLabels}
              fields={[
                {
                  kind: "decimal",
                  name: "ratePercent",
                  label: t("tax.ratePercent"),
                  unit: t("unit.percent"),
                  min: 0,
                  max: 100,
                },
              ]}
            />
          ) : (
            failed(tax)
          )}
        </CardBody>
      </Card>

      {/* ---- the share ladder: a list, not a set of fields ---- */}
      <Card>
        <CardHeader>
          <CardTitle>{t("shareTiers.title")}</CardTitle>
          {shareTiers.ok ? (
            <p className="text-sm text-content-muted">
              {t("version", { version: shareTiers.data.version })}
            </p>
          ) : null}
        </CardHeader>
        <CardBody>
          {shareTiers.ok ? (
            <ShareTierEditor
              initialTiers={shareTiers.data.tiers}
              labels={{
                ceiling: t("shareTiers.ceiling"),
                share: t("shareTiers.share"),
                openEnded: t("shareTiers.openEnded"),
                addTier: t("shareTiers.addTier"),
                removeTier: t("shareTiers.removeTier"),
                emptyTitle: t("shareTiers.emptyTitle"),
                save: t("save"),
                working: t("working"),
                saved: t("saved"),
                errorTitle: states("errorTitle"),
                requestIdLabel: states("requestIdLabel"),
              }}
            />
          ) : (
            failed(shareTiers)
          )}
        </CardBody>
      </Card>

      {/* ---- shipping tariff, versioned; the provider code is not ours ---- */}
      <Card>
        <CardHeader>
          <CardTitle>{t("shippingTariff.title")}</CardTitle>
          {shipping.ok ? (
            <p className="text-sm text-content-muted">
              {t("version", { version: shipping.data.version })} · {shipping.data.providerCode}
            </p>
          ) : null}
        </CardHeader>
        <CardBody>
          {shipping.ok ? (
            <SettingsGroupForm
              path="/admin/settings/shipping-tariff"
              initial={{
                sameCityFeeAmount: shipping.data.sameCityFeeAmount,
                sameRegionDifferentCityFeeAmount:
                  shipping.data.sameRegionDifferentCityFeeAmount,
                differentRegionFeeAmount: shipping.data.differentRegionFeeAmount,
              }}
              labels={formLabels}
              fields={[
                {
                  kind: "decimal",
                  name: "sameCityFeeAmount",
                  label: t("shippingTariff.sameCity"),
                  // THE MARK, not the two letters. `sr-only` keeps
                  // what a screen reader used to hear.
                  unit: (
                    <>
                      <Riyal />
                      <span className="sr-only">{t("unit.sar")}</span>
                    </>
                  ),
                  min: 0,
                },
                {
                  kind: "decimal",
                  name: "sameRegionDifferentCityFeeAmount",
                  label: t("shippingTariff.sameRegion"),
                  // THE MARK, not the two letters. `sr-only` keeps
                  // what a screen reader used to hear.
                  unit: (
                    <>
                      <Riyal />
                      <span className="sr-only">{t("unit.sar")}</span>
                    </>
                  ),
                  min: 0,
                },
                {
                  kind: "decimal",
                  name: "differentRegionFeeAmount",
                  label: t("shippingTariff.differentRegion"),
                  // THE MARK, not the two letters. `sr-only` keeps
                  // what a screen reader used to hear.
                  unit: (
                    <>
                      <Riyal />
                      <span className="sr-only">{t("unit.sar")}</span>
                    </>
                  ),
                  min: 0,
                },
              ]}
            />
          ) : (
            failed(shipping)
          )}
        </CardBody>
      </Card>
    </div>
  );
}
