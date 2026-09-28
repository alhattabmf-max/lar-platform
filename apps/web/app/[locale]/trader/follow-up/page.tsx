import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { LoadingState } from "@/components/ui/states";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("trader.followUp");

import {
  DisputesSection,
  ProductReportsSection,
  ReturnsSection,
} from "@/components/trader/follow-up-sections";

/**
 * «المتابعة» — one screen for the three things that happen TO a buyer.
 *
 * «أضف لسانًا في صفحة المشتري باسم المتابعة… وألغِ ألسنتها وجمّعها
 * كبطاقات في صفحة المتابعة.» The disputes, the returns and the product
 * reports were a tab each; not one of them is a destination, and three
 * tabs meant three chances to miss the one with something waiting.
 *
 * THE DISPUTES TAKE THE FULL WIDTH because a dispute is the one of the
 * three with a clock on it — a supplier response falls due, and a row
 * that says so should not be reading in a half-width column. The other
 * two share the row beneath.
 *
 * EACH CARD STREAMS ON ITS OWN. Three reads, three `Suspense`
 * boundaries: a slow one holds up its own card and nothing else, and
 * the screen is useful before all three have answered.
 */
export default async function TraderFollowUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.followUp" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-card-gap">
      {/* THE TAB ABOVE IS THIS PAGE'S TITLE. The heading stays for the
          document outline and for anyone reading by structure; a tab is
          a link and can never stand in for one. */}
      <header className="sr-only">
        <h1>{t("title")}</h1>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={3} />}>
        <DisputesSection locale={appLocale} />
      </Suspense>

      <div className="grid grid-cols-1 gap-card-gap lg:grid-cols-2">
        <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
          <ReturnsSection locale={appLocale} />
        </Suspense>

        <Suspense fallback={<LoadingState label={common("loading")} rows={2} />}>
          <ProductReportsSection locale={appLocale} />
        </Suspense>
      </div>
    </div>
  );
}
