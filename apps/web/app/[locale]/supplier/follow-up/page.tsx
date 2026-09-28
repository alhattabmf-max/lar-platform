import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { LoadingState } from "@/components/ui/states";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.followUp");

import {
  DisputesSection,
  ReturnsSection,
  SettlementsSection,
} from "@/components/supplier/follow-up-sections";

/**
 * «المتابعة» — one screen for the three things that happen TO a supplier.
 *
 * The owner's instruction: «حط لسان جديد باسم المتابعة واحذف تبويب لسان
 * المنازعات والاستبدالات والتسويات وصمّمها على شكل بطاقات داخل صفحة
 * اللسان الجديد… واجعل بطاقة التسويات العلوية وتكون على امتداد الصفحة
 * وبطاقتين تحته متوازية».
 *
 * WHY THEY WERE THREE TABS AND SHOULD NOT BE. None of the three is a
 * place a supplier goes to do something: a payout arrives, a dispute is
 * raised, a return is owed. Three tabs meant three things to remember to
 * check and three chances to miss one — and the one question a supplier
 * actually asks is "is anything waiting for me?", which no single tab
 * answered.
 *
 * THE ORDER IS THE OWNER'S. The money is the wide card on top; the two
 * that can demand an answer share the row beneath it.
 *
 * EACH SECTION LOADS ON ITS OWN. Three reads behind one Suspense would
 * hold the whole screen for the slowest of them; behind three, each card
 * fills as its own answer lands and a slow settlement read cannot keep
 * a waiting dispute off the screen.
 *
 * THE THREE OLD ADDRESSES FORWARD HERE, and the detail pages they used
 * to lead to are untouched — a bookmark, or a link in a notification
 * sent last month, still opens the record it named.
 */
export default async function SupplierFollowUpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.followUp" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  const loading = <LoadingState label={common("loading")} rows={3} />;

  return (
    <div className="flex flex-col gap-card-gap">
      {/* THE TAB ABOVE IS THIS PAGE'S TITLE — «نكتفي باسم القسم في
          اللسان كعنوان للصفحة». The heading stays for the document
          outline and for anyone reading by structure; a tab is a link
          and can never stand in for it. */}
      <header className="sr-only">
        <h1>{t("title")}</h1>
      </header>

      {/* THE MONEY, ACROSS THE WHOLE WIDTH. It is the one of the three
          that is only ever read, never answered, and it is the one a
          supplier opens this screen for most days. */}
      <Suspense fallback={loading}>
        <SettlementsSection locale={appLocale} />
      </Suspense>

      {/* AND THE TWO THAT CAN ASK SOMETHING OF THEM, side by side.
          They stack below `lg`: two columns of cards on a narrow screen
          is a column of single words. */}
      <div className="grid grid-cols-1 gap-card-gap lg:grid-cols-2">
        <Suspense fallback={loading}>
          <DisputesSection locale={appLocale} />
        </Suspense>
        <Suspense fallback={loading}>
          <ReturnsSection locale={appLocale} />
        </Suspense>
      </div>
    </div>
  );
}
