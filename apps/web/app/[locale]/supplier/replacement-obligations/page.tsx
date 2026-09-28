import { redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.replacements");


/**
 * THE OLD ADDRESS, kept open and pointed at «المتابعة».
 *
 * The returns are one of the two cards beneath the payouts — and they are «المرتجعات» now, on the owner's instruction.
 *
 * IT IS NOT DELETED. A supplier who bookmarked this list, a link in a
 * notification sent last month, an address written down — none of them
 * is a mistake, and none should meet a 404 because three screens became
 * one.
 *
 * GUARDED LIKE EVERY OTHER PAGE IN THIS SEGMENT, even though it only
 * forwards: a visitor with no session should meet the sign-in page here
 * rather than be bounced to another address that then sends them there.
 */
export default async function LegacyReturnsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");
  redirect(`/${appLocale}/supplier/follow-up`);
}
