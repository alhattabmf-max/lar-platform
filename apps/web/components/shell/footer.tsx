import { getTranslations } from "next-intl/server";
import type { BrandingPublic } from "@platform/types";
import { brandDescription, brandName } from "@/lib/branding";
import type { AppLocale } from "@/i18n/routing";

export interface FooterProps {
  locale: AppLocale;
  branding: BrandingPublic;
}

export async function Footer({ locale, branding }: FooterProps) {
  const t = await getTranslations({ locale, namespace: "shell" });

  const name = brandName(branding, locale) ?? t("brandFallback");
  const description = brandDescription(branding, locale);

  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6">
        <p className="text-sm font-medium text-content">{name}</p>
        {description ? <p className="text-sm text-content-muted">{description}</p> : null}
        <p className="text-xs text-content-muted">{t("footerNote")}</p>
      </div>
    </footer>
  );
}
