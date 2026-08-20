import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { AppLocale } from "@/i18n/routing";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { BannerSlot } from "@/components/banners/banner-slot";
import { loadOpportunities } from "@/lib/marketplace-data";
import { MARKETPLACE_DEFAULT_SORT } from "@/lib/marketplace-query";
import {
  OpportunityCard,
  remainingDays,
  CLOSING_SOON_DAYS,
} from "@/components/opportunities/opportunity-card";

/** How many opportunities the landing page previews before sending you to the full list. */
const FEATURED_COUNT = 6;

/**
 * The public landing page.
 *
 * Shows the opportunities closing soonest — the ones a visitor can act
 * on now — rather than a static marketing panel. Like every other
 * public surface it carries no commercial terms; the cards show what
 * the anonymous contract provides and nothing more.
 *
 * A failed listing read degrades to the hero and the calls to action.
 * The landing page is also the site's front door, and refusing to
 * render it because a listing query failed would be a strictly worse
 * outcome than showing it without the preview.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  const t = await getTranslations({ locale: appLocale, namespace: "home" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });
  const login = await getTranslations({ locale: appLocale, namespace: "auth.login" });
  const register = await getTranslations({ locale: appLocale, namespace: "register" });

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-6">
        <h1 className="text-2xl font-semibold text-content sm:text-3xl">{t("title")}</h1>
        <p className="max-w-2xl text-sm text-content-muted sm:text-base">{t("description")}</p>

        <div className="flex flex-wrap gap-3">
          <ButtonLink href={`/${appLocale}/opportunities`} variant="accentInteractive">
            {t("browseOpportunities")}
          </ButtonLink>
          <ButtonLink href={`/${appLocale}/login`} variant="secondary">
            {login("submit")}
          </ButtonLink>
          <ButtonLink href={`/${appLocale}/register`} variant="ghost">
            {register("submit")}
          </ButtonLink>
        </div>
      </section>

      <Suspense fallback={null}>
        <BannerSlot placement="PUBLIC_HOME" locale={appLocale} regionLabel={t("bannersLabel")} />
      </Suspense>

      <section aria-labelledby="featured-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="featured-heading" className="text-xl font-semibold text-content">
            {t("featuredTitle")}
          </h2>
          <Link
            href={`/${appLocale}/opportunities`}
            className="text-sm text-secondary hover:opacity-90"
          >
            {t("viewAll")}
          </Link>
        </div>

        <Suspense fallback={<LoadingState label={common("loading")} rows={3} />}>
          <FeaturedOpportunities locale={appLocale} />
        </Suspense>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold text-content">{t("policiesTitle")}</h2>
        <p className="text-sm text-content-muted">{t("policiesDescription")}</p>
        <p>
          <Link href={`/${appLocale}/policies`} className="text-sm text-secondary hover:opacity-90">
            {t("readPolicies")}
          </Link>
        </p>
      </section>
    </div>
  );
}

/**
 * The closing-soonest opportunities.
 *
 * A failed read degrades to the same empty state as "none published
 * yet": the front door must render either way, and there is nothing a
 * visitor can do about a listing query that failed. The full
 * marketplace, one click away, shows the real error with its request id.
 */
async function FeaturedOpportunities({ locale }: { locale: AppLocale }) {
  const marketplace = await getTranslations({ locale, namespace: "marketplace" });

  const featured = await loadOpportunities({
    page: 1,
    pageSize: FEATURED_COUNT,
    sort: MARKETPLACE_DEFAULT_SORT,
  });
  const items = featured.ok ? featured.data.items : [];

  if (items.length === 0) {
    return (
      <EmptyState
        title={marketplace("empty.title")}
        description={marketplace("empty.description")}
      />
    );
  }

  return (
    <ul className="grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((opportunity) => {
        const days = remainingDays(opportunity.endAt);
        const closingSoon = days !== null && days <= CLOSING_SOON_DAYS;

        return (
          <li key={opportunity.id}>
            <OpportunityCard
              opportunity={opportunity}
              locale={locale}
              labels={{
                cityLabel: marketplace("card.city"),
                unitLabel: marketplace("card.unit"),
                closesLabel: marketplace("card.closes"),
                closesIn: days === null ? null : marketplace("card.closesInDays", { days }),
                closingSoonBadge: closingSoon ? marketplace("card.closingSoon") : null,
                scheduledBadge: marketplace("card.scheduled"),
                noImage: marketplace("card.noImage"),
                viewDetails: marketplace("card.viewDetails"),
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}
