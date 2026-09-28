import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { BrandingPublic, FooterPublic } from "@platform/types";
import { brandDescription, brandName, getFooter } from "@/lib/branding";
import type { AppLocale } from "@/i18n/routing";

/**
 * Site footer.
 *
 * ITS CONTENT IS CONFIGURATION, NOT CODE. The five links used to be
 * written here, in a fixed order, always shown; changing which appeared
 * or adding a telephone number meant a deploy. The server now decides
 * what this renders — which links, in what order, with what wording, and
 * whether a policy link may appear at all — and this component draws
 * whatever it is given.
 *
 * THREE THINGS ARE STILL DECIDED HERE, and only three:
 *
 *   1. THE LOCALE PREFIX. The server returns `/about`; a link in this
 *      app is `/{locale}/about`. Keeping the prefix out of the stored
 *      value is what lets one configuration serve both languages.
 *   2. THE FALLBACK WORDING. A null label means "use this app's own
 *      name for that page", which is what keeps an unconfigured footer
 *      translated rather than empty.
 *   3. A DESTINATION THIS BUILD DOES NOT KNOW is skipped. The message
 *      catalogue is the closed list on this side; a key added to the
 *      contract and deployed to the API first must not render as a raw
 *      identifier.
 *
 * EVERY OPERATOR-WRITTEN STRING IS A TEXT NODE. No markup path exists
 * from the configuration to the page — not for a label, an address, or
 * a copyright line.
 */
export interface FooterProps {
  locale: AppLocale;
  branding: BrandingPublic;
}

/**
 * The social networks this build can name and draw, and the label key
 * each uses. A network the API knows but this build does not is
 * skipped rather than rendered as its identifier.
 */
const SOCIAL_KEYS: Record<FooterPublic["social"][number]["network"], string> = {
  x: "x",
  linkedin: "linkedin",
  instagram: "instagram",
  youtube: "youtube",
  tiktok: "tiktok",
  snapchat: "snapchat",
  facebook: "facebook",
  whatsapp: "whatsapp",
};

export async function Footer({ locale, branding }: FooterProps) {
  const [t, footer] = await Promise.all([
    getTranslations({ locale, namespace: "shell" }),
    getFooter(locale),
  ]);

  const name = brandName(branding, locale) ?? t("brandFallback");
  const description = brandDescription(branding, locale);

  const links = footer.links
    .filter((link) => link.label !== null || t.has(`footer.${link.key}`))
    .map((link) => ({
      key: link.key,
      href: `/${locale}${link.href}`,
      label: link.label ?? t(`footer.${link.key}`),
    }));

  const social = footer.social.filter((entry) => entry.network in SOCIAL_KEYS);

  const hasContact = Boolean(footer.email || footer.phone || footer.address);

  return (
    <footer className="border-t border-line bg-primary">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6">
        {links.length > 0 ? (
          <nav aria-label={t("footerNavLabel")}>
            <ul className="flex list-none flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm">
              {links.map((link) => (
                <li key={link.key}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-nav items-center text-primary-foreground hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {social.length > 0 ? (
          <nav aria-label={t("footerSocialLabel")}>
            <ul className="flex list-none flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
              {social.map((entry) => (
                <li key={entry.network}>
                  <a
                    href={entry.url}
                    // The destination is off-site and operator-set.
                    // `noopener` denies it a handle on this window;
                    // `noreferrer` keeps the visitor's current page out
                    // of its logs.
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-nav items-center text-primary-foreground hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {t(`footerSocial.${SOCIAL_KEYS[entry.network]}`)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {hasContact ? (
          <address className="flex flex-col items-center gap-1 text-center text-sm not-italic text-primary-foreground opacity-80">
            {footer.email ? (
              <a
                href={`mailto:${footer.email}`}
                className="hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {footer.email}
              </a>
            ) : null}
            {footer.phone ? (
              // `dir="ltr"` because a telephone number reads
              // left-to-right inside an Arabic page: without it a
              // leading + lands at the wrong end.
              <span dir="ltr">{footer.phone}</span>
            ) : null}
            {footer.address ? <span>{footer.address}</span> : null}
          </address>
        ) : null}

        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-sm font-medium text-primary-foreground">{name}</p>
          {footer.showDescription && description ? (
            <p className="text-sm text-primary-foreground opacity-80">
              {description}
            </p>
          ) : null}
          <p className="text-xs text-primary-foreground opacity-70">
            {footer.copyright ?? t("footerNote")}
          </p>
        </div>
      </div>
    </footer>
  );
}
