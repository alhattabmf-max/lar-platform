"use client";

import { useState } from "react";
import { apiClient } from "@/lib/api-client";
import { SignOutIcon } from "@/components/ui/icons";

/**
 * Ends the company session and leaves.
 *
 * IT ENDS THE SERVER SESSION FIRST. `POST /auth/logout` deletes the
 * session row and clears the cookie; without that call the cookie would
 * still authenticate every request, and "signed out" would be a word on
 * the screen and nothing more.
 *
 * IT LEAVES BY A FULL PAGE LOAD, not a client navigation. A router
 * navigation keeps the running document — its React tree, its module
 * state, and Next's client-side cache of already-fetched pages — so the
 * previous portal could be re-shown from memory without the server
 * being asked. `location.replace` discards the document entirely, which
 * is the only way to be certain nothing of the signed-in session is
 * left in the tab.
 *
 * `replace`, NOT `assign`: the portal page must not stay in history as
 * the entry the Back button returns to. Pressing Back from here goes to
 * whatever preceded the portal, and because every guarded page is
 * rendered per request and sent `no-store`, the browser must re-ask the
 * server for it — which now has no session and sends the visitor to
 * login. The protection is the server guard; this only makes sure the
 * browser has to consult it.
 *
 * IT LEAVES ON BOTH OUTCOMES. If the request failed the cookie may
 * still be live, but stranding somebody on a portal they believe they
 * have left is worse: the home page will tell them the truth, since it
 * shows "sign out" while a session survives.
 */
export function SignOutButton({
  homeHref,
  label,
  working,
  className,
  icon = true,
}: {
  /** Where signing out lands — the home page in the CURRENT locale. */
  homeHref: string;
  label: string;
  working: string;
  className?: string;
  /**
   * WHETHER THE GLYPH COMES WITH IT.
   *
   * «ألغِ أيقونة الخروج من داخل أيقونة المستخدم» — inside a menu that
   * is already behind an icon, a second icon on one of two words is
   * decoration, and the row above it («بياناتي») has none to match.
   */
  icon?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);

    try {
      await apiClient.post("/auth/logout");
    } catch {
      // Deliberately swallowed — see above. The destination is the same
      // either way, and an error notice on the way out helps nobody.
    }

    window.location.replace(homeHref);
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className={className}
      data-testid="sign-out"
    >
      {icon ? <SignOutIcon aria-hidden="true" /> : null}
      {busy ? working : label}
    </button>
  );
}
