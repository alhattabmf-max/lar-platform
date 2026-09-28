import type { NameableInvalidField } from "@platform/types";
import {
  ERROR_CODES,
  type ErrorCode,
  type SupplierOpportunityReasonCode,
} from "@platform/types";
import { isApiError, type ApiError } from "./errors";

/**
 * The CLOSED mapping from an API failure to something a user may read.
 *
 * Two rules, both load-bearing:
 *
 *   1. Only codes in the shared catalogue produce a specific message.
 *      Anything else — an unrecognised code, a thrown Error, a string,
 *      a proxy's HTML page — collapses to one generic message.
 *
 *   2. NOTHING from the failure itself is ever rendered. Not
 *      `error.message` (an English developer string), not
 *      `details` (which can carry internal field paths), not a stack.
 *      The only value that crosses to the UI is `requestId`, which is
 *      an opaque correlation id a user can quote to support.
 *
 * The result is that a caller cannot leak internals by forgetting to
 * handle a case: the default path is the safe one.
 */

export interface UserFacingError {
  /** i18n key under `errors.` — always resolvable. */
  messageKey: string;
  /** Opaque correlation id, safe to display. Null when unknown. */
  requestId: string | null;
  /** Drives affordances such as offering sign-in links. */
  kind: ApiError["kind"] | "unknown";
  /**
   * The rule that refused a publication, when the platform named one.
   *
   * Carried through so a caller can show the sentence that says what to
   * DO about it — `supplier.opportunities.reasonFix.*` — instead of
   * "VALIDATION_FAILED", which names nothing a supplier can act on.
   * Null everywhere else, which is every other failure in the app.
   */
  blockedReason: SupplierOpportunityReasonCode | null;

  /**
   * WHICH FIELDS THE SERVER REFUSED, as names this build already knows.
   *
   * THE COMPLAINT THIS ANSWERS: a refused save showed «البيانات المُدخلة
   * غير صحيحة» and a reference number, and left the person who typed
   * the form to find which of a dozen fields was wrong. The server DID
   * say; the portal threw it away.
   *
   * RULE 2 IS NOT WAIVED. Nothing the server wrote is rendered — only
   * a MATCH against a closed list survives, and what the screen shows
   * is this application's own translated label for that field. An
   * unrecognised name yields nothing and the generic message stands.
   */
  invalidFields: readonly NameableInvalidField[];
}

const KNOWN_CODES: ReadonlySet<string> = new Set(Object.values(ERROR_CODES));

function isKnownCode(code: string): code is ErrorCode {
  return KNOWN_CODES.has(code);
}

/**
 * Converts anything thrown into a safe, translated-by-key description.
 *
 * Deliberately accepts `unknown`: a catch block receives whatever was
 * thrown, and forcing callers to narrow first is how internal text ends
 * up rendered "just this once".
 */
export function toUserFacingError(error: unknown): UserFacingError {
  if (!isApiError(error)) {
    // A non-API throw — a bug, a network stack error, anything. Its
    // message may contain a file path or a stack fragment, so it is
    // discarded entirely.
    return {
      messageKey: "errors.unknown",
      requestId: null,
      kind: "unknown",
      blockedReason: null,
      invalidFields: [],
    };
  }

  if (error.kind === "network") {
    return {
      messageKey: "errors.network",
      requestId: null,
      kind: "network",
      blockedReason: null,
      invalidFields: [],
    };
  }

  if (isKnownCode(error.code)) {
    return {
      messageKey: `errors.codes.${error.code}`,
      requestId: error.requestId,
      kind: error.kind,
      blockedReason: error.blockedReason,
      invalidFields: error.invalidFields,
    };
  }

  // A code the server knows and this build does not — after a deploy
  // skew, say. The requestId is still useful for support.
  return {
    messageKey: "errors.unknown",
    requestId: error.requestId,
    kind: error.kind,
    blockedReason: error.blockedReason,
    invalidFields: error.invalidFields,
  };
}

/**
 * True when the failure means "these details cannot be used to
 * register", so the form can offer sign-in and recovery links.
 *
 * This is the single neutral conflict: the API deliberately does not
 * say whether the commercial registration number or the email is the
 * one already taken, because answering that would let an attacker
 * enumerate who is on the platform. The UI must not speculate either.
 */
export function isRegistrationConflict(error: unknown): boolean {
  return isApiError(error) && error.code === ERROR_CODES.REGISTRATION_CONFLICT;
}

/** True when the user must re-accept updated policies — a fixable state. */
export function isPolicyReacceptanceRequired(error: unknown): boolean {
  return isApiError(error) && error.code === ERROR_CODES.POLICY_REACCEPTANCE_REQUIRED;
}
