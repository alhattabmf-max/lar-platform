import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import type { AppLocale } from "@/i18n/routing";

/**
 * The (public) group: full chrome, no guard.
 *
 * A route group adds no path segment, so `(public)/page.tsx` still
 * serves `/{locale}` — the URLs are unchanged by this split. What it
 * buys is that the guarded groups arriving in 8D–8F can wrap
 * themselves without every public page paying for it.
 */
export default async function PublicLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return <AppShell locale={locale as AppLocale}>{children}</AppShell>;
}
