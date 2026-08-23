import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import type { ProductFormLabels } from "./product-form";

/**
 * Every string the product form needs, translated on the SERVER.
 *
 * The form is a client component and takes its copy as props, which is the
 * pattern the rest of this app uses: the translations are resolved where the
 * request's locale is already known, and the client bundle carries no
 * message catalogue.
 *
 * Assembled once here rather than inline in both pages, because create and
 * edit must not drift into showing different labels for the same field.
 */
export async function productFormLabels(locale: AppLocale): Promise<ProductFormLabels> {
  const t = await getTranslations({ locale, namespace: "supplier.products.form" });
  const common = await getTranslations({ locale, namespace: "common" });
  const states = await getTranslations({ locale, namespace: "states" });

  return {
    sections: {
      identity: t("sections.identity"),
      classification: t("sections.classification"),
      packaging: t("sections.packaging"),
      dimensions: t("sections.dimensions"),
    },
    sectionHints: {
      identity: t("sectionHints.identity"),
      classification: t("sectionHints.classification"),
      packaging: t("sectionHints.packaging"),
      dimensions: t("sectionHints.dimensions"),
    },
    fields: {
      taxonomyNodeId: t("fields.taxonomyNodeId"),
      salesUnitId: t("fields.salesUnitId"),
      salesUnitNameAr: t("fields.salesUnitNameAr"),
      salesUnitNameEn: t("fields.salesUnitNameEn"),
      nameAr: t("fields.nameAr"),
      nameEn: t("fields.nameEn"),
      descriptionAr: t("fields.descriptionAr"),
      descriptionEn: t("fields.descriptionEn"),
      weightPerUnit: t("fields.weightPerUnit"),
      lengthCm: t("fields.lengthCm"),
      widthCm: t("fields.widthCm"),
      heightCm: t("fields.heightCm"),
      packageContentQuantity: t("fields.packageContentQuantity"),
      packageContentUnitNameAr: t("fields.packageContentUnitNameAr"),
      packageContentUnitNameEn: t("fields.packageContentUnitNameEn"),
    },
    hints: {
      salesUnitId: t("hints.salesUnitId"),
      packageGroup: t("hints.packageGroup"),
      snapshotNames: t("hints.snapshotNames"),
    },
    placeholderTaxonomy: t("placeholderTaxonomy"),
    placeholderSalesUnit: t("placeholderSalesUnit"),
    required: common("required"),
    optional: t("optional"),
    submitCreate: t("submitCreate"),
    submitEdit: t("submitEdit"),
    submitting: t("submitting"),
    cancel: common("cancel"),
    cancelPrompt: t("cancelPrompt"),
    errorSummaryTitle: t("errorSummaryTitle"),
    checkSummaryTitle: t("checkSummaryTitle"),
    errorTitle: states("errorTitle"),
    requestIdLabel: states("requestIdLabel"),
    noChanges: t("noChanges"),
  };
}
