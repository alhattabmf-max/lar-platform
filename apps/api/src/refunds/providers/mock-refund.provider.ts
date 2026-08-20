import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { ExecuteRefundInput, ExecuteRefundResult, RefundProvider, VerifiedRefundWebhookPayload } from "./refund-provider.interface";

const MOCK_SECRET = "mock-refund-provider-signing-secret-do-not-use-in-production";
const TIMESTAMP_TOLERANCE_MS = 5 * 60_000;

export class MockRefundProvider implements RefundProvider {
  readonly providerCode = "MOCK_REFUND";
  private nextExecuteRefundResult: ExecuteRefundResult | null = null;
  private nextExecuteRefundThrows: Error | null = null;

  setNextExecuteRefundResult(result: ExecuteRefundResult | null): void {
    this.nextExecuteRefundResult = result;
  }

  /** Test-only: simulates a crash/network failure during the external call itself. */
  setNextExecuteRefundThrows(error: Error | null): void {
    this.nextExecuteRefundThrows = error;
  }

  async executeRefund(input: ExecuteRefundInput): Promise<ExecuteRefundResult> {
    if (this.nextExecuteRefundThrows) {
      const err = this.nextExecuteRefundThrows;
      this.nextExecuteRefundThrows = null;
      throw err;
    }
    if (this.nextExecuteRefundResult) {
      const forced = this.nextExecuteRefundResult;
      this.nextExecuteRefundResult = null;
      return forced;
    }
    return { outcome: "SENT", providerReference: `mock_refund_ref_${input.merchantReference}` };
  }

  buildSignedWebhook(payload: {
    merchantReference: string;
    providerReference: string;
    providerEventId: string;
    eventType: "SUCCESS" | "FAILURE";
    currency?: string;
    amount?: number;
    timestampOverride?: Date;
  }): { rawBody: Buffer; headers: Record<string, string> } {
    const body = {
      merchantReference: payload.merchantReference,
      providerReference: payload.providerReference,
      providerEventId: payload.providerEventId,
      eventType: payload.eventType,
      currency: payload.currency ?? "SAR",
      amount: payload.amount,
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = (payload.timestampOverride ?? new Date()).getTime().toString();
    const signature = createHmac("sha256", MOCK_SECRET).update(`${timestamp}.${rawBody.toString()}`).digest("hex");
    return { rawBody, headers: { "x-mock-refund-timestamp": timestamp, "x-mock-refund-signature": signature } };
  }

  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedRefundWebhookPayload | null {
    const timestampHeader = headers["x-mock-refund-timestamp"];
    const signatureHeader = headers["x-mock-refund-signature"];
    if (typeof timestampHeader !== "string" || typeof signatureHeader !== "string") return null;

    const expectedSignature = createHmac("sha256", MOCK_SECRET).update(`${timestampHeader}.${rawBody.toString()}`).digest("hex");
    const expectedBuf = Buffer.from(expectedSignature, "hex");
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

    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const eventType = parsed.eventType === "SUCCESS" ? "SUCCESS" : "FAILURE";

    return {
      merchantReference: String(parsed.merchantReference),
      providerReference: String(parsed.providerReference),
      providerCode: this.providerCode,
      providerEventId: String(parsed.providerEventId),
      eventType,
      currency: String(parsed.currency ?? "SAR"),
      amount: typeof parsed.amount === "number" ? parsed.amount : undefined,
      payloadHash,
    };
  }
}
