import { redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.account.billing");


/**
 * THE OLD ADDRESS, kept open and pointed at «بيانات المنشأة».
 *
 * The owner's instruction: «ألغِ صفحة الفوترة والضريبة المكررة في لوحة
 * المورد، وأزل تبويب الفواتير الذي يفتحها؛ لأن بياناتها موجودة في
 * بيانات المنشأة».
 *
 * IT WAS A SECOND VIEW OF ONE RECORD. The invoicing name and the VAT
 * registration are two fields on the company, and «بيانات المنشأة»
 * already both SHOWS and EDITS them — this page drew the same card
 * against the same two reads. Two places to change one value is one
 * place too many, and it is how the two come to disagree.
 *
 * NOTHING STORED IS TOUCHED. No profile is deleted, no invoice, no tax
 * rate and no settlement: only the second door onto the same room.
 *
 * IN THE READER'S OWN LANGUAGE — the locale is carried across, so a
 * supplier reading English is not dropped into Arabic on the way.
 */
export default async function LegacySupplierBillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");
  redirect(`/${appLocale}/supplier/account`);
}
