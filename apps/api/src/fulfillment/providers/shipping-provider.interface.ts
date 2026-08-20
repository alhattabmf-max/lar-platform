export interface VerifiedCarrierEventPayload {
  orderAllocationReference: string;
  carrierCode: string;
  carrierEventId: string;
  eventType: "PICKED_UP" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "DELIVERY_FAILED" | "EXCEPTION";
  eventOccurredAt: Date;
  payloadHash: string;
}

export interface ShippingProvider {
  readonly carrierCode: string;
  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedCarrierEventPayload | null;
}
