import { createHash, createHmac, timingSafeEqual } from "crypto";
import type {
  CreatePaymentIntentInput,
  CreatePaymentIntentResult,
  PaymentProvider,
  VerifiedWebhookPayload,
} from "./payment-provider.interface";

const MOCK_SECRET = "mock-payment-provider-signing-secret-do-not-use-in-production";
const TIMESTAMP_TOLERANCE_MS = 5 * 60_000;

export class MockPaymentProvider implements PaymentProvider {
  readonly providerCode = "MOCK";
  private nextCreateIntentResult: CreatePaymentIntentResult | null = null;

  /** Test-only: forces the next createPaymentIntent() call to return this result. */
  setNextCreateIntentResult(result: CreatePaymentIntentResult | null): void {
    this.nextCreateIntentResult = result;
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatePaymentIntentResult> {
    if (this.nextCreateIntentResult) {
      const forced = this.nextCreateIntentResult;
      this.nextCreateIntentResult = null;
      return forced;
    }
    return { outcome: "CREATED", providerReference: `mock_ref_${input.merchantReference}` };
  }

  buildSignedWebhook(payload: {
    merchantReference: string;
    providerReference: string;
    providerEventId: string;
    eventType: "SUCCESS" | "FAILURE";
    currency?: string;
    providerCapturedAt?: Date;
    providerCapturedAmount?: number;
    providerFeeAmount?: number;
    timestampOverride?: Date;
  }): { rawBody: Buffer; headers: Record<string, string> } {
    const body = {
      merchantReference: payload.merchantReference,
      providerReference: payload.providerReference,
      providerEventId: payload.providerEventId,
      eventType: payload.eventType,
      currency: payload.currency ?? "SAR",
      providerCapturedAt: payload.providerCapturedAt?.toISOString(),
      providerCapturedAmount: payload.providerCapturedAmount,
      providerFeeAmount: payload.providerFeeAmount,
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = (payload.timestampOverride ?? new Date()).getTime().toString();
    const signature = createHmac("sha256", MOCK_SECRET).update(`${timestamp}.${rawBody.toString()}`).digest("hex");
    return { rawBody, headers: { "x-mock-timestamp": timestamp, "x-mock-signature": signature } };
  }

  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedWebhookPayload | null {
    const timestampHeader = headers["x-mock-timestamp"];
    const signatureHeader = headers["x-mock-signature"];
    if (typeof timestampHeader !== "string" || typeof signatureHeader !== "string") return null;

    const expectedSignature = createHmac("sha256", MOCK_SECRET).update(`${timestampHeader}.${rawBody.toString()}`).digest("hex");
    const expectedBuf = Buffer.from(expectedSignature, "hex");
    const actualBuf = Buffer.from(signatureHeader, "hex");
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null;

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
      providerCapturedAt: parsed.providerCapturedAt ? new Date(parsed.providerCapturedAt as string) : undefined,
      providerCapturedAmount: typeof parsed.providerCapturedAmount === "number" ? parsed.providerCapturedAmount : undefined,
      providerFeeAmount: typeof parsed.providerFeeAmount === "number" ? parsed.providerFeeAmount : undefined,
      payloadHash,
    };
  }
}
