import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useQueryParam } from "@/lib/use-query-param";

/**
 * THE DEFECT: React logged «useInsertionEffect must not schedule
 * updates» on every client navigation.
 *
 * The hook patches `history.pushState` to announce itself, and
 * `dispatchEvent` runs listeners SYNCHRONOUSLY — so the listener's
 * `setState` landed inside the stack of whoever called `pushState`. In
 * the App Router that caller is `HistoryUpdater`, which calls it from a
 * `useInsertionEffect`.
 *
 * What is asserted here is the SHAPE of the fix, not the warning text:
 * that nothing observes the change inside the `pushState` call itself,
 * and that everything has caught up once the microtask queue drains.
 * A test that only checked the final value would pass just as well
 * before the fix as after it.
 */
describe("useQueryParam", () => {
  it("reads the parameter that is already in the address", async () => {
    window.history.replaceState(null, "", "/opportunities?q=حديد");

    const { result } = await act(async () => renderHook(() => useQueryParam("q")));

    expect(result.current).toBe("حديد");
  });

  it("does not announce a navigation inside the pushState call itself", async () => {
    window.history.replaceState(null, "", "/opportunities");
    await act(async () => renderHook(() => useQueryParam("q")));

    let heardSynchronously = false;
    const listen = () => {
      heardSynchronously = true;
    };
    window.addEventListener("forsa:locationchange", listen);

    // The patch is installed by the hook's effect above. Calling through
    // it must not reach a listener before this line returns — that is
    // the whole of the fix.
    window.history.pushState(null, "", "/opportunities?q=أسمنت");
    const duringTheCall = heardSynchronously;

    await act(async () => {
      await Promise.resolve();
    });

    window.removeEventListener("forsa:locationchange", listen);

    expect(duringTheCall).toBe(false);
    expect(heardSynchronously).toBe(true);
  });

  it("catches up with the address once the microtask has run", async () => {
    window.history.replaceState(null, "", "/opportunities");
    const { result } = await act(async () => renderHook(() => useQueryParam("q")));
    expect(result.current).toBe("");

    await act(async () => {
      window.history.pushState(null, "", "/opportunities?q=أسمنت");
      await Promise.resolve();
    });

    expect(result.current).toBe("أسمنت");
  });

  it("clears when the parameter is removed by a navigation to the SAME path", async () => {
    // «إزالة الفلاتر» — the path does not change, so nothing re-renders
    // on its own. This is why the hook subscribes to the address rather
    // than to `pathname`.
    window.history.replaceState(null, "", "/opportunities?q=حديد");
    const { result } = await act(async () => renderHook(() => useQueryParam("q")));
    expect(result.current).toBe("حديد");

    await act(async () => {
      window.history.pushState(null, "", "/opportunities");
      await Promise.resolve();
    });

    expect(result.current).toBe("");
  });
});
