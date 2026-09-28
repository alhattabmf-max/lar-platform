"use client";

import { useEffect, useState } from "react";

/**
 * ONE QUERY PARAMETER FROM THE ADDRESS BAR, kept in step with it.
 *
 * WHY NOT `useSearchParams`. It is the framework's answer and it was
 * tried twice. The hook suspends during prerender, so every component
 * that calls it needs a `<Suspense>` boundary — and on THIS app's
 * production build that boundary never resolved. Both times the row's
 * slot was left holding `<!--$~--><template id="B:0">` while the
 * finished form sat in a `div#S:0` at the end of `<body>`, and the
 * field measured 0×0 at 1366 and at 1600. Moving the boundary from a
 * server component into a client one did not change it; neither did
 * making its child pure client code.
 *
 * WHY NOT AN EFFECT ON `pathname`. «إزالة الفلاتر» goes from
 * `/opportunities?q=حديد` to `/opportunities` — the same path. Nothing
 * in a layout re-renders for that, so the effect never runs. Measured:
 * the box trailed the address by exactly one step.
 *
 * SO IT SUBSCRIBES TO THE ADDRESS ITSELF. `popstate` covers back and
 * forward; `pushState` and `replaceState` are wrapped ONCE, per
 * document, to announce themselves. That is the whole of it: no
 * suspense, no prerender interaction, nothing that can strand a
 * boundary, and it is true for any navigation whatever caused it.
 *
 * THE PATCH IS INSTALLED ONCE AND NEVER REMOVED. Removing it would
 * mean restoring a function some other listener may since have wrapped,
 * which is how two patches become a broken history API. It calls
 * through to the original and adds one event.
 *
 * AND THE EVENT IS ANNOUNCED OUT OF THE CALLER'S STACK — see
 * `announce` below. That one line is what this hook got wrong.
 */
const EVENT = "forsa:locationchange";

let patched = false;

function installOnce(): void {
  if (patched || typeof window === "undefined") return;
  patched = true;

  for (const name of ["pushState", "replaceState"] as const) {
    const original = window.history[name];
    window.history[name] = function patchedHistoryMethod(
      this: History,
      ...args: Parameters<History["pushState"]>
    ) {
      const result = original.apply(this, args);
      announce();
      return result;
    };
  }
}

/**
 * THE ANNOUNCEMENT LEAVES THE CALLER'S STACK BEFORE ANYBODY HEARS IT.
 *
 * THE DEFECT THIS FIXES, stated exactly: React logged «useInsertionEffect
 * must not schedule updates» on every client navigation.
 *
 * `dispatchEvent` runs its listeners SYNCHRONOUSLY — the listener below
 * calls `setValue`, so the update was scheduled inside the stack of
 * whoever called `pushState`. And in the App Router that caller is
 * `HistoryUpdater`, which calls `history.pushState` / `replaceState`
 * from inside a `useInsertionEffect` (next/dist/client/components/
 * app-router.js). So a React state update was being scheduled during
 * React's insertion-effect phase, which is precisely what that phase
 * forbids: it runs before layout effects read the DOM, and a re-render
 * scheduled from it has no defined place to go.
 *
 * A MICROTASK IS THE WHOLE FIX. It runs as soon as the synchronous
 * stack unwinds — same tick, no frame skipped, nothing visibly delayed
 * — but after the commit that called `pushState` has finished, so the
 * update is an ordinary one.
 *
 * NOTHING IS LOST BY WAITING. The listener reads
 * `window.location.search`, and the address bar was already updated by
 * `original.apply` above; the microtask cannot observe a stale one.
 */
function announce(): void {
  queueMicrotask(() => window.dispatchEvent(new Event(EVENT)));
}

export function useQueryParam(name: string): string {
  // EMPTY ON THE SERVER, and empty on the first client render too — the
  // value arrives in the effect below. Reading `window` during render
  // would make the server's HTML and the browser's first render
  // disagree, which React reports as a hydration mismatch.
  const [value, setValue] = useState("");

  useEffect(() => {
    installOnce();

    const read = () =>
      setValue(new URLSearchParams(window.location.search).get(name) ?? "");

    read();
    window.addEventListener("popstate", read);
    window.addEventListener(EVENT, read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener(EVENT, read);
    };
  }, [name]);

  return value;
}
