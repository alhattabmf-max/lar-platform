"use client";

import { useState } from "react";
import { apiClient } from "@/lib/api-client";
import { SignOutIcon } from "@/components/ui/icons";

/**
 * Ends the admin session and leaves the console.
 *
 * A client component because the API's CSRF guard requires a browser
 * `Origin` header on state-changing requests, and the `asid` cookie
 * rides along with `credentials: "include"` — both supplied by
 * `apiClient`.
 *
 * IT LANDS ON THE PUBLIC SITE, in the current language. It used to
 * return to `/{locale}/admin`, which shows the sign-in form again —
 * so signing out put an operator straight back where they would sign
 * in, which reads less like leaving than like failing to. The owner's
 * rule is one sentence for all three audiences: «تسجيل الخروج ينهي
 * جلسة الخادم ويعيد للواجهة العامة باللغة الحالية».
 *
 * IT LEAVES BY A FULL PAGE LOAD, not a client navigation, for the same
 * reason the company button does: a router navigation keeps the running
 * document — its React tree, its module state and Next's cache of
 * already-fetched pages — so a console screen could be re-shown from
 * memory without the server being asked. `location.replace` discards
 * the document, and `replace` rather than `assign` keeps the console
 * out of history as the entry Back returns to.
 *
 * IT LEAVES ON BOTH OUTCOMES. If the request failed the cookie may
 * still be live, but stranding somebody on a console they believe they
 * have left is worse: the public site tells them the truth, because it
 * shows "sign out" while any session survives.
 */
export function AdminSignOut({
  homeHref,
  label,
  working,
  className,
}: {
  /** Where signing out lands — the public home page in the CURRENT locale. */
  homeHref: string;
  label: string;
  working: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);

    try {
      await apiClient.post("/admin/auth/logout");
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
      data-testid="admin-sign-out"
    >
      {/* The same glyph the company button uses, so one action looks
          like one action across all three audiences. */}
      <SignOutIcon aria-hidden="true" />
      {busy ? working : label}
    </button>
  );
}
