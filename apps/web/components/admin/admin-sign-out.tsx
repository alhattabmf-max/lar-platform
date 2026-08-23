"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

/**
 * Ends the admin session.
 *
 * A client component because the API's CSRF guard requires a browser
 * `Origin` header on state-changing requests, and the `asid` cookie
 * rides along with `credentials: "include"` — both supplied by
 * `apiClient`.
 *
 * Navigates to the login page on BOTH outcomes. If the request failed
 * the cookie may still be live, but leaving an operator staring at a
 * console they believe they have left is worse than sending them to a
 * page that will tell them the truth: the login page redirects straight
 * back to the dashboard if the session really did survive.
 */
export function AdminSignOut({
  locale,
  label,
  working,
}: {
  locale: string;
  label: string;
  working: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);

    try {
      await apiClient.post("/admin/auth/logout");
    } catch {
      // Deliberately swallowed — see above. The destination is the same
      // either way, and an error toast on the way out helps nobody.
    }

    router.replace(`/${locale}/admin/login`);
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-h-11"
      disabled={busy}
      onClick={signOut}
    >
      {busy ? working : label}
    </Button>
  );
}
