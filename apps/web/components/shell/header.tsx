import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { BrandingPublic } from "@platform/types";
import { routing, type AppLocale } from "@/i18n/routing";
import { BrandMark } from "./brand-mark";
import { getSiteContent } from "@/lib/site-content";

/**
 * Application header.
 *
 * Navy background with white text (16.69:1) — the identity surface per
 * §14.2. The language switch is a plain link so it works without
 * JavaScript, and carries `lang` + `hrefLang` so assistive tech
 * pronounces the target language name correctly.
 *
 * THE CATEGORY LINKS ARE OPERATOR-CONFIGURED, in the operator's order.
 * What is stored is a list of TAXONOMY NODE IDS — never URLs — so an
 * administrator cannot type a destination and there is nothing to
 * allowlist. Each id becomes a link into the marketplace filtered to
 * that category, built here from the id rather than from anything
 * stored.
 *
 * A node that was deleted or deactivated is dropped by the API before it
 * reaches this component, and a failed settings read yields no
 * categories at all. Either way the two permanent links below still
 * render: the header must not lose its navigation because a category
 * was retired.
 */
export interface HeaderProps {
  locale: AppLocale;
  branding: BrandingPublic;
}

export async function Header({ locale, branding }: HeaderProps) {
  const t = await getTranslations({ locale, namespace: "shell" });
  const otherLocale = routing.locales.find((l) => l !== locale) as AppLocale;

  // Shares one fetch with the homepage through React's request cache.
  const content = await getSiteContent();

  return (
    <header className="bg-primary">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <BrandMark branding={branding} locale={locale} fallbackName={t("brandFallback")} />

        <nav aria-label={t("primaryNavLabel")} className="flex flex-wrap items-center gap-1">
          <Link
            href={`/${locale}/opportunities`}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("navOpportunities")}
          </Link>

          {/* The operator's categories, in the operator's order. The
              href is CONSTRUCTED from the taxonomy id — the stored value
              is an id and nothing else, so there is no destination here
              that anyone typed. */}
          {content.headerNav.map((item) => (
            <Link
              key={item.taxonomyNodeId}
              href={`/${locale}/opportunities?taxonomyNodeId=${encodeURIComponent(item.taxonomyNodeId)}`}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {locale.startsWith("ar") ? item.nameAr : item.nameEn}
            </Link>
          ))}
          <Link
            href={`/${locale}/policies`}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("navPolicies")}
          </Link>

          {/* A plain <a>, not next/link: switching locale must reload
              the document so `lang` and `dir` on <html> are re-rendered
              by the root layout rather than patched client-side. */}
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
