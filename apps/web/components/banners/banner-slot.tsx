import Link from "next/link";
import type { BannerItem, BannerPlacement } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { apiClient } from "@/lib/api-client";
import { localized } from "@/lib/localized";
import { mediaUrl } from "@/lib/media-url";
import { cn } from "@/lib/cn";

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

async function loadBanners(placement: BannerPlacement): Promise<BannerItem[]> {
  try {
    return await apiClient.get<BannerItem[]>(`/banners?placement=${placement}`, {
      revalidate: 60,
    });
  } catch {
    return [];
  }
}

export async function BannerSlot({ placement, locale, className, regionLabel }: BannerSlotProps) {
  const banners = await loadBanners(placement);

  // No banners configured is the normal case, not an empty state to
  // apologise for — the slot simply does not exist.
  if (banners.length === 0) return null;

  return (
    <section aria-label={regionLabel} className={cn("flex flex-col gap-3", className)}>
      {banners.map((banner) => (
        <BannerCard key={banner.id} banner={banner} locale={locale} />
      ))}
    </section>
  );
}

function BannerCard({ banner, locale }: { banner: BannerItem; locale: AppLocale }) {
  const title = localized(locale, banner.titleAr, banner.titleEn);
  const body = localized(locale, banner.bodyAr, banner.bodyEn);
  const image = mediaUrl(banner.imageUrl);

  const content = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {image ? (
        // A plain <img>: the source is an API route on another origin
        // whose dimensions are not known at build time. `alt=""` with
        // `aria-hidden` because the title beside it already carries the
        // meaning — a screen reader announcing the banner text twice is
        // worse than not describing a decorative promo image.
        <img
          src={image}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="h-32 w-full rounded-md object-cover sm:h-24 sm:w-48 sm:shrink-0"
        />
      ) : null}

      <div className="flex flex-col gap-1">
        {/* Plain text nodes. Banner copy is never HTML and is never
            passed to dangerouslySetInnerHTML — a repo-wide test enforces
            that no component in this app uses it at all. */}
        <p className="text-base font-semibold text-content">{title}</p>
        {body ? <p className="text-sm text-content-muted">{body}</p> : null}
      </div>
    </div>
  );

  const shell = "rounded-lg border border-line bg-surface p-4";

  if (!isRenderableLink(banner.linkUrl)) {
    return <div className={shell}>{content}</div>;
  }

  if (isExternal(banner.linkUrl)) {
    return (
      <a
        href={banner.linkUrl}
        rel="noopener noreferrer nofollow"
        className={cn(shell, "block transition-opacity hover:opacity-90")}
      >
        {content}
      </a>
    );
  }

  return (
    <Link href={banner.linkUrl} className={cn(shell, "block transition-opacity hover:opacity-90")}>
      {content}
    </Link>
  );
}
