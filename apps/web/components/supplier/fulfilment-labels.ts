import { getTranslations } from "next-intl/server";
import { SUPPLIER_ALLOCATION_ACTIONS } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import type { FulfilmentActionsProps } from "./fulfilment-actions";

/**
 * Labels for the three fulfilment transitions, translated on the SERVER.
 *
 * Keyed by the ACTION SEGMENT — `start-preparation`, `mark-ready`, `ship` —
 * which is what the component receives and what the URL uses. Building the
 * map from `SUPPLIER_ALLOCATION_ACTIONS` means a segment renamed in the
 * contract fails here rather than rendering an empty button.
 *
 * Shared by order allocations and replacement obligations: the two have
 * identical transitions, identical guards and an identical `ShipDto`.
 */
export async function fulfilmentLabels(
  locale: AppLocale
): Promise<FulfilmentActionsProps["labels"]> {
  const t = await getTranslations({ locale, namespace: "supplier.fulfilment" });
  const common = await getTranslations({ locale, namespace: "common" });
  const states = await getTranslations({ locale, namespace: "states" });

  const segments = Object.values(SUPPLIER_ALLOCATION_ACTIONS);

  return {
    action: Object.fromEntries(segments.map((segment) => [segment, t(`action.${segment}`)])),
    prompt: Object.fromEntries(segments.map((segment) => [segment, t(`prompt.${segment}`)])),
    carrierCode: t("carrierCode"),
    trackingNumber: t("trackingNumber"),
    trackingHint: t("trackingHint"),
    required: common("required"),
    confirm: common("confirm"),
    cancel: common("cancel"),
    working: t("working"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
    fieldRequired: t("fieldRequired"),
  };
}
