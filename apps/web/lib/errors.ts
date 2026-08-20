import { ERROR_CODES, type ErrorCode, type ErrorEnvelope } from "@platform/types";

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

  constructor(init: {
    kind: ApiErrorKind;
    status: number;
    code: ErrorCode;
    requestId: string | null;
    message: string;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
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
