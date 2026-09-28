/**
 * What a control panel list reads out of the address bar.
 *
 * A PLAIN MODULE, deliberately — no `"use client"` and no component.
 * Both sides need these: the server reads `?pageSize=` while rendering
 * the page, and the pager renders one option per size in the browser.
 *
 * That is exactly what went wrong when this lived in the pager itself.
 * A module marked `"use client"` does not export functions to the
 * server; it exports CLIENT REFERENCES, and calling one during a server
 * render throws:
 *
 *     Attempted to call parsePageSize() from the server but
 *     parsePageSize is on the client.
 *
 * TypeScript cannot see that boundary — the import type-checks — and a
 * component test does not run it, so the failure only appeared on a real
 * request. Values shared across the boundary belong in a module that
 * takes no side.
 */

/** The three page sizes an operator may choose between. */
export const PAGE_SIZES = [25, 50, 100] as const;

/** The page size when the reader has not chosen one. */
export const DEFAULT_PAGE_SIZE = 25;

/**
 * THE AUDIT LOG READS DIFFERENTLY FROM EVERY OTHER LIST.
 *
 * The other registers are scanned — a page of twenty-five companies is
 * read as a block. An audit entry is read one at a time: who did what,
 * to which record, and why, with a free-text reason that can run to a
 * paragraph. Twenty-five of those is a wall, and the owner asked for
 * five.
 *
 * The chooser still offers the larger sizes, because exporting a
 * morning of activity is a different task from reading one decision.
 */
export const AUDIT_PAGE_SIZES = [5, 25, 50, 100] as const;
export const AUDIT_DEFAULT_PAGE_SIZE = 5;

/** Parses a page size against a caller-supplied set of allowed values. */
export function parsePageSizeFrom(
  raw: string | string[] | undefined,
  allowed: readonly number[],
  fallback: number,
): number {
  const value = Number.parseInt(
    Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""),
    10,
  );
  return allowed.includes(value) ? value : fallback;
}

/**
 * Reads `?pageSize=`, accepting only the three offered.
 *
 * Anything else — a hand-edited URL, a stale link — falls back rather
 * than being passed through: the API caps at 100, so a request for 5000
 * would be silently clamped into a page whose number then means
 * something different from what the address says.
 */
export function parsePageSize(raw: string | string[] | undefined): number {
  const value = Number.parseInt(
    Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""),
    10,
  );
  return (PAGE_SIZES as readonly number[]).includes(value)
    ? value
    : DEFAULT_PAGE_SIZE;
}
