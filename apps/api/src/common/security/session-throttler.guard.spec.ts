import { createHash } from "node:crypto";
import type { Request } from "express";
import { SessionThrottlerGuard } from "./session-throttler.guard";
import { SESSION_COOKIE_NAME } from "./session-cookie.constants";
import { ADMIN_SESSION_COOKIE_NAME } from "../../admin/admin-auth/admin-session-cookie.constants";

/**
 * WHO THE RATE LIMIT COUNTS.
 *
 * The guard extends Nest's own `ThrottlerGuard` and overrides exactly
 * one method, so that method is what these exercise — reaching it
 * through the protected boundary the way the framework does.
 */
const trackerOf = (guard: SessionThrottlerGuard, req: Partial<Request>) =>
  (guard as unknown as { getTracker(r: Request): Promise<string> }).getTracker(
    req as Request
  );

describe("SessionThrottlerGuard — the bucket is the visitor", () => {
  const guard = new SessionThrottlerGuard(
    {} as never,
    {} as never,
    {} as never
  );

  it("counts a signed-in visitor by their session, not the address they came from", async () => {
    // THE WHOLE POINT. Server-side rendering means both of these reads
    // arrive from the web server's own address; before this they were
    // one bucket, and one supplier's browsing spent another's budget.
    const a = await trackerOf(guard, {
      ip: "127.0.0.1",
      cookies: { [SESSION_COOKIE_NAME]: "session-a" },
    });
    const b = await trackerOf(guard, {
      ip: "127.0.0.1",
      cookies: { [SESSION_COOKIE_NAME]: "session-b" },
    });

    expect(a).not.toEqual(b);
  });

  it("gives one visitor ONE bucket, whatever address they reach us from", async () => {
    const direct = await trackerOf(guard, {
      ip: "203.0.113.7",
      cookies: { [SESSION_COOKIE_NAME]: "session-a" },
    });
    const rendered = await trackerOf(guard, {
      ip: "127.0.0.1",
      cookies: { [SESSION_COOKIE_NAME]: "session-a" },
    });

    expect(direct).toEqual(rendered);
  });

  it("never puts the session id itself in the key", async () => {
    // The tracker's return value BECOMES A REDIS KEY: stored, and
    // readable by anybody who can read the keyspace. A session id
    // there is a credential in a place credentials must not be.
    const key = await trackerOf(guard, {
      ip: "127.0.0.1",
      cookies: { [SESSION_COOKIE_NAME]: "a-real-looking-session-id" },
    });

    expect(key).not.toContain("a-real-looking-session-id");
    expect(key).toBe(
      `s:${createHash("sha256").update("a-real-looking-session-id").digest("hex")}`
    );
  });

  it("counts an admin by the console's own cookie", async () => {
    const operator = await trackerOf(guard, {
      ip: "127.0.0.1",
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: "admin-session" },
    });
    const supplier = await trackerOf(guard, {
      ip: "127.0.0.1",
      cookies: { [SESSION_COOKIE_NAME]: "admin-session" },
    });

    // The same string in either cookie is the same person to the
    // hash — what matters here is that the ADMIN cookie is read at
    // all, and that a browser holding both is counted once.
    expect(operator).toEqual(supplier);

    const both = await trackerOf(guard, {
      ip: "127.0.0.1",
      cookies: {
        [ADMIN_SESSION_COOKIE_NAME]: "admin-session",
        [SESSION_COOKIE_NAME]: "supplier-session",
      },
    });
    expect(both).toEqual(operator);
  });

  it("falls back to the address when there is no session", async () => {
    // WHICH IS WHERE THE LIMITS THAT MATTER LIVE. Login and
    // password-reset are 5 a minute and are reached WITHOUT a session,
    // so they keep the IP bucket exactly as they had it.
    expect(await trackerOf(guard, { ip: "203.0.113.7", cookies: {} })).toBe(
      "ip:203.0.113.7"
    );
    expect(await trackerOf(guard, { ip: "203.0.113.7" })).toBe("ip:203.0.113.7");
  });

  it("treats an empty cookie as no cookie", async () => {
    expect(
      await trackerOf(guard, {
        ip: "203.0.113.7",
        cookies: { [SESSION_COOKIE_NAME]: "" },
      })
    ).toBe("ip:203.0.113.7");
  });

  it("answers something rather than nothing when there is no address either", async () => {
    expect(await trackerOf(guard, { cookies: {} })).toBe("ip:unknown");
  });
});
