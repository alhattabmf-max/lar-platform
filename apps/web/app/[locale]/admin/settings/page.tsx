import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminSettings } from "@/lib/admin-data";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { SettingEditor } from "@/components/admin/settings-editor";

/**
 * The generic settings registry.
 *
 * A SHORT, EXPLICIT ALLOW-LIST — not a window onto the
 * `system_settings` table. A key absent from the registry can never be
 * read or written through this screen, full stop.
 *
 * Rate limits, the 2FA rate limit, session duration, tax, commission,
 * shipping tariffs, payment and fulfilment are deliberately NOT here.
 * Each has its own endpoint with its own bounds and its own policy
 * versioning; surfacing them through a generic editor would create a
 * second, unvalidated way to write the same value. The page names that
 * boundary rather than leaving their absence to look like a gap.
 *
 * `adminWritable` is honoured per setting by the editor below.
 *
 * THE FOUR TYPED GROUPS ARE LINKED ABOVE. Their absence from the list
 * below is deliberate, but an operator cannot be expected to infer that
 * from silence — so this screen is also the way in to them.
 */
const SETTINGS_GROUPS = [
  { key: "financial", segment: "financial" },
  { key: "operations", segment: "operations" },
  { key: "securityGroup", segment: "security" },
  { key: "mediaGroup", segment: "media" },
] as const;


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
  return { title: t("title") };
}

export default async function AdminSettingsPage({
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
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
      </header>


      {/* THE TYPED GROUPS, which this screen deliberately does not edit.
          Each has its own endpoint, its own bounds and — for four of
          them — its own policy version. Naming them here is what stops
          their absence from the list below reading as a gap. */}
      <nav aria-label={t("groupsLabel")}>
        <ul className="grid list-none gap-3 sm:grid-cols-2">
          {SETTINGS_GROUPS.map((group) => (
            <li key={group.segment}>
              <Link
                href={`/${locale}/admin/settings/${group.segment}`}
                className="flex min-h-nav items-center rounded-card bg-surface px-card-x py-card-y shadow-card hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                data-testid={`settings-group-${group.segment}`}
              >
                {t(`${group.key}.title`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <Settings locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function Settings({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.settings" });
  const states = await getTranslations({ locale, namespace: "states" });

  const result = await loadAdminSettings();

  if (!result.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={result.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  if (result.data.length === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex list-none flex-col gap-4">
        {result.data.map((setting) => (
          <li key={setting.key}>
            <SettingEditor
              setting={setting}
              labels={{
                value: t("value"),
                notSet: t("notSet"),
                yes: t("yes"),
                no: t("no"),
                readOnly: t("readOnly"),
                save: t("save"),
                working: t("working"),
                saved: t("saved"),
                editElsewhere: t("editElsewhere"),
                unnamed: t("unnamed"),
                errorTitle: states("errorTitle"),
                requestIdLabel: states("requestIdLabel"),
              }}
            />
          </li>
        ))}
      </ul>

      {/* Never a dead end: the two JSON settings are edited on the
          content screen, and this says where to go. */}
      <Link
        href={`/${locale}/admin/content`}
        className="inline-flex items-center text-secondary hover:opacity-[var(--state-hover-opacity)]"
      >
        {t("openContent")}
      </Link>
    </div>
  );
}
