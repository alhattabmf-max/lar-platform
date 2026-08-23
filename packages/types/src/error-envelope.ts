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
  /**
   * The single, neutral response to ANY registration identity conflict
   * — commercial registration number, email address, or any future
   * login identifier.
   *
   * Deliberately one code rather than several. A per-field code is an
   * enumeration oracle: an attacker submits a registration and learns
   * from the response whether a given CR number or email is already on
   * the platform. Collapsing them means a caller learns only that these
   * details cannot be used, which is all a legitimate user needs to
   * decide to sign in or recover access instead.
   *
   * The per-field codes that used to exist here were REMOVED rather
   * than deprecated: a code absent from this catalogue cannot be
   * returned, which makes the boundary structural instead of a
   * convention someone has to remember.
   *
   * The precise reason is still recorded server-side (see
   * AuthService.register) — never in the response.
   */
  REGISTRATION_CONFLICT: "REGISTRATION_CONFLICT",
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
  /**
   * Phase 8E — a product failed the automatic technical checks.
   *
   * Its own code rather than `VALIDATION_FAILED` because it is the only
   * failure that carries machine-readable per-check detail: the response
   * pairs it with `details.failedChecks`, a list drawn from the closed
   * `PRODUCT_TECHNICAL_CHECK_CODES` vocabulary. Sharing a code with
   * ordinary DTO validation would leave a client unable to tell which
   * shape of `details` it is looking at without guessing.
   *
   * The English text the checks used to produce is never sent.
   */
  PRODUCT_TECHNICAL_CHECK_FAILED: "PRODUCT_TECHNICAL_CHECK_FAILED",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
