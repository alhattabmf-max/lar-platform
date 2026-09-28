import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { CompletenessBanner } from "@/components/company/completeness-banner";
import { HomeContent } from "@/components/home/home-content";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("home");


/**
 * The buyer's landing screen — the front door, not a dashboard.
 *
 * «والصفحة الرئيسية للمشتري نفس محتوى الصفحة الرئيسية في واجهة الزائر.»
 * It used to be three panels of the buyer's own figures: what needed
 * chasing, their latest orders, their unread count. Every one of those
 * is a tab away — «طلباتي» for the orders, the bell for the
 * notifications, «المتابعة» for what is waiting — and a buyer opening
 * the platform is opening a market. So the market is what they land on,
 * drawn by the same component the visitor's front draws.
 *
 * ONE THING STAYS THAT THE VISITOR'S FRONT HAS NO USE FOR: the
 * completeness banner. It is not content, it is a blocker being
 * announced — a buyer whose record is incomplete cannot check out — and
 * it belongs at the top of the first screen they see. It blocks nothing
 * else, and it disappears by being fixed rather than by being
 * dismissed.
 *
 * NOTHING WAS DELETED TO DO THIS. The orders list, the notifications
 * page and the follow-up screen are all still served, still linked from
 * the row of tabs above, and read from the same loaders they always did.
 */
export default async function TraderHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  // The layout already guards this group; repeating it here means a
  // future refactor that moves the page cannot silently unguard it.
  const session = await requireRoleOrRedirect(appLocale, "TRADER");

  const company = await getTranslations({ locale: appLocale, namespace: "company" });

  return (
    <div className="flex flex-col gap-4">
      <CompletenessBanner
        missing={session.profile.missing}
        href={`/${appLocale}/trader/account`}
        labels={{
          title: company("completeness.title"),
          action: company("completeness.action"),
          requirements: {
            companyDetails: company("completeness.requirement.companyDetails"),
            mainBranch: company("completeness.requirement.mainBranch"),
            bankAccount: company("completeness.requirement.bankAccount"),
            billingIdentity: company("completeness.requirement.billingIdentity"),
          },
        }}
      />

      {/* THE BUYER STAYS IN THE BUYER PORTAL. The content is the
          visitor home s — that was asked for — but its cards must open
          the buyer detail page, not the public one. */}
      <HomeContent
        locale={appLocale}
        detailBasePath={`/${appLocale}/trader/opportunities`}
      />
    </div>
  );
}
