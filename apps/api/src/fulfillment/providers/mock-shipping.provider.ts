import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { ShippingProvider, VerifiedCarrierEventPayload } from "./shipping-provider.interface";

const MOCK_SECRET = "mock-shipping-provider-signing-secret-do-not-use-in-production";
const TIMESTAMP_TOLERANCE_MS = 5 * 60_000;

export class MockShippingProvider implements ShippingProvider {
  readonly carrierCode = "MOCK_CARRIER";

  buildSignedWebhook(payload: {
    orderAllocationReference: string;
    carrierCode?: string;
    carrierEventId: string;
    eventType: VerifiedCarrierEventPayload["eventType"];
    eventOccurredAt: Date;
    timestampOverride?: Date;
  }): { rawBody: Buffer; headers: Record<string, string> } {
    const body = {
      orderAllocationReference: payload.orderAllocationReference,
      carrierCode: payload.carrierCode ?? this.carrierCode,
      carrierEventId: payload.carrierEventId,
      eventType: payload.eventType,
      eventOccurredAt: payload.eventOccurredAt.toISOString(),
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = (payload.timestampOverride ?? new Date()).getTime().toString();
    const signature = createHmac("sha256", MOCK_SECRET).update(`${timestamp}.${rawBody.toString()}`).digest("hex");
    return { rawBody, headers: { "x-mock-shipping-timestamp": timestamp, "x-mock-shipping-signature": signature } };
  }

  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedCarrierEventPayload | null {
    const timestampHeader = headers["x-mock-shipping-timestamp"];
    const signatureHeader = headers["x-mock-shipping-signature"];
    if (typeof timestampHeader !== "string" || typeof signatureHeader !== "string") return null;

    const expectedSignature = createHmac("sha256", MOCK_SECRET).update(`${timestampHeader}.${rawBody.toString()}`).digest("hex");
    const expectedBuf = Buffer.from(expectedSignature, "hex");
    // Only run timingSafeEqual once lengths already match — a length
    // mismatch is itself not secret, so comparing lengths first is
    // safe, and timingSafeEqual would throw (not return false) on
    // unequal-length buffers.
    let actualBuf: Buffer;
    try {
      actualBuf = Buffer.from(signatureHeader, "hex");
    } catch {
      return null;
    }
    if (expectedBuf.length !== actualBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, actualBuf)) return null;

    const sentAt = Number(timestampHeader);
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > TIMESTAMP_TOLERANCE_MS) return null;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody.toString());
    } catch {
      return null;
    }

    const carrierCodeInPayload = String(parsed.carrierCode ?? "");
    if (carrierCodeInPayload !== this.carrierCode) return null;

    const eventOccurredAt = parsed.eventOccurredAt ? new Date(parsed.eventOccurredAt as string) : null;
    if (!eventOccurredAt || Number.isNaN(eventOccurredAt.getTime())) return null;
    if (eventOccurredAt.getTime() - Date.now() > TIMESTAMP_TOLERANCE_MS) return null;

    const payloadHash = createHash("sha256").update(rawBody).digest("hex");

    return {
      orderAllocationReference: String(parsed.orderAllocationReference),
      carrierCode: this.carrierCode,
      carrierEventId: String(parsed.carrierEventId),
      eventType: parsed.eventType as VerifiedCarrierEventPayload["eventType"],
      eventOccurredAt,
      payloadHash,
    };
  }
}
