import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { getBranding } from "@/lib/branding";
import type { AppLocale } from "@/i18n/routing";
import { SkipLink } from "@/components/ui/skip-link";
import { Header } from "./header";
import { Footer } from "./footer";

/**
 * Page frame shared by every route.
 *
 * Landmark structure is deliberate: skip link → <header> → <main
 * id="main-content"> → <footer>. `main` carries the skip-link target and
 * `tabIndex={-1}` so focus actually lands there when the link is
 * activated — without it the browser scrolls but leaves focus behind.
 *
 * Branding is fetched once here and passed down, so header and footer
 * cannot disagree, and a branding outage degrades to a translated
 * fallback rather than an error page.
 */
export interface AppShellProps {
  locale: AppLocale;
  children: ReactNode;
}

export async function AppShell({ locale, children }: AppShellProps) {
  const [branding, t] = await Promise.all([
    getBranding(),
    getTranslations({ locale, namespace: "shell" }),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SkipLink label={t("skipToContent")} />
      <Header locale={locale} branding={branding} />
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      <Footer locale={locale} branding={branding} />
    </div>
  );
}
