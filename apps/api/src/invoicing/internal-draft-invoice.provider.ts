import { Injectable } from "@nestjs/common";

/**
 * Generates internalDocumentReference values for INTERNAL_*_DRAFT
 * documents only. These are NOT tax invoice numbers, carry no ZATCA
 * meaning, and are never submitted for clearance/reporting. The
 * "DRAFT-" prefix makes this unmistakable in every log, UI, and
 * export until a real ZATCA-integrated provider replaces this one.
 */
@Injectable()
export class InternalDraftInvoiceProvider {
  generateReference(documentType: "INTERNAL_PRODUCT_DRAFT" | "INTERNAL_COMMISSION_DRAFT" | "INTERNAL_ADJUSTMENT_DRAFT"): string {
    const shortType = documentType === "INTERNAL_PRODUCT_DRAFT" ? "PROD" : documentType === "INTERNAL_COMMISSION_DRAFT" ? "COMM" : "ADJ";
    return `DRAFT-${shortType}-${crypto.randomUUID()}`;
  }
}
