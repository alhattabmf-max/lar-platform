export interface ExecuteRefundInput {
  amount: number;
  currency: string;
  idempotencyKey: string;
  merchantReference: string; // RefundAttempt.id — never a business-domain id
}

export type ExecuteRefundResult =
  | { outcome: "SENT"; providerReference: string }
  | { outcome: "SUCCEEDED"; providerReference: string } // some providers confirm synchronously
  | { outcome: "DEFINITIVE_FAILURE"; reason: string }
  | { outcome: "RETRYABLE_UNKNOWN"; reason: string };

export interface VerifiedRefundWebhookPayload {
  merchantReference: string; // RefundAttempt.id
  providerReference: string;
  providerCode: string;
  providerEventId: string;
  eventType: "SUCCESS" | "FAILURE";
  currency: string;
  amount?: number;
  payloadHash: string;
}

export interface RefundProvider {
  readonly providerCode: string;
  executeRefund(input: ExecuteRefundInput): Promise<ExecuteRefundResult>;
  /**
   * Verifies signature + timestamp-replay window on the raw request,
   * then parses it. Returns null if verification fails — the caller
   * MUST NOT process anything from a null result, and must not log
   * the raw body/signature anywhere.
   */
  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): VerifiedRefundWebhookPayload | null;
}
