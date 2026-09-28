import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import {
  loadAdminTaxonomy,
  loadAdminSetting,
  loadSiteContent,
} from "@/lib/admin-data";
import {
  FAQ_ITEMS_SETTING_KEY,
  isFaqItem,
  type FaqItem,
} from "@platform/types";
import { localized } from "@/lib/localized";
import { ErrorState } from "@/components/ui/states";
import { SiteContentEditor } from "@/components/admin/site-content-editor";
import { FaqManager } from "@/components/admin/faq-manager";

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
    namespace: "admin.content",
  });
  return { title: t("title") };
}

export default async function AdminContentPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({
    locale: appLocale,
    namespace: "admin.content",
  });
  const states = await getTranslations({
    locale: appLocale,
    namespace: "states",
  });
  // «تأكيد» و«إلغاء» هما مفردات الإجراءات المشتركة، لا نصّ خاص بهذه
  // الشاشة — وكانت الشاشة تطلبهما من نطاقها فتعرض مسار المفتاح.
  const actions = await getTranslations({
    locale: appLocale,
    namespace: "admin.actions",
  });

  // The FAQ is read from the RAW setting, not from the public
  // projection: an administrator needs the inactive questions and the
  // stored order, and the public shape deliberately carries neither.
  const [content, taxonomy, faq] = await Promise.all([
    loadSiteContent(),
    loadAdminTaxonomy(),
    loadAdminSetting(FAQ_ITEMS_SETTING_KEY),
  ]);

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

  const faqT = await getTranslations({
    locale: appLocale,
    namespace: "admin.faq",
  });

  /**
   * The stored questions.
   *
   * Every entry is checked before it reaches the editor: a malformed one
   * is dropped rather than rendered as blank fields an operator would
   * then "fix" by overwriting whatever was actually there. A failed read
   * yields none, which the manager shows as its empty state — the rest
   * of the page stays editable either way.
   */
  const faqItems: FaqItem[] =
    faq.ok && Array.isArray(faq.data.value)
      ? (faq.data.value as unknown[])
          .filter(isFaqItem)
          .sort((a, b) => a.sortOrder - b.sortOrder)
      : [];

  const faqLabels = {
    title: faqT("title"),
    description: faqT("description"),
    addLegend: faqT("addLegend"),
    questionAr: faqT("questionAr"),
    questionEn: faqT("questionEn"),
    answerAr: faqT("answerAr"),
    answerEn: faqT("answerEn"),
    add: faqT("add"),
    save: faqT("save"),
    saved: faqT("saved"),
    moveUp: faqT("moveUp"),
    moveDown: faqT("moveDown"),
    activate: faqT("activate"),
    deactivate: faqT("deactivate"),
    remove: faqT("remove"),
    removePrompt: faqT("removePrompt"),
    confirm: actions("confirm"),
    cancel: actions("cancel"),
    working: actions("working"),
    required: t("required"),
    empty: faqT("empty"),
    active: faqT("active"),
    inactive: faqT("inactive"),
    full: faqT("full"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
  };

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
      </header>


      {/* The taxonomy read failing does not take the page down — the copy
          is still editable. But the category picker would silently offer
          nothing, which reads as "there are no categories", so the real
          reason is named. */}
      {!taxonomy.ok ? (
        <p
          role="alert"
          className="rounded-md border border-danger px-3 py-2 text-sm text-content"
        >
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
          // fieldLabel / navRemove / navMoveUp / navMoveDown are absent
          // on purpose: they take a runtime argument, and a function
          // cannot be serialized across the server/client boundary.
          // SiteContentEditor resolves them itself.
          blankMeansDefault: t("blankMeansDefault"),

          navHint: t("navHint"),
          navAdd: t("navAdd"),
          navChoose: t("navChoose"),
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

      <section aria-labelledby="faq-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="faq-heading" className="text-xl font-semibold text-content">
            {faqLabels.title}
          </h2>
        </div>

        <FaqManager items={faqItems} labels={faqLabels} />
      </section>
    </div>
  );
}
