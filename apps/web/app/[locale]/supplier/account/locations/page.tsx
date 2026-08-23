import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierLocations } from "@/lib/supplier-data";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Fact, FactList } from "@/components/trader/account-panels";
import { EmptyState, ErrorState } from "@/components/ui/states";

/**
 * The company's registered locations.
 *
 * A location is its NAME, its address and someone to call. The stored
 * coordinates are deliberately not requested and not displayed: a
 * latitude is not an address, it helps nobody read their own site
 * list, and there is no sentinel or city-centroid stand-in anywhere in
 * this product for one that is missing.
 */
export default async function SupplierLocationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.account" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const locations = await loadSupplierLocations();

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumbLabel")} className="text-sm">
        <Link
          href={`/${appLocale}/supplier/account`}
          className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
        >
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
          {locations.data.map((location) => (
            <li key={location.id}>
              <Card>
                <CardHeader>
                  <CardTitle>
                    {location.name}
                    {location.isDefault ? (
                      <span className="ms-2 rounded-md border border-line px-2 py-0.5 text-xs font-normal text-content-muted">
                        {t("locations.defaultBadge")}
                      </span>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardBody>
                  <FactList>
                    <Fact label={t("locations.address")} value={location.shortAddress} />
                    <Fact label={t("locations.contactName")} value={location.contactName} />
                    <Fact label={t("locations.contactPhone")} value={location.contactPhone} />
                  </FactList>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
