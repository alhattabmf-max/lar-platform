import { getTranslations } from "next-intl/server";
import type { BannerItem, BannerPlacement } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { apiClient } from "@/lib/api-client";
import { mediaUrl } from "@/lib/media-url";
import { cn } from "@/lib/cn";
import { BannerCarousel } from "./banner-carousel";

/**
 * Renders the live banners for one placement.
 *
 * This is the PUBLIC surface only. Creating, scheduling and ordering
 * banners is admin work and is not part of this batch — nothing here
 * writes, and nothing here can observe a banner that is not live right
 * now, because the API resolves visibility and returns only LIVE rows.
 *
 * Failure is silent by design: a promotional strip is decoration, and a
 * marketplace that refuses to render because a banner call timed out
 * would be a far worse outcome than a page with no banner. The error is
 * swallowed here and nowhere else.
 */

/**
 * Second gate on an already-validated value.
 *
 * The API restricts `linkUrl` to an internal path or an allowlisted
 * `https://` origin. This repeats the check at render time rather than
 * trusting it, because the cost is one regex and the failure mode it
 * prevents — a `javascript:` URL reaching an `href` — is script
 * execution in the visitor's session.
 */
export function isRenderableLink(url: string | null): url is string {
  if (!url) return false;
  // A protocol-relative "//host" would inherit the page scheme and
  // leave the site, so a single leading slash is required.
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  return /^https:\/\//i.test(url);
}

function isExternal(url: string): boolean {
  return /^https:\/\//i.test(url);
}

export interface BannerSlotProps {
  placement: BannerPlacement;
  locale: AppLocale;
  className?: string;
  /** Accessible name for the region, already translated. */
  regionLabel: string;
}

/**
 * The locale is sent, and the server returns THAT language's artwork
 * only. There is no fallback: a banner without an Arabic image simply
 * does not appear on the Arabic site.
 */
async function loadBanners(
  placement: BannerPlacement,
  locale: AppLocale,
): Promise<BannerItem[]> {
  const query = new URLSearchParams({ placement, locale });
  try {
    return await apiClient.get<BannerItem[]>(`/banners?${query.toString()}`, {
      revalidate: 60,
    });
  } catch {
    return [];
  }
}

export async function BannerSlot({
  placement,
  locale,
  className,
  regionLabel,
}: BannerSlotProps) {
  const t = await getTranslations({ locale, namespace: "marketplace" });
  const banners = await loadBanners(placement, locale);

  // ONE GENERIC DESCRIPTION, translated, for every banner.
  //
  // The alt used to be the banner's stored title — a field an operator
  // filled in purely so this line had something to read, since it was
  // never displayed anywhere. A banner is artwork whose words are drawn
  // inside the picture, and no operator-written string can describe it
  // better than naming what it is. So the field is gone and this is a
  // constant.
  const alt = t("banner.alt");

  const slides = banners
    .map((banner) => {
      const imageUrl = mediaUrl(banner.imageUrl);
      if (imageUrl === null) return null;
      return {
        id: banner.id,
        imageUrl,
        alt,
        href: isRenderableLink(banner.linkUrl) ? banner.linkUrl : null,
        external: isRenderableLink(banner.linkUrl)
          ? isExternal(banner.linkUrl)
          : false,
      };
    })
    .filter((slide): slide is NonNullable<typeof slide> => slide !== null);

  // No banners configured is the normal case, not an empty state to
  // apologise for — the slot simply does not exist.
  if (slides.length === 0) return null;

  return (
    <div className={cn(className)}>
      <BannerCarousel
        slides={slides}
        regionLabel={regionLabel}
        previousLabel={t("banner.previous")}
        nextLabel={t("banner.next")}
        goToTemplate={t("banner.goTo", { index: "{index}" })}
        // Which way a drag means "forward" is a reading-direction
        // question, and this is the component that knows the locale.
        isRtl={locale === "ar-SA"}
      />
    </div>
  );
}
