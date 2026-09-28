import { cache } from "react";
import { cookies } from "next/headers";
import type { MeResponse } from "@platform/types";
import { apiClient } from "./api-client";
import { isApiError } from "./errors";

/**
 * Server-side session foundation.
 *
 * The rules this file exists to enforce
 * (docs/PHASE_8_IMPLEMENTATION_PLAN.md §3):
 *
 *   - `GET /me` and the backend session are the ONLY source of truth.
 *   - The HttpOnly cookie is forwarded, never read, decoded, or parsed.
 *     There is no JWT handling anywhere in this app.
 *   - The role is never persisted client-side — no localStorage, no
 *     sessionStorage, no client store. It is re-read on the server for
 *     each page request.
 *   - `cache: "no-store"` on every call, so a stale session can never be
 *     served from a cache after logout or revocation.
 *
 * React's `cache()` deduplicates within a SINGLE server request only —
 * it is a per-request memo, not a cross-request cache, so it cannot leak
 * one user's session into another's request.
 */

export type Session = MeResponse;

async function forwardedCookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/**
 * Returns the current session, or null when unauthenticated.
 *
 * Only a 401 maps to null. Every other failure rethrows: swallowing a
 * 500 here would render an anonymous page to a signed-in user and hide
 * a real outage.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const cookieHeader = await forwardedCookieHeader();
  if (!cookieHeader) return null;

  try {
    return await apiClient.get<Session>("/me", { cache: "no-store", cookieHeader });
  } catch (error) {
    if (isApiError(error) && error.kind === "unauthorized") return null;
    throw error;
  }
});

export type PortalRole = "TRADER" | "SUPPLIER";

export class UnauthenticatedError extends Error {
  constructor() {
    super("No active session");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenRoleError extends Error {
  readonly required: PortalRole;
  readonly actual: string;

  constructor(required: PortalRole, actual: string) {
    super(`Session role "${actual}" cannot access a ${required} route`);
    this.name = "ForbiddenRoleError";
    this.required = required;
    this.actual = actual;
  }
}

/**
 * Returns the session when it belongs to `role`, and throws otherwise.
 *
 * Deliberately throws instead of redirecting: the route groups that
 * translate these into a redirect or the shared 403 page arrive in 8C.
 * Keeping the decision out of this helper means the same function is
 * usable from a layout, a server action, or a test without pulling in
 * routing.
 *
 * The role is compared against `company.accountType` from the live `/me`
 * response — never against anything supplied by the client.
 */
export async function requireRole(role: PortalRole): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  if (session.company.accountType !== role) {
    throw new ForbiddenRoleError(role, session.company.accountType);
  }
  return session;
}

/**
 * Admin access uses a SEPARATE session cookie and a separate backend
 * session store, and requires completed 2FA before that cookie is ever
 * issued. It is therefore not derivable from `/me`, which only knows
 * about company users.
 *
 * The admin `/me` equivalent lands with the admin portal in 8F; until
 * then this helper refuses rather than guessing, so no route can
 * accidentally treat a company session as an admin one.
 */
export async function requireAdmin(): Promise<never> {
  throw new Error(
    "requireAdmin: admin session verification ships with the admin portal in 8F — no admin routes exist yet"
  );
}
