"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Captures a single-use token from the URL, then removes it from the
 * address bar before anything else happens.
 *
 * WHY THE URL IS NOT A SAFE PLACE TO LEAVE IT. A token in the query
 * string survives in browser history, in screenshots, and — most
 * importantly — in the `Referer` header of any subsequent request the
 * page makes. A recovery token reaching an access log is a credential
 * reaching an access log.
 *
 * WHY history.replaceState AND NOT router.replace. `router.replace()`
 * performs a Next navigation, which issues an RSC request — and that
 * request would carry the current URL, token and all, as its Referer.
 * Using the History API rewrites the address bar with no network call
 * at all, so there is no request that could ever carry the token in a
 * header. `replaceState` also, by definition, adds no history entry:
 * the back button cannot return to the tokened URL.
 *
 * The token lives in a ref — memory for the lifetime of the mounted
 * component. It is never written to a cookie, to localStorage, to
 * sessionStorage, to the pathname, or to the hash.
 *
 * After cleanup a refresh has no token to find, which is correct: the
 * caller shows its "link missing" state rather than trying to recover
 * a value that was deliberately discarded.
 */
export interface OneTimeToken {
  /** The captured token, or null when the URL carried none. */
  token: string | null;
  /**
   * True once capture and URL cleanup have both finished.
   *
   * Callers that fire a request automatically MUST wait for this, so no
   * network call is ever made while the token is still in the address
   * bar.
   */
  ready: boolean;
}

export function useOneTimeToken(paramName = "token"): OneTimeToken {
  // A ref, not state: the value must not be part of any render output,
  // and it must survive re-renders without being re-derived from a URL
  // that no longer holds it.
  const tokenRef = useRef<string | null>(null);
  const capturedRef = useRef(false);

  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Capture exactly once. React Strict Mode mounts effects twice in
    // development, and the second pass would find an already-cleaned
    // URL and wrongly conclude the token was missing.
    if (capturedRef.current) return;
    capturedRef.current = true;

    const url = new URL(window.location.href);
    const value = url.searchParams.get(paramName);

    tokenRef.current = value && value !== "" ? value : null;

    if (url.searchParams.has(paramName)) {
      url.searchParams.delete(paramName);

      // Preserve any other query parameters; strip the `?` entirely
      // when none remain, so the cleaned URL is the plain path.
      const search = url.searchParams.toString();
      const cleaned = `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;

      window.history.replaceState(window.history.state, "", cleaned);
    }

    setReady(true);
  }, [paramName]);

  return { token: tokenRef.current, ready };
}
