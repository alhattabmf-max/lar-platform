/**
 * Error Envelope contract — the single shape every API error response
 * must follow (Blueprint v4.2, §Error Envelope / Phase 1 DoD).
 *
 * `code` is the ONLY field the web app's i18n layer may key off to choose
 * the localized (ar-SA / en-SA) message shown to the user. `message` is an
 * English, developer-facing default for logs and non-i18n API consumers —
 * it must never be rendered directly to end users.
 */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
  timestamp: string;
}

/**
 * Phase 1 error code catalogue. This is a closed, growing enum — new
 * codes are added here as new modules ship, never invented ad hoc inside
 * a controller. See docs/error-codes.md for the human-readable catalogue
 * and the localized message key each one maps to in apps/web.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  // Phase 2 — Identity & Companies
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_VERIFICATION_REQUIRED: "EMAIL_VERIFICATION_REQUIRED",
  POLICY_REACCEPTANCE_REQUIRED: "POLICY_REACCEPTANCE_REQUIRED",
  REGISTRATION_UNAVAILABLE: "REGISTRATION_UNAVAILABLE",
  CR_ALREADY_REGISTERED: "CR_ALREADY_REGISTERED",
  EMAIL_ALREADY_REGISTERED: "EMAIL_ALREADY_REGISTERED",
  // Phase 4 — Taxonomy & Catalog
  SUPPLIER_NOT_VERIFIED: "SUPPLIER_NOT_VERIFIED",
  TAXONOMY_CYCLE_DETECTED: "TAXONOMY_CYCLE_DETECTED",
  // Phase 7B — Checkout
  SHIPPING_TARIFF_NOT_CONFIGURED: "SHIPPING_TARIFF_NOT_CONFIGURED",
  // Phase 7C — Payment/Order/Ledger
  COMMISSION_TAX_NOT_CONFIGURED: "COMMISSION_TAX_NOT_CONFIGURED",
  PAYMENT_ATTEMPT_ALREADY_ACTIVE: "PAYMENT_ATTEMPT_ALREADY_ACTIVE",
  INVALID_WEBHOOK_SIGNATURE: "INVALID_WEBHOOK_SIGNATURE",
  // Phase 7D — Fulfillment/Shipping
  INVALID_FULFILLMENT_TRANSITION: "INVALID_FULFILLMENT_TRANSITION",
  UNKNOWN_CARRIER: "UNKNOWN_CARRIER",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
