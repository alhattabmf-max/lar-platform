import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import type { OpportunityFormLabels } from "./opportunity-form";

/** Every string the opportunity form needs, translated on the SERVER. */
export async function opportunityFormLabels(
  locale: AppLocale
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
    sectionHints: {
      what: t("sectionHints.what"),
      terms: t("sectionHints.terms"),
      window: t("sectionHints.window"),
      description: t("sectionHints.description"),
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
    hints: {
      boundsUnknown: t("hints.boundsUnknown"),
      frozenAtPublish: t("hints.frozenAtPublish"),
    },
    placeholderProduct: t("placeholderProduct"),
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
