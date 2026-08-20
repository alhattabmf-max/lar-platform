export interface CreatePaymentIntentInput {
  amount: number;
  currency: string;
  idempotencyKey: string;
  merchantReference: string;
}

export type CreatePaymentIntentResult =
  | { outcome: "CREATED"; providerReference: string }
  | { outcome: "DEFINITIVE_FAILURE"; reason: string }
  | { outcome: "RETRYABLE_UNKNOWN"; reason: string };

export interface VerifiedWebhookPayload {
  merchantReference: string;
  providerReference: string;
  providerCode: string;
  providerEventId: string;
  eventType: "SUCCESS" | "FAILURE";
  currency: string;
  providerCapturedAt?: Date;
  providerCapturedAmount?: number;
  providerFeeAmount?: number;
  payloadHash: string;
}

export interface PaymentProvider {
  readonly providerCode: string;
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatePaymentIntentResult>;
  /**
   * Verifies signature + timestamp-replay window on the raw request,
   * then parses it. Returns null if verification fails — the caller
   * MUST NOT process anything from a null result, and must not log
   * the raw body/signature anywhere.
   */
  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedWebhookPayload | null;
}
