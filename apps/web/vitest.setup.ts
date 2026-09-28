import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom HAS NO `ResizeObserver`, and the platform signature needs one.
 *
 * The row of destinations measures the open name and slides its wave to
 * that box, re-measuring whenever anything moves — a web font landing
 * changes every name width after the first paint. jsdom implements no
 * layout at all, so the observer never has anything to report here; what
 * it must not do is throw and take the whole row down with it.
 */
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    TestResizeObserver;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
