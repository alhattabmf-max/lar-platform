import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { CompanyProfileSection } from "@/components/company/company-profile-section";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("company");


/**
 * The buyer's «بيانات المنشأة».
 *
 * THE ONE PLACE A COMPANY COMPLETES ITS OWN RECORD. This page was a
 * list of links to four read-only screens, none of which could change
 * anything — which is why a separate «إكمال الملف الشخصي» page had to
 * exist at all. It does not any more: the record is completed here, in
 * the section the sidebar already points at.
 *
 * NOTHING IS WITHHELD FOR AN INCOMPLETE RECORD. Reaching this page,
 * the dashboard, the language switch and signing out are never gated
 * on it; each card says what it still needs.
 */
export default async function TraderCompanyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "TRADER");

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* NO HEADING HERE. The section below opens with «بيانات
          المنشأة» beside its own mark, and an <h1> above it printed the
          same words a second time — two headings, one page, one name.
          The section's is the one that stays: it is the one that knows
          whether the record is verified, and it carries the icon. */}
      <CompanyProfileSection locale={appLocale} accountType="TRADER" />
    </div>
  );
}
