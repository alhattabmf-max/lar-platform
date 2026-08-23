import { cache } from "react";
import { cookies } from "next/headers";
import type { AdminMe } from "@platform/types";
import { apiClient } from "./api-client";
import { isApiError } from "./errors";

/**
 * The admin session, which is NOT the company-user session.
 *
 * A separate file because the two share nothing: a different cookie
 * (`asid`, not `sid`), a different store, a different guard on the API,
 * and a different identity — an administrator has no company, so
 * `MeResponse` cannot describe one. Folding them into `session.ts`
 * behind a role flag would mean one wrong argument sends an
 * administrator through the trader's `/me`, which would answer 401 and
 * look like a logged-out admin.
 *
 * `GET /admin/auth/me` is the ONLY source of truth. It re-reads the row
 * rather than trusting the session blob, so an account disabled
 * mid-session stops answering here — which is why this file makes no
 * decisions of its own beyond "did the call succeed".
 *
 * The cookie is FORWARDED, never read or parsed.
 *
 * React's `cache()` deduplicates within a SINGLE server request only. It
 * is a per-request memo, not a cross-request store, so it cannot leak
 * one administrator's session into another's request.
 */

export type AdminSession = AdminMe;

async function forwardedCookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/**
 * The current administrator, or null when there is not one.
 *
 * Only a 401 maps to null. Every other failure rethrows: swallowing a
 * 500 would render a signed-out admin screen during an outage and hide
 * the outage.
 */
export const getAdminSession = cache(async (): Promise<AdminSession | null> => {
  const cookieHeader = await forwardedCookieHeader();
  if (!cookieHeader) return null;

  try {
    return await apiClient.get<AdminSession>("/admin/auth/me", {
      cache: "no-store",
      cookieHeader,
    });
  } catch (error) {
    if (isApiError(error) && error.kind === "unauthorized") return null;
    throw error;
  }
});

export async function isAdminAuthenticated(): Promise<boolean> {
  return (await getAdminSession()) !== null;
}
