import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminPolicies, loadPolicyRegistrationReadiness } from "@/lib/admin-data";
import { ErrorState } from "@/components/ui/states";
import { PolicyManager } from "@/components/admin/policy-manager";
import { policyDocumentLabel } from "@/lib/policy-labels";

/**
 * The platform's legal documents, at last writable.
 *
 * THE TABLES WERE ALWAYS THERE and always in use: registration refuses
 * to complete unless every mandatory published version is accepted, the
 * public viewer renders them, and every acceptance points at a version
 * id. What was missing was any way to WRITE them — the two documents in
 * force carry seventy characters of placeholder text apiece.
 *
 * THE WARNING AT THE TOP IS NOT DECORATION. `assertMandatoryPoliciesAccepted`
 * answers REGISTRATION_UNAVAILABLE when no mandatory published version
 * exists, so withdrawing the last one closes registration platform-wide.
 * That fact belongs on the screen that can cause it.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as AppLocale,
    namespace: "admin.policies",
  });
  return { title: t("title") };
}

export default async function AdminPoliciesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.policies" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const actions = await getTranslations({ locale: appLocale, namespace: "admin.actions" });
  const publicPolicies = await getTranslations({
    locale: appLocale,
    namespace: "policies",
  });

  const [documents, readiness] = await Promise.all([
    loadAdminPolicies(),
    loadPolicyRegistrationReadiness(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
      </header>

      {/* WHETHER ANYONE CAN REGISTER RIGHT NOW. Not a new rule — the
          service has always refused registration with no mandatory
          published policy — but until now nothing said so out loud. */}
      {readiness.ok && !readiness.data.registrationOpen ? (
        <div className="rounded-lg border border-danger bg-danger-surface p-4">
          <p className="text-sm font-medium text-content">
            {t("registrationClosedTitle")}
          </p>
          <p className="text-sm text-danger-text">
            {t("registrationClosedDescription")}
          </p>
        </div>
      ) : null}

      {!documents.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={documents.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : (
        <PolicyManager
          documents={documents.data}
          labels={{
            documentsTitle: t("documentsTitle"),
            addDocument: t("addDocument"),
            documentCode: t("documentCode"),
            documentCodeHint: t("documentCodeHint"),
            create: t("create"),
            cancel: actions("cancel"),
            save: t("save"),
            working: actions("working"),
            // The same resolver the public viewer and registration use,
            // so one document is never called two names — applied here,
            // because a function cannot be handed to a client component.
            documentNames: Object.fromEntries(
              documents.data.map((document) => [
                document.code,
                policyDocumentLabel(document.code, (known) =>
                  publicPolicies(`documents.${known}`),
                ),
              ]),
            ),
            versionsTitle: t("versionsTitle"),
            newVersion: t("newVersion"),
            newVersionFrom: t("newVersionFrom"),
            editDraft: t("editDraft"),
            versionLabel: t("versionLabel"),
            versionLabelHint: t("versionLabelHint"),
            textAr: t("textAr"),
            textEn: t("textEn"),
            textHint: t("textHint"),
            isMandatory: t("isMandatory"),
            isMandatoryHint: t("isMandatoryHint"),
            requiresReacceptance: t("requiresReacceptance"),
            requiresReacceptanceHint: t("requiresReacceptanceHint"),
            yes: t("yes"),
            no: t("no"),
            published: t("published"),
            draft: t("draft"),
            publishedAt: t("publishedAt"),
            acceptances: t("acceptances"),
            publish: t("publish"),
            publishPrompt: t("publishPrompt"),
            preview: t("preview"),
            hidePreview: t("hidePreview"),
            confirm: actions("confirm"),
            noVersions: t("noVersions"),
            readOnlyPublished: t("readOnlyPublished"),
            required: actions("required"),
            errorTitle: states("errorTitle"),
            requestIdLabel: states("requestIdLabel"),
          }}
        />
      )}
    </div>
  );
}
