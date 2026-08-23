import { getTranslations } from "next-intl/server";
import type { SiteContentField } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadAdminTaxonomy, loadSiteContent } from "@/lib/admin-data";
import { localized } from "@/lib/localized";
import { ErrorState } from "@/components/ui/states";
import { SiteContentEditor } from "@/components/admin/site-content-editor";

/**
 * Homepage copy and the header's categories.
 *
 * THE EDITOR IS SEEDED FROM THE PUBLIC ENDPOINT, deliberately — the same
 * `/public/site-content` a visitor gets, not the raw settings rows. So
 * an operator sees the EFFECT of what is stored, including a category
 * silently dropped from the menu because its taxonomy node was
 * deactivated. Reading the raw rows would show them a configuration that
 * looks right while the live header disagrees.
 *
 * The category choices are the ACTIVE taxonomy nodes. An inactive node
 * is not offered, because adding one would produce a menu entry the
 * public site refuses to render.
 */
export default async function AdminContentPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.content" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const [content, taxonomy] = await Promise.all([loadSiteContent(), loadAdminTaxonomy()]);

  if (!content.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={content.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  const choices = taxonomy.ok
    ? taxonomy.data
        .filter((node) => node.isActive)
        .map((node) => ({
          id: node.id,
          label: localized(appLocale, node.nameAr, node.nameEn),
        }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
        <p className="text-sm text-content-muted">{t("description")}</p>
      </header>

      <p className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-content-muted">
        {t("textOnlyNotice")}
      </p>

      {/* The taxonomy read failing does not take the page down — the copy
          is still editable. But the category picker would silently offer
          nothing, which reads as "there are no categories", so the real
          reason is named. */}
      {!taxonomy.ok ? (
        <p role="alert" className="rounded-md border border-danger px-3 py-2 text-sm text-content">
          {t("taxonomyUnavailable")}
        </p>
      ) : null}

      <SiteContentEditor
        content={content.data}
        taxonomy={choices}
        labels={{
          contentLegend: t("contentLegend"),
          navLegend: t("navLegend"),
          arabic: t("arabic"),
          english: t("english"),
          fieldLabel: (field: SiteContentField) => t(`fields.${field}`),
          blankMeansDefault: t("blankMeansDefault"),

          navHint: t("navHint"),
          navAdd: t("navAdd"),
          navChoose: t("navChoose"),
          navRemove: (label: string) => t("navRemove", { label }),
          navMoveUp: (label: string) => t("navMoveUp", { label }),
          navMoveDown: (label: string) => t("navMoveDown", { label }),
          navFull: t("navFull"),
          navEmpty: t("navEmpty"),
          navMissing: t("navMissing"),

          save: t("save"),
          working: t("working"),
          saved: t("saved"),
          errorTitle: states("errorTitle"),
          requestIdLabel: states("requestIdLabel"),
        }}
      />
    </div>
  );
}
