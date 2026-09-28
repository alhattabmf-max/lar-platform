import Link from "next/link";
import { Boxes } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";

/**
 * THE WAY INTO THE MARKET, for a screen with no tab row.
 *
 * «الزائر على الجوال والآيباد لا يصل إلى السوق» — measured before this
 * existed: at 390 and at 768 the number of VISIBLE links to
 * `/opportunities` on the visitor's home page was zero. The only one
 * was «تصفّح المنتجات» in the strip, and the strip is `hidden lg:`.
 *
 * THE MARKET HAS NO TAB TO ADD IT TO. On the visitor's map and the
 * buyer's alike it is a page the home tab `covers`, deliberately — so
 * the fix is not a new tab (that would change the approved wide-screen
 * design) but a destination in the drawer, which only a narrow screen
 * ever opens.
 *
 * IT REUSES THE OWNER'S OWN WORDS AND GLYPH — `shell.nav.viewAll`
 * («تصفّح المنتجات») and the stacked boxes he chose for it, so the
 * phone and the wide screen name the same place the same way.
 *
 * FORTY-FOUR TALL, like every row in that drawer.
 */
export async function PortalMarketLink({
  locale,
  basePath,
}: {
  locale: AppLocale;
  /** `/ar-SA` for the visitor, `/ar-SA/trader` for the buyer. */
  basePath: string;
}) {
  const t = await getTranslations({ locale, namespace: "shell.nav" });

  return (
    <Link
      href={`${basePath}/opportunities`}
      data-testid="nav-drawer-market"
      className="flex min-h-nav items-center gap-2 rounded-control px-3 py-2 text-sm text-content hover:bg-[color-mix(in_srgb,var(--color-primary)_6%,var(--color-surface))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
    >
      <Boxes aria-hidden="true" className="size-4 shrink-0" />
      {t("viewAll")}
    </Link>
  );
}
