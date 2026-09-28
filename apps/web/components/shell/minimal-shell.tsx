import type { ReactNode } from "react";
import { PlatformTopbar } from "./platform-topbar";
import { getTranslations } from "next-intl/server";
import { getBranding } from "@/lib/branding";
import { themeStyle } from "@/lib/theme";
import type { AppLocale } from "@/i18n/routing";
import { SkipLink } from "@/components/ui/skip-link";

/**
 * Frame for the (auth) group: no primary navigation, no footer links —
 * just the brand and the form.
 *
 * Everything that makes the page CORRECT is still here, because none of
 * it is chrome:
 *   - the active brand theme, applied as CSS custom properties;
 *   - the brand name from the Branding API, with a translated fallback;
 *   - the skip link and the `main` landmark.
 *
 * `lang` and `dir` are NOT set here — they belong to <html> in the
 * locale layout, which wraps both shells. Setting them again would
 * risk the two disagreeing.
 */
export interface MinimalShellProps {
  locale: AppLocale;
  children: ReactNode;
}

export async function MinimalShell({ locale, children }: MinimalShellProps) {
  const [branding, t] = await Promise.all([
    getBranding(locale),
    getTranslations({ locale, namespace: "shell" }),
  ]);

  return (
    <div
      style={themeStyle(branding.theme?.colors)}
      className="flex min-h-screen flex-col bg-background"
    >
      <SkipLink label={t("skipToContent")} />

      {/* THE PLATFORM'S ONE BAR, in its BARE form: the mark and the
          language, and nothing else. This shell used to print the
          tenant's NAME in text where the mark belongs, and offering
          "sign in" on the sign-in page would be a button whose only
          effect is reloading the page somebody is already on. */}
      <PlatformTopbar locale={locale} branding={branding} audience="bare" />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10"
      >
        {children}
      </main>
    </div>
  );
}
