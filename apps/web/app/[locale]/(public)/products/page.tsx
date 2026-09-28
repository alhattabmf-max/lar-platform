import { redirect } from "next/navigation";
import type { AppLocale } from "@/i18n/routing";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("marketplace");


/**
 * `/products` — the address the platform's own vocabulary now implies.
 *
 * The page itself still lives at `/opportunities`, and moving it would
 * break every link a buyer has bookmarked, every banner an operator
 * placed and the category bar's whole query. This forwards instead, so
 * both addresses answer and neither is a dead end. The query string
 * travels with it — a category filter that arrived here has to survive
 * the hop or the forward is worse than a 404.
 */
export default async function ProductsAlias({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);

  const carried = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) carried.append(key, one);
  }

  const suffix = carried.toString();
  redirect(`/${locale as AppLocale}/opportunities${suffix ? `?${suffix}` : ""}`);
}
