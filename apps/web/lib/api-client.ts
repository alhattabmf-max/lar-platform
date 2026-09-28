import { API_PREFIX, isBrowser, resolveApiBaseUrl } from "./env";
import { ApiError, mapApiError, networkError } from "./errors";
import type { IdempotencyKey } from "./idempotency";

/**
 * The single way the web app talks to the API.
 *
 * Non-negotiables encoded here rather than left to each caller
 * (docs/PHASE_8_IMPLEMENTATION_PLAN.md §2, §3):
 *
 *   - Browser requests always send `credentials: "include"`, so the
 *     HttpOnly session cookie travels. The cookie is never read or
 *     parsed by this code.
 *   - Session and sensitive reads are `cache: "no-store"`. Caching is
 *     opt-in and explicit, never the default.
 *   - Only `Idempotency-Key` values supplied by the caller are sent —
 *     the client never invents one, because a generated-per-retry key
 *     would defeat idempotency entirely.
 *   - Webhook routes are unreachable: `/webhooks/*` is rejected before a
 *     request is made.
 */

export interface RequestOptions {
  /** Explicit cache policy. Sensitive reads MUST stay "no-store" (the default). */
  cache?: "no-store";
  /** Public, cacheable GETs only — opt in with a revalidate window in seconds. */
  revalidate?: number;
  /** Forwarded cookie header, used by Server Components. Never set in the browser. */
  cookieHeader?: string;
  /** Caller-owned idempotency key. Required by the API on state-changing endpoints. */
  idempotencyKey?: IdempotencyKey;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const FORBIDDEN_PATH_PREFIXES = ["/webhooks/", "/health", "/ready"];

function assertCallablePath(path: string): void {
  if (!path.startsWith("/")) {
    throw new Error(`api-client: path must start with "/" — received "${path}"`);
  }
  for (const forbidden of FORBIDDEN_PATH_PREFIXES) {
    if (path === forbidden || path.startsWith(forbidden)) {
      throw new Error(
        `api-client: "${path}" is not callable from the web app — webhook and infrastructure routes are server-to-server only`
      );
    }
  }
}

function buildCacheOptions(options: RequestOptions): Pick<RequestInit, "cache"> & {
  next?: { revalidate: number };
} {
  if (options.revalidate !== undefined) {
    if (options.cache === "no-store") {
      throw new Error("api-client: revalidate and cache:\"no-store\" are mutually exclusive");
    }
    return { next: { revalidate: options.revalidate } };
  }
  // Default is no-store: opting OUT of caching must never be something a
  // caller can forget for a sensitive read.
  return { cache: "no-store" };
}

async function parseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function apiFetch<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  options: RequestOptions
): Promise<T> {
  assertCallablePath(path);

  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  // Server Components have no cookie jar, so the caller forwards it.
  // Applied whenever supplied rather than gated on an environment check:
  // only server code ever passes `cookieHeader`, and `Cookie` is a
  // forbidden header name in the browser fetch spec anyway — so keying
  // this off `typeof window` would only make the session path behave
  // differently under test than in production, for no added safety.
  if (options.cookieHeader) headers["Cookie"] = options.cookieHeader;

  const init: RequestInit = {
    method,
    headers,
    ...buildCacheOptions(options),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    // Browser only: sends the HttpOnly session cookie cross-origin.
    // Meaningless (and ignored) on the server.
    ...(isBrowser() ? { credentials: "include" as const } : {}),
  };

  let response: Response;
  try {
    response = await fetch(`${resolveApiBaseUrl()}${API_PREFIX}${path}`, init);
  } catch (cause) {
    throw networkError(cause);
  }

  if (!response.ok) {
    throw mapApiError(response.status, await parseBody(response), response.headers.get("x-request-id"));
  }

  if (response.status === 204) return undefined as T;
  return (await parseBody(response)) as T;
}

