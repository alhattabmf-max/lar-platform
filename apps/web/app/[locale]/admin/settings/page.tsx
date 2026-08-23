import { Suspense } from "react";
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
 */
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
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-content-muted">
        {t("scopeNotice")}
      </p>

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
        className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
      >
        {t("openContent")}
      </Link>
    </div>
  );
}
