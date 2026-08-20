import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { CityItem, PublicPolicyVersion } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { apiClient } from "@/lib/api-client";
import { policyDocumentLabel } from "@/lib/policy-labels";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { RegisterForm, type CityOption, type PolicyOption } from "@/components/auth/register-form";

/**
 * Cities and policies are fetched on the SERVER, so the form arrives
 * already populated rather than flashing empty selects.
 *
 * Both are public reads. If either fails the page shows an error state
 * instead of a half-usable form — registration cannot succeed without a
 * valid city and the mandatory policies, so offering the form anyway
 * would only produce a confusing 400 later.
 *
 * A policy is labelled from its document CODE. There is no title column
 * in the schema, so an untranslated code shows as the code itself
 * rather than as a blank checkbox nobody can consent to meaningfully.
 */
async function loadFormData(
  labelFor: (code: string) => string
): Promise<{ ok: true; cities: CityOption[]; policies: PolicyOption[] } | { ok: false }> {
  try {
    const [cities, policies] = await Promise.all([
      apiClient.get<CityItem[]>("/cities/active", { revalidate: 300 }),
      apiClient.get<PublicPolicyVersion[]>("/policies/active", { revalidate: 300 }),
    ]);

    return {
      ok: true,
      cities: cities.map((c) => ({ id: c.id, nameAr: c.nameAr, nameEn: c.nameEn })),
      policies: policies.map((p) => ({ id: p.id, title: labelFor(p.documentCode) })),
    };
  } catch {
    return { ok: false };
  }
}

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const appLocale = locale as AppLocale;

  const t = await getTranslations({ locale: appLocale, namespace: "register" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  // Closed choice: anything other than an explicit supplier request
  // registers a trader.
  const accountType = query.as === "supplier" ? "SUPPLIER" : "TRADER";

  const policies = await getTranslations({ locale: appLocale, namespace: "policies" });

  const data = await loadFormData((code) =>
    policyDocumentLabel(code, (known) => policies(`documents.${known}`))
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {accountType === "SUPPLIER" ? t("titleSupplier") : t("titleTrader")}
        </CardTitle>
      </CardHeader>
      <CardBody>
        {data.ok ? (
          <>
            <p className="mb-4 text-sm text-content-muted">{t("description")}</p>

            <RegisterForm
              locale={appLocale}
              accountType={accountType}
              cities={data.cities}
              policies={data.policies}
            />

            <p className="mt-4 text-sm">
              {/* The full text is on the public viewer, readable without
                  an account — consent to a policy you cannot read is not
                  consent. */}
              <Link href={`/${appLocale}/policies`} className="text-secondary hover:opacity-90">
                {t("policies.readFull")}
              </Link>
            </p>

            <p className="mt-6 text-sm">
              <Link href={`/${appLocale}/login`} className="text-secondary hover:opacity-90">
                {t("haveAccount")}
              </Link>
            </p>
          </>
        ) : (
          <ErrorState
            title={states("errorTitle")}
            description={states("errorDescription")}
            requestIdLabel={states("requestIdLabel")}
          />
        )}
      </CardBody>
    </Card>
  );
}
