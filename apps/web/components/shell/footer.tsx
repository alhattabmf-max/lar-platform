import Link from "next/link";
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

        <nav aria-label={t("footerNavLabel")} className="mt-2">
          <ul className="flex list-none flex-wrap gap-4 text-sm">
            <li>
              <Link
                href={`/${locale}/opportunities`}
                className="text-secondary hover:opacity-90"
              >
                {t("navOpportunities")}
              </Link>
            </li>
            <li>
              <Link href={`/${locale}/policies`} className="text-secondary hover:opacity-90">
                {t("navPolicies")}
              </Link>
            </li>
          </ul>
        </nav>

        <p className="text-xs text-content-muted">{t("footerNote")}</p>
      </div>
    </footer>
  );
}
