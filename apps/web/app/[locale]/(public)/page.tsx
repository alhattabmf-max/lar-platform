import { redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { getSession } from "@/lib/session";
import { HomeContent } from "@/components/home/home-content";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("home");


/**
 * The public landing page.
 *
 * IT IS THE COMPONENT AND NOTHING ELSE. What is drawn here — the
 * promotional strip and the offers closing soonest — is drawn by
 * `HomeContent`, because the buyer's own home shows the same thing:
 * «والصفحة الرئيسية للمشتري نفس محتوى الصفحة الرئيسية في واجهة الزائر».
 * Two pages that agreed on the day they were written is not "the same
 * content"; one component is.
 *
 * AND A SIGNED-IN COMPANY DOES NOT LAND HERE AT ALL — «عند التحديث
 * ما يدخّلني على صفحتي اللي أنا مسجَّل بها». The browser holds ONE
 * session, so a reader who reloads this address while signed in is a
 * reader who is already somewhere: their own portal's front door. They
 * are taken there rather than shown a storefront that then offers to
 * sign them out of the tab they left open.
 *
 * ONLY THIS ADDRESS. Every other public page — an offer, the policies,
 * the FAQ — stays reachable while signed in, because a link somebody
 * was sent has to open at the thing it names. It is the FRONT DOOR that
 * has a better answer for a reader who is already inside.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  // THE COMPANY'S OWN TYPE DECIDES, never a guess and never a default:
  // a supplier reaches the supplier's portal and a buyer the buyer's.
  // The console's `asid` never reaches a public page, so a session here
  // can only be one of those two.
  const session = await getSession();
  if (session) {
    redirect(
      session.company.accountType === "SUPPLIER"
        ? `/${appLocale}/supplier`
        : `/${appLocale}/trader`,
    );
  }

  return <HomeContent locale={appLocale} />;
}
