import { randomUUID } from "crypto";
import type { IncomingMessage } from "http";

/**
 * The single header name used end-to-end for request correlation.
 * Every log line and every error response carries this same id.
 */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Used by pino-http's `genReqId` option. Reuses an incoming
 * `X-Request-ID` header if the caller already provided one (e.g. a
 * gateway, another internal service, or a retried client request),
 * otherwise generates a fresh UUID. This runs as part of the very first
 * Express middleware mounted on `*`, before Nest routing, guards,
 * pipes, and controllers — so no code path can skip it.
 */
export function genReqId(req: IncomingMessage): string {
  const existing = req.headers[REQUEST_ID_HEADER];
  if (typeof existing === "string" && existing.trim().length > 0) {
    return existing;
  }
  if (Array.isArray(existing) && existing[0]) {
    return existing[0];
  }
  return randomUUID();
}

/**
 * Reads the request id pino-http attached to the request object
 * (`req.id`). Falls back to a fresh UUID only if the http logger
 * middleware somehow never ran (defensive — should not happen).
 */
export function getRequestId(req: unknown): string {
  const id = (req as { id?: unknown } | undefined)?.id;
  return typeof id === "string" && id.length > 0 ? id : randomUUID();
}
