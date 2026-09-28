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
  /**
   * A pasted map link carried no coordinates.
   *
   * ITS OWN CODE, NOT `VALIDATION_FAILED`. The screen translates an
   * error by its CODE and never by the server's sentence — so a
   * carefully worded explanation sent under the generic code arrives as
   * "the data entered is not valid", which tells an operator nothing
   * they can act on. This is exactly the fault reported: a shortened
   * `maps.app.goo.gl` link was refused, and the one useful sentence
   * about it never reached the screen.
   */
  BRANCH_LOCATION_UNREADABLE: "BRANCH_LOCATION_UNREADABLE",
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

  /**
   * FOUR IDENTITIES, ONE COMPANY EACH — and the refusal says which.
   *
   * The commercial registration number, the email address, the mobile
   * number and the tax registration number are unique across the whole
   * platform, at registration and at every later edit. These four codes
   * exist rather than a shared one because the portal translates BY
   * CODE, and a person who typed a number that is already registered
   * needs to know WHICH of the four it was.
   *
   * They name a FIELD, never a value. Nothing here reveals whose it is.
   */
  CR_NUMBER_TAKEN: "CR_NUMBER_TAKEN",
  EMAIL_TAKEN: "EMAIL_TAKEN",
  MOBILE_TAKEN: "MOBILE_TAKEN",
  VAT_NUMBER_TAKEN: "VAT_NUMBER_TAKEN",
  // Phase 4 — Taxonomy & Catalog
  SUPPLIER_NOT_VERIFIED: "SUPPLIER_NOT_VERIFIED",
  // Phase 8 — one request reviews the whole supplier record.
  //
  // Three codes rather than a shared CONFLICT, because the portal
  // translates by CODE and each of these needs a different sentence
  // and a different next step: wait, finish something, or nothing to
  // decide.
  /** The record is edited while its review is open. */
  VERIFICATION_UNDER_REVIEW: "VERIFICATION_UNDER_REVIEW",
  /** Sending a request from a state that cannot send one. */
  VERIFICATION_NOT_SUBMITTABLE: "VERIFICATION_NOT_SUBMITTABLE",
  /** Deciding a request when none is open. */
  VERIFICATION_NOT_UNDER_REVIEW: "VERIFICATION_NOT_UNDER_REVIEW",
  TAXONOMY_CYCLE_DETECTED: "TAXONOMY_CYCLE_DETECTED",
  TAXONOMY_TOO_DEEP: "TAXONOMY_TOO_DEEP",
  TAXONOMY_HAS_CHILDREN: "TAXONOMY_HAS_CHILDREN",
  TAXONOMY_HAS_PRODUCTS: "TAXONOMY_HAS_PRODUCTS",
  // Phase 7B — Checkout
  SHIPPING_TARIFF_NOT_CONFIGURED: "SHIPPING_TARIFF_NOT_CONFIGURED",
  // Phase 7C — Payment/Order/Ledger
  COMMISSION_TAX_NOT_CONFIGURED: "COMMISSION_TAX_NOT_CONFIGURED",
  PAYMENT_ATTEMPT_ALREADY_ACTIVE: "PAYMENT_ATTEMPT_ALREADY_ACTIVE",
  /**
   * THE BASKET'S MINUTES RAN OUT before the payment was started.
   *
   * ITS OWN CODE, NOT `PAYMENT_ATTEMPT_ALREADY_ACTIVE`, because the two
   * ask for opposite things. "Already active" means a payment is under
   * way on this basket and the buyer should wait or look at it; this
   * means the basket is gone and the buyer must start a new checkout,
   * where the quantity still available will be recomputed. A screen
   * that cannot tell them apart tells the buyer to wait for something
   * that will never arrive.
   *
   * THE LOCK IS NOT REVIVED OR EXTENDED. The stock it was holding went
   * back on the shelf the moment it expired, and it may already be in
   * somebody else's basket — so honouring the old lock would be
   * promising units that are no longer there.
   */
  CHECKOUT_LOCK_EXPIRED: "CHECKOUT_LOCK_EXPIRED",
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
  /**
   * Phase 8G — the four ways a header logo can be refused.
   *
   * FOUR CODES RATHER THAN ONE, because `code` is the only field the
   * web app may key a message off, and every one of these has a
   * different FIX. Collapsing them into `VALIDATION_FAILED` left an
   * operator staring at "the submitted data is not valid" with a
   * perfectly ordinary logo in the file picker and no idea whether to
   * shrink it, re-export it, or scale it up — which is exactly what
   * happened on the first real upload.
   *
   * The English text the server produces is still never rendered: it
   * names byte counts and formats for the log, and the localized
   * message is chosen from the code alone.
   */
  BRAND_LOGO_TOO_LARGE: "BRAND_LOGO_TOO_LARGE",
  BRAND_LOGO_TOO_MANY_PIXELS: "BRAND_LOGO_TOO_MANY_PIXELS",
  BRAND_LOGO_TYPE_UNSUPPORTED: "BRAND_LOGO_TYPE_UNSUPPORTED",
  BRAND_LOGO_TOO_SMALL: "BRAND_LOGO_TOO_SMALL",
  /**
   * One product, one live offer — a second publication is refused.
   *
   * The owner's rule: «لا يُنشر عرض ثانٍ على المنتج إلا بعد انتهاء
   * العرض الأول». Two live offers on one product compete for the same
   * stock and can between them sell more than the supplier holds.
   *
   * ITS OWN CODE, NOT `CONFLICT` OR `VALIDATION_FAILED`. The portal
   * chooses its sentence from the code alone, and this refusal has a
   * specific next step — wait for the running offer to end, or open it
   * — that no generic conflict message can carry. The draft the
   * supplier just saved is untouched and stays publishable later.
   *
   * NOT an `ACTION_REQUIRED` reason code. Those are a closed set with a
   * database CHECK constraint behind them, and this refusal writes
   * nothing to the row at all.
   */
  PRODUCT_ALREADY_HAS_LIVE_OFFER: "PRODUCT_ALREADY_HAS_LIVE_OFFER",

  /**
   * A removal refused because a buyer is in the middle of buying.
   *
   * «نفّذها الأربعة دام المشتري ما بعد دفع» — the owner set ONE
   * condition for removing an offer or a product, from either portal,
   * and this is the state that is not yet an answer to it: somebody is
   * holding a lock on this offer AT THIS MOMENT. Nothing has been paid,
   * so the removal is not forbidden — it is early.
   *
   * ITS OWN CODE BECAUSE THE NEXT STEP IS «TRY AGAIN». Every other
   * refusal on this path is permanent, and telling somebody to stop
   * when all they had to do was wait is the difference this code
   * carries. The lock expires on its own.
   */
  BUYER_CHECKOUT_IN_PROGRESS: "BUYER_CHECKOUT_IN_PROGRESS",

  /**
   * A removal refused because a buyer paid.
   *
   * PAYMENT IS THE LINE, and only payment. An abandoned basket leaves
   * rows behind, and those rows are the trace of an attempt — but
   * nothing was sold, nobody is owed anything and no invoice names it.
   * Money is what turns a row into a record, and a record is not
   * deleted on this platform.
   *
   * ITS OWN CODE, NOT `CONFLICT`. Both portals translate by CODE and
   * show nothing of the server's own sentence, so a shared `CONFLICT`
   * arrives as «تعارض مع الحالة الحالية للعنصر» — which names neither
   * the cause nor what to do instead. This one names both.
   */
  BUYER_ALREADY_PAID: "BUYER_ALREADY_PAID",

  /**
   * An edit refused because a buyer can reach the product.
   *
   * «إذا نشره خلاص ما يقدر يعدل عليه. لكن لو كان فيه خطأ في البيانات
   *  بعد النشر لازم الإدارة تتدخل.»
   *
   * ITS OWN CODE, so the portal can say the one thing a supplier needs
   * to hear: the way to fix a published listing is not to edit it, it is
   * to have the offer stopped and publish a corrected one. A shared
   * CONFLICT reaches him as a sentence naming neither the cause nor the
   * next step.
   */
  PRODUCT_HAS_LIVE_OFFER: "PRODUCT_HAS_LIVE_OFFER",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
