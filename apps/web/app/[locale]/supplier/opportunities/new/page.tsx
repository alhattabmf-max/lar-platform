import { redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.opportunities.new");


/**
 * THE OLD DOOR, kept open and pointed at the catalogue.
 *
 * An offer is made ON a product, so there is no address at which one
 * can be created without naming which product it is for — the form
 * lives at `/supplier/products/:id/offers/new`. This address named a
 * step that used to open with a dropdown of products; it is not
 * deleted, because a supplier who bookmarked it, or a link in an email
 * sent last month, must land somewhere that works rather than on a 404.
 *
 * THE CATALOGUE IS WHERE THE MISSING ANSWER IS. Sending someone to a
 * list of their products is sending them to the question the old form
 * opened by asking.
 */
export default async function LegacyNewOfferPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // GUARDED LIKE EVERY OTHER PAGE IN THIS SEGMENT, even though it only
  // forwards. A visitor with no session should meet the sign-in page
  // here rather than be bounced to another address that then sends
  // them there — and a rule with one exception is a rule the next
  // page copies the exception from.
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");
  redirect(`/${appLocale}/supplier/products`);
}
