import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierReplacement } from "@/lib/supplier-data";
import { replacementAction } from "@/lib/fulfilment-actions";
import { localized, formatDate } from "@/lib/localized";
import { formatQuantity } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Fact, FactList, StatusWithAction } from "@/components/trader/account-panels";
import { ErrorState } from "@/components/ui/states";
import { FulfilmentActions } from "@/components/supplier/fulfilment-actions";
import { fulfilmentLabels } from "@/components/supplier/fulfilment-labels";

/**
 * One replacement obligation: what to send, where, and by when.
 *
 * The same three transitions as an order allocation, from the same shared
 * component — identical guards, identical `ShipDto`.
 *
 * DELIVERED IS NOT A SUPPLIER ACTION. Once shipped, the next move is the
 * trader's confirmation. FAILED and DELIVERED are finished, and neither
 * offers a control.
 *
 * The dispute this arose from is a LINK, not a copy: the supplier may open
 * it under its own boundary, where the trader's evidence is filtered out.
 * The complaint text and the administrator's reasoning do not travel here.
 */
export default async function SupplierReplacementDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.replacements" });
  const status = await getTranslations({ locale: appLocale, namespace: "supplier.status" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });

  const result = await loadSupplierReplacement(id);
  if (!result.ok && result.notFound) notFound();

  const backHref = `/${appLocale}/supplier/replacement-obligations`;

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumb href={backHref} label={t("breadcrumbLabel")} back={t("backToList")} />
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      </div>
    );
  }

  const replacement = result.data;
  const action = replacementAction(replacement.status);
  const labels = await fulfilmentLabels(appLocale);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb href={backHref} label={t("breadcrumbLabel")} back={t("backToList")} />

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("detailTitle")}</h1>
        <p className="text-sm text-content-muted">
          {t("quantityLine", {
            quantity: formatQuantity(replacement.replacementQuantity, appLocale),
          })}
        </p>
      </header>

      <Card
        ariaLabel={t("statusTitle")}
        className={
          replacement.awaitingSupplierAction || replacement.status === "FAILED"
            ? "border-warning"
            : undefined
        }
      >
        <CardHeader>
          <CardTitle>{t("statusTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-4">
            <StatusWithAction
              label={t("statusLabel")}
              status={status(`replacement.${replacement.status}`)}
              action={t(`nextStep.${replacement.status}`)}
              tone={
                replacement.status === "FAILED"
                  ? "warning"
                  : replacement.status === "DELIVERED"
                    ? "success"
                    : replacement.awaitingSupplierAction
                      ? "warning"
                      : "neutral"
              }
            />

            {/* One action, or none. SHIPPED waits on the trader; DELIVERED
                and FAILED are finished. */}
            <FulfilmentActions
              resource="replacement-obligations"
              id={replacement.id}
              action={action}
              labels={labels}
            />
          </div>
        </CardBody>
      </Card>

      <Card ariaLabel={t("destinationTitle")}>
        <CardHeader>
          <CardTitle>{t("destinationTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-content-muted">{t("destinationNotice")}</p>
          <FactList>
            <Fact label={t("locationName")} value={replacement.locationName} />
            <Fact
              label={t("city")}
              value={
                localized(appLocale, replacement.cityNameAr, replacement.cityNameEn) ?? ""
              }
            />
            <Fact
              label={t("region")}
              value={
                localized(appLocale, replacement.regionNameAr, replacement.regionNameEn) ?? ""
              }
            />
            {/* The courier needs an address and someone to call. A
                coordinate is not an address and none is on this contract. */}
            <Fact label={t("address")} value={replacement.address} />
            <Fact label={t("contactName")} value={replacement.contactName} />
            <Fact label={t("contactPhone")} value={replacement.contactPhone} />
          </FactList>
        </CardBody>
      </Card>

      <Card ariaLabel={t("timelineTitle")}>
        <CardHeader>
          <CardTitle>{t("timelineTitle")}</CardTitle>
        </CardHeader>
        <CardBody>
          <FactList>
            <Fact
              label={t("createdAt")}
              value={formatDate(replacement.createdAt, appLocale) ?? ""}
            />
            {replacement.preparationStartedAt ? (
              <Fact
                label={t("preparationStartedAt")}
                value={formatDate(replacement.preparationStartedAt, appLocale) ?? ""}
              />
            ) : null}
            {replacement.readyToShipAt ? (
              <Fact
                label={t("readyToShipAt")}
                value={formatDate(replacement.readyToShipAt, appLocale) ?? ""}
              />
            ) : null}
            {replacement.shippedAt ? (
              <Fact
                label={t("shippedAt")}
                value={formatDate(replacement.shippedAt, appLocale) ?? ""}
              />
            ) : null}
            {replacement.deliveredAt ? (
              <Fact
                label={t("deliveredAt")}
                value={formatDate(replacement.deliveredAt, appLocale) ?? ""}
              />
            ) : null}
            {replacement.failedAt ? (
              <Fact
                label={t("failedAt")}
                value={formatDate(replacement.failedAt, appLocale) ?? ""}
              />
            ) : null}
            {replacement.carrierCode ? (
              <Fact label={t("carrierCode")} value={replacement.carrierCode} />
            ) : null}
            {replacement.trackingNumber ? (
              <Fact label={t("trackingNumber")} value={replacement.trackingNumber} />
            ) : null}
          </FactList>
        </CardBody>
      </Card>

      <section className="flex flex-wrap gap-3">
        <Link
          href={`/${appLocale}/supplier/orders/${replacement.orderId}`}
          className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
        >
          {t("openOrder")}
        </Link>
        {/* The dispute, as a link. Its text and evidence stay behind its
            own boundary. */}
        <Link
          href={`/${appLocale}/supplier/disputes/${replacement.disputeId}`}
          className="inline-flex min-h-11 items-center text-secondary hover:opacity-90"
        >
          {t("openDispute")}
        </Link>
      </section>
    </div>
  );
}

function Breadcrumb({ href, label, back }: { href: string; label: string; back: string }) {
  return (
    <nav aria-label={label} className="text-sm">
      <Link href={href} className="inline-flex min-h-11 items-center text-secondary hover:opacity-90">
        {back}
      </Link>
    </nav>
  );
}
