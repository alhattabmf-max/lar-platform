import { getTranslations } from "next-intl/server";
import type { OpportunityLimits } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import type { OpportunityFormLabels } from "./opportunity-form";

/**
 * Every string the opportunity form needs, translated on the SERVER.
 *
 * `limits` is optional because the policy read can fail. When it is
 * absent the bounds hint has no figures in it and the four warnings are
 * never shown — the form does not invent a bound it could not read.
 */
export async function opportunityFormLabels(
  locale: AppLocale,
  limits?: OpportunityLimits
): Promise<OpportunityFormLabels> {
  const t = await getTranslations({ locale, namespace: "supplier.opportunities.form" });
  const common = await getTranslations({ locale, namespace: "common" });
  const states = await getTranslations({ locale, namespace: "states" });

  return {
    sections: {
      what: t("sections.what"),
      terms: t("sections.terms"),
      window: t("sections.window"),
      description: t("sections.description"),
    },
    fields: {
      productId: t("fields.productId"),
      fulfillmentLocationId: t("fields.fulfillmentLocationId"),
      targetQuantity: t("fields.targetQuantity"),
      unitPriceAmount: t("fields.unitPriceAmount"),
      startAt: t("fields.startAt"),
      endAt: t("fields.endAt"),
      expectedPreparationDays: t("fields.expectedPreparationDays"),
      descriptionAr: t("fields.descriptionAr"),
      descriptionEn: t("fields.descriptionEn"),
    },
    warnings: {
      quantityTooLow: limits
        ? t("warnings.quantityTooLow", { minQuantity: limits.minTargetQuantity })
        : "",
      quantityTooHigh: limits
        ? t("warnings.quantityTooHigh", { maxQuantity: limits.maxTargetQuantity })
        : "",
      durationTooShort: limits
        ? t("warnings.durationTooShort", { minHours: limits.minDurationHours })
        : "",
      durationTooLong: limits
        ? t("warnings.durationTooLong", { maxDays: limits.maxDurationDays })
        : "",
    },
    placeholderProduct: t("placeholderProduct"),
    searchProduct: t("searchProduct"),
    noMatchingProduct: t("noMatchingProduct"),
    placeholderLocation: t("placeholderLocation"),
    noProducts: t("noProducts"),
    required: common("required"),
    submitCreate: t("submitCreate"),
    submitEdit: t("submitEdit"),
    submitting: t("submitting"),
    cancel: common("cancel"),
    cancelPrompt: t("cancelPrompt"),
    close: common("close"),
    errorSummaryTitle: t("errorSummaryTitle"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
    noChanges: t("noChanges"),
    fixHere: t.raw("fixHere"),
  };
}
