import { redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("marketplace");


/** One product, at the address the vocabulary implies. See the list. */
export default async function ProductAlias({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  redirect(`/${locale as AppLocale}/opportunities/${id}`);
}