/**
 * Uploads one file as multipart/form-data.
 *
 * Separate from `apiFetch` because that sets a JSON content type, and
 * setting any Content-Type on a FormData body destroys the multipart
 * boundary the browser generates — the request arrives unparseable.
 * The header is deliberately left unset here so the browser writes it.
 *
 * Browser-only. `FormData` with a `File` has no server equivalent,
 * and every upload in this product is a person choosing a file.
 *
 * Failures map through the same `mapApiError`, so a caller sees the
 * one `ApiError` shape and the same request id as every other call.
 */
export async function uploadFile<T>(
  path: string,
  file: File,
  fieldName = "file",
  /**
   * Fields that travel WITH the file rather than in a second request.
   *
   * The unified listing needs this: its image and its details are one
   * submission, and splitting them would mean a product that exists
   * with no picture whenever the second call fails. Values are stringified
   * because that is what multipart carries — the DTO on the other side
   * transforms them back, which is why its `@Transform`s are not
   * decoration.
   */
  fields?: Record<string, string | number | undefined>
): Promise<T> {
  assertCallablePath(path);

  const body = new FormData();
  body.append(fieldName, file);
  for (const [key, value] of Object.entries(fields ?? {})) {
    // An omitted optional field is ABSENT, not the string "undefined".
    if (value === undefined || value === "") continue;
    body.append(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(`${resolveApiBaseUrl()}${API_PREFIX}${path}`, {
      method: "POST",
      body,
      headers: { Accept: "application/json" },
      cache: "no-store",
      // Sends the session cookie cross-origin; the browser attaches
      // Origin, which is what the API's CSRF guard checks.
      credentials: "include",
    });
  } catch (cause) {
    throw networkError(cause);
  }

  if (!response.ok) {
    throw mapApiError(response.status, await parseBody(response), response.headers.get("x-request-id"));
  }

  return (await parseBody(response)) as T;
}

/**
 * Fetches a file and hands it to the browser as a download.
 *
 * NOT AN `<a href>`. The API is a different origin, so a plain link
 * would be a top-level cross-site navigation — whether the session
 * cookie travels with it depends on its SameSite policy, which means a
 * download that works in one browser and silently returns a sign-in
 * page in another. `fetch` with `credentials: "include"` is explicit
 * about sending it.
 *
 * Failures map through the same `mapApiError`, so a rejected export
 * shows the same message and request id as any other call rather than
 * downloading a file containing an error envelope.
 */
export async function downloadFile(
  path: string,
  fallbackName: string,
): Promise<void> {
  assertCallablePath(path);

  let response: Response;
  try {
    response = await fetch(`${resolveApiBaseUrl()}${API_PREFIX}${path}`, {
      method: "GET",
      headers: { Accept: "*/*" },
      cache: "no-store",
      credentials: "include",
    });
  } catch (cause) {
    throw networkError(cause);
  }

  if (!response.ok) {
    throw mapApiError(
      response.status,
      await parseBody(response),
      response.headers.get("x-request-id"),
    );
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download =
    nameFromDisposition(response.headers.get("content-disposition")) ??
    fallbackName;
  document.body.append(link);
  link.click();
  link.remove();
  // Released on the next tick: revoking it synchronously can cancel the
  // download the click just started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The filename the SERVER chose, when it named one.
 *
 * Read as a plain quoted value only, and any path separator dropped —
 * a header is data, and `filename="../../x"` must not become a path.
 */
function nameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^";]+)"?/i.exec(header);
  if (!match) return null;
  const name = match[1].split(/[\\/]/).pop()?.trim();
  return name && name !== "" && name !== "." && name !== ".." ? name : null;
}

export const apiClient = {
  get: <T>(path: string, options: RequestOptions = {}) =>
    apiFetch<T>("GET", path, undefined, options),

  post: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
    apiFetch<T>("POST", path, body ?? {}, options),

  put: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
    apiFetch<T>("PUT", path, body ?? {}, options),

  patch: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
    apiFetch<T>("PATCH", path, body ?? {}, options),

  /**
   * A DELETE may carry a body.
   *
   * Removing a company takes a reason, the name typed out and a
   * two-factor code — none of which belongs in a query string, where it
   * would be logged by every proxy on the way.
   */
  delete: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
    apiFetch<T>("DELETE", path, body, options),
};

export { ApiError };
