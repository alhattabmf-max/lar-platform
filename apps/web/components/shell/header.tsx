import { getTranslations } from "next-intl/server";
import type { BrandingPublic } from "@platform/types";
import { routing, type AppLocale } from "@/i18n/routing";
import { BrandMark } from "./brand-mark";

/**
 * Application header.
 *
 * Navy background with white text (16.69:1) — the identity surface per
 * §14.2. The language switch is a plain link so it works without
 * JavaScript, and carries `lang` + `hrefLang` so assistive tech
 * pronounces the target language name correctly.
 */
export interface HeaderProps {
  locale: AppLocale;
  branding: BrandingPublic;
}

export async function Header({ locale, branding }: HeaderProps) {
  const t = await getTranslations({ locale, namespace: "shell" });
  const otherLocale = routing.locales.find((l) => l !== locale) as AppLocale;

  return (
    <header className="bg-primary">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <BrandMark branding={branding} locale={locale} fallbackName={t("brandFallback")} />

        <nav aria-label={t("primaryNavLabel")}>
          <a
            href={`/${otherLocale}`}
            lang={otherLocale}
            hrefLang={otherLocale}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("switchLanguage")}
          </a>
        </nav>
      </div>
    </header>
  );
}
