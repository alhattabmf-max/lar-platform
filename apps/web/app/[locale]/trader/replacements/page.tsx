import { redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("trader.replacements");


/**
 * THE OLD ADDRESS, kept open and pointed at «المتابعة».
 *
 * The returns — «الاسترجاع» — are the first of the two cards beneath the disputes. The SEGMENT keeps its name: the word the owner changed is what a buyer reads, and renaming a route to match a label breaks every link that ever pointed at it.
 *
 * IT IS NOT DELETED. A buyer who bookmarked this list, a link in a
 * notification sent last month, an address written down — none of them
 * is a mistake, and none should meet a 404 because three screens became
 * one.
 *
 * GUARDED LIKE EVERY OTHER PAGE IN THIS SEGMENT, even though it only
 * forwards: a visitor with no session should meet the sign-in page here
 * rather than be bounced to another address that then sends them there.
 */
export default async function LegacyReplacementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "TRADER");
  redirect(`/${appLocale}/trader/follow-up`);
}
