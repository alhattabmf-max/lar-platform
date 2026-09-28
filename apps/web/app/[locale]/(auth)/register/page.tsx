import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { PublicPolicyVersion } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { apiClient } from "@/lib/api-client";
import { policyDocumentLabel } from "@/lib/policy-labels";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { RegisterForm } from "@/components/auth/register-form";
import type { PolicyDocument } from "@/components/auth/policies-dialog";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("register");


/**
 * Opening an account.
 *
 * THE KIND IS CHOSEN ON THE FORM, not read from the address. This page
 * used to take it from `?as=supplier` and register a BUYER whenever the
 * parameter was absent — so anybody arriving from anywhere but one
 * particular link got the wrong kind of account without being asked.
 * The choice decides the endpoint, the stored `accountType`, the
 * permissions and the portal, and it now sits in front of the person
 * making it.
 *
 * NO BRANCH IS COLLECTED HERE. A company registers before it has
 * decided where it will operate from; the first branch is added
 * afterwards, from "complete your profile".
 */
async function loadPolicies(
  locale: AppLocale,
  labelFor: (code: string) => string,
): Promise<{ ok: true; policies: PolicyDocument[] } | { ok: false }> {
  try {
    const versions = await apiClient.get<PublicPolicyVersion[]>(
      "/policies/active",
      {
        revalidate: 300,
      },
    );

    return {
      ok: true,
      policies: versions.map((version) => ({
        id: version.id,
        documentCode: version.documentCode,
        title: labelFor(version.documentCode),
        versionLabel: version.versionLabel,
        // The reader's own language. Both texts cross the wire; only
        // one is shown.
        text: locale.startsWith("ar") ? version.textAr : version.textEn,
      })),
    };
  } catch {
    return { ok: false };
  }
}

export default async function RegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  const t = await getTranslations({ locale: appLocale, namespace: "register" });
  const states = await getTranslations({
    locale: appLocale,
    namespace: "states",
  });
  const policies = await getTranslations({
    locale: appLocale,
    namespace: "policies",
  });

  const data = await loadPolicies(appLocale, (code) =>
    policyDocumentLabel(code, (known) => policies(`documents.${known}`)),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t("title")}</CardTitle>
      </CardHeader>
      <CardBody>
        {data.ok ? (
          <>
            <RegisterForm
              locale={appLocale}
              policies={data.policies}
              labels={{
                accountType: {
                  legend: t("accountType.legend"),
                  trader: t("accountType.trader"),
                  traderHint: t("accountType.traderHint"),
                  supplier: t("accountType.supplier"),
                  supplierHint: t("accountType.supplierHint"),
                },
                policiesDialog: {
                  title: t("policies.dialogTitle"),
                  close: t("policies.close"),
                  version: t("policies.version"),
                  unavailable: t("policies.unavailable"),
                },
              }}
            />

            <p className="mt-4 text-sm text-content-muted">
              {t("haveAccount")}{" "}
              <Link
                href={`/${appLocale}/login`}
                className="rounded-sm text-secondary underline underline-offset-2 hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {t("signIn")}
              </Link>
            </p>
          </>
        ) : (
          <ErrorState
            title={states("errorTitle")}
            description={states("errorDescription")}
          />
        )}
      </CardBody>
    </Card>
  );
}
