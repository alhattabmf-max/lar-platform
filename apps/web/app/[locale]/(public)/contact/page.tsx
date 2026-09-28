import type { AppLocale } from "@/i18n/routing";
import { ContentPage } from "@/components/shell/content-page";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("shell.footer", "contact");


/**
 * Body text comes from the admin content screen — see ContentPage. This
 * route exists only to name the page and hand over the locale.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <ContentPage locale={locale as AppLocale} page="contact" />;
}
