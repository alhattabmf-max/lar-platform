import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Boxes } from "lucide-react";
import type { AppLocale } from "@/i18n/routing";
import { ChromeSearch } from "./chrome-search";

/**
 * THE OPEN TAB'S OWN BAND, on a narrow screen — the search, and the way
 * into the catalogue beside it.
 *
 * «الرئيسية ممتدة باللسان يكون فيه البحث والمنتجات، ويكونون مشبوكين مع
 *  اللسان نفس المنصة ومدرّج اللون.»
 *
 * IT IS THE STRIP THE WIDE ROW ALREADY HAS. A tab on this platform
 * pours into a bar below it: one colour run begins at the tab's crown
 * and finishes in the bar's floor, so the two read as one piece of
 * paper rather than a lid on a box. This is that same run, continued
 * under a 44-pixel tab instead of a 36-pixel one — see
 * `--chrome-run-strip-narrow`, where the nine-pixel difference is
 * worked out rather than eyeballed.
 *
 * IT IS NOT PART OF WHAT STICKS. Three sticky rows came to 153 pixels
 * of a 640-pixel phone before the banner — measured — which is what
 * sent the first arrangement back. Only the bar above it is fixed;
 * this leaves with the page.
 *
 * THE TILES ARE GONE FROM HERE. They were seven squares in a swipe
 * strip on this band and the owner took them out of the chrome
 * altogether: «ألغاء مربعات التصنيف من الشريط ويبقى البحث». They are
 * cards in the page now — see `CategoryCards` — where they can be the
 * size a category deserves instead of the size a bar can spare.
 *
 * «المنتجات» STAYS, as one link at the head of the row. It is the only
 * way into the whole catalogue from a page that is not the home page,
 * and it costs 110 pixels of a 390-pixel row — leaving 250 for the
 * field, which needs 150.
 */
export async function MarketBand({
  locale,
  basePath,
  market = true,
}: {
  locale: AppLocale;
  /** `/ar-SA` for the visitor, `/ar-SA/trader` for the buyer. */
  basePath: string;
  /**
   * WHETHER THIS FRONT HAS A CATALOGUE TO BROWSE.
   *
   * The supplier does not: it sells into the market rather than
   * shopping in it, and its search looks through its OWN listings —
   * «كلٌّ يبحث في عالمه». So it gets the field and no link.
   */
  market?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "shell" });

  const listing = `${basePath}/opportunities`;

  return (
    <div
      data-testid="market-band"
      // THE TAB'S OWN COLOUR, CONTINUED. Not a navy of its own: the run
      // resumes exactly where the tab's ended, so the seam has nowhere
      // to be. `-mt-px` closes the hairline a fractional device pixel
      // ratio would otherwise open across it.
      className="-mt-px flex items-center gap-2 bg-[image:var(--chrome-run-strip-narrow)] px-3 py-2 lg:hidden"
    >
      {market ? (
        <Link
          href={listing}
          data-testid="band-market-link"
          className="flex min-h-nav shrink-0 items-center gap-1.5 rounded-control px-2 text-sm font-medium text-primary-foreground hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Boxes aria-hidden="true" className="size-5 shrink-0" />
          {t("bottomNav.market")}
        </Link>
      ) : null}

      {/* FORTY-FOUR TALL, by a DESCENDANT selector: `cn` joins classes
          rather than merging them, so two height utilities on one
          element would be settled by stylesheet order. `[&_input]` is
          (0,1,1) and beats the field's own (0,1,0) every time. */}
      <div className="min-w-0 flex-1 [&_button]:min-h-[44px] [&_input]:h-11">
        <ChromeSearch
          action={listing}
          placeholder={t("search.placeholder")}
          label={t("search.label")}
          submitLabel={t("search.submit")}
        />
      </div>
    </div>
  );
}
