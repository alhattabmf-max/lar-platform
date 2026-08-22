import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadTraderLocations } from "@/lib/trader-data";
import { loadCities } from "@/lib/marketplace-data";
import { localized } from "@/lib/localized";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Fact, FactList } from "@/components/trader/account-panels";

/**
 * The trader's delivery branches.
 *
 * These are the destinations checkout allocates quantity to, so this
 * page uses DELIVERY wording throughout — distinct from the
 * marketplace's "ships from", which is the supplier's origin city.
 *
 * Read-only in 8D: the create, update, set-default and delete
 * endpoints all exist, but no editing screen is built, and a button
 * that opens nothing is worse than no button.
 *
 * Coordinates are stored on every location and are deliberately not
 * shown. A latitude is not an address, and the person reading this
 * already knows where their own branch is.
 */
export default async function TraderLocationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({ locale: appLocale, namespace: "trader.account" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const locations = await loadTraderLocations();

  // City names live in the geography reference data, not on the
  // location row. This read is independent: if it fails, the branch
  // list still renders — with the city omitted rather than with an id
  // shown in its place.
  const cities = await loadCities();
  const cityName = (cityId: string): string | null => {
    if (!cities.ok) return null;
    const city = cities.data.find((c) => c.id === cityId);
    return city ? localized(appLocale, city.nameAr, city.nameEn) : null;
  };

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumbLabel")} className="text-sm">
        <Link href={`/${appLocale}/trader/account`} className="text-secondary hover:opacity-90">
          {t("backToAccount")}
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("locations.title")}</h1>
        <p className="text-sm text-content-muted">{t("locations.description")}</p>
      </header>

      {!locations.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={locations.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : locations.data.length === 0 ? (
        <EmptyState
          title={t("locations.emptyTitle")}
          description={t("locations.emptyDescription")}
        />
      ) : (
        <ul className="flex list-none flex-col gap-4">
          {locations.data.map((location) => {
            const city = cityName(location.cityId);
            return (
              <li key={location.id}>
                <Card ariaLabel={location.name}>
                  <CardHeader>
                    <CardTitle>
                      {location.name}
                      {location.isDefault ? (
                        <span className="ms-2 rounded border border-line px-2 py-0.5 text-xs font-normal text-content-muted">
                          {t("locations.default")}
                        </span>
                      ) : null}
                    </CardTitle>
                  </CardHeader>
                  <CardBody>
                    <FactList>
                      {city ? <Fact label={t("locations.city")} value={city} /> : null}
                      <Fact label={t("locations.address")} value={location.shortAddress} />
                      <Fact label={t("locations.contactName")} value={location.contactName} />
                      <Fact
                        label={t("locations.contactPhone")}
                        value={<span dir="ltr">{location.contactPhone}</span>}
                      />
                    </FactList>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
