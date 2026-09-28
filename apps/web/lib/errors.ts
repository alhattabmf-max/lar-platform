import {
  ERROR_CODES,
  readBlockedListingId,
  readBlockedReason,
  readFailedChecks,
  readInvalidFields,
  type ErrorCode,
  type ErrorEnvelope,
  type NameableInvalidField,
  type ProductTechnicalCheckCode,
  type SupplierOpportunityReasonCode,
} from "@platform/types";

/**
 * A single, type-safe representation of every API failure.
 *
 * `code` is the ONLY field the i18n layer keys off. `message` from the
 * envelope is an English developer-facing default and is never rendered
 * to end users. `details` may carry internal field paths and is
 * deliberately NOT exposed on this type — only `requestId` is surfaced,
 * so a user can quote it to support without anything internal leaking
 * into the UI.
 */
export type ApiErrorKind =
  | "unauthorized" // 401
  | "forbidden" // 403
  | "notFound" // 404
  | "conflict" // 409
  | "validation" // 422 (and 400)
  | "rateLimited" // 429
  | "server" // 5xx
  | "network" // fetch threw / no response
  | "unknown";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: ErrorCode;
  readonly requestId: string | null;
  /**
   * The ONE piece of `details` this app will read, and only in one shape.
   *
   * `details` as a whole stays unexposed: it can carry internal field
   * paths, and a general accessor would make it a channel into the UI
   * that nobody has to justify. This is a single named field, populated
   * exclusively by `readFailedChecks`, which returns a value only when
   * the error code is `PRODUCT_TECHNICAL_CHECK_FAILED`, the payload is a
   * non-empty array, and EVERY entry is in the closed
   * `PRODUCT_TECHNICAL_CHECK_CODES` vocabulary. Anything else — another
   * code, an object, one unrecognised string — leaves this null and the
   * caller falls back to the generic message.
   */
  readonly failedChecks: readonly ProductTechnicalCheckCode[] | null;

  /**
   * The SECOND named field, added for the same reason as the first and
   * under the same rule.
   *
   * A publication refused for a business reason answers
   * `VALIDATION_FAILED` — a word that names nothing a supplier can act
   * on. `readBlockedReason` returns a value only when that code is
   * present AND the payload names a member of the closed
   * `SUPPLIER_OPPORTUNITY_REASON_CODES` vocabulary, so what reaches the
   * UI is a code it already translates a fixing sentence for.
   */
  readonly blockedReason: SupplierOpportunityReasonCode | null;

  /**
   * The THIRD named field, added for the same reason as the first two
   * and under the same rule.
   *
   * A refused save answered `VALIDATION_FAILED` and showed a reference
   * number, leaving the person who typed the form to hunt for which of
   * a dozen fields was wrong. `readInvalidFields` returns names only
   * when that code is present AND each one is a member of the closed
   * `NAMEABLE_INVALID_FIELDS` vocabulary — so what reaches the UI is a
   * key it already has its own translated label for. Nothing the
   * server wrote is ever rendered.
   */
  readonly invalidFields: readonly NameableInvalidField[];

  /**
   * The listing that was saved but not published.
   *
   * Without it the form can say what is wrong and not where the work
   * went — which is what made a supplier press the button again and
   * make a second copy.
   */
  readonly blockedListingId: string | null;

  constructor(init: {
    kind: ApiErrorKind;
    status: number;
    code: ErrorCode;
    requestId: string | null;
    message: string;
    failedChecks?: readonly ProductTechnicalCheckCode[] | null;
    blockedReason?: SupplierOpportunityReasonCode | null;
    blockedListingId?: string | null;
    invalidFields?: readonly NameableInvalidField[];
  }) {
    super(init.message);
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.failedChecks = init.failedChecks ?? null;
    this.blockedReason = init.blockedReason ?? null;
    this.blockedListingId = init.blockedListingId ?? null;
    this.invalidFields = init.invalidFields ?? [];
  }

  /** i18n key for the user-visible message. */
  get translationKey(): string {
    return `errors.codes.${this.code}`;
  }
}

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 409) return "conflict";
  if (status === 422 || status === 400) return "validation";
  if (status === 429) return "rateLimited";
  if (status >= 500) return "server";
  return "unknown";
}

function fallbackCodeForStatus(status: number): ErrorCode {
  switch (kindForStatus(status)) {
    case "unauthorized":
      return ERROR_CODES.UNAUTHORIZED;
    case "forbidden":
      return ERROR_CODES.FORBIDDEN;
    case "notFound":
      return ERROR_CODES.NOT_FOUND;
    case "conflict":
      return ERROR_CODES.CONFLICT;
    case "validation":
      return ERROR_CODES.VALIDATION_FAILED;
    case "rateLimited":
      return ERROR_CODES.RATE_LIMITED;
    case "server":
      return ERROR_CODES.INTERNAL_ERROR;
    default:
      return ERROR_CODES.INTERNAL_ERROR;
  }
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { error?: unknown; requestId?: unknown };
  if (typeof candidate.error !== "object" || candidate.error === null) return false;
  const error = candidate.error as { code?: unknown; message?: unknown };
  return typeof error.code === "string" && typeof error.message === "string";
}

/**
 * Converts an HTTP response body into an ApiError. Tolerates a
 * non-envelope body (a proxy 502 page, an empty 401) by falling back to
 * a status-derived code rather than throwing while handling an error.
 */
export function mapApiError(status: number, body: unknown, headerRequestId?: string | null): ApiError {
  const kind = kindForStatus(status);

  if (isErrorEnvelope(body)) {
    return new ApiError({
      kind,
      status,
      code: body.error.code,
      requestId: body.requestId ?? headerRequestId ?? null,
      message: body.error.message,
      // Returns null unless the code matches AND every entry is in the
      // closed vocabulary. Nothing else from `details` is read.
      failedChecks: readFailedChecks(body),
      // Same rule: null unless the code matches AND the value is in the
      // closed vocabulary.
      blockedReason: readBlockedReason(body),
      invalidFields: readInvalidFields(body),
      blockedListingId: readBlockedListingId(body),
    });
  }

  return new ApiError({
    kind,
    status,
    code: fallbackCodeForStatus(status),
    requestId: headerRequestId ?? null,
    message: `Request failed with status ${status}`,
  });
}

export function networkError(cause: unknown): ApiError {
  return new ApiError({
    kind: "network",
    status: 0,
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    requestId: null,
    message: cause instanceof Error ? cause.message : "Network request failed",
  });
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
