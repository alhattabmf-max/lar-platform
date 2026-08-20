import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MeResponse } from "@platform/types";

const cookiesMock = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => cookiesMock() }));

// React's cache() is a per-request memo in a real server render; in a
// unit test it must be a passthrough so each case starts clean.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { getSession, requireRole, ForbiddenRoleError, UnauthenticatedError, requireAdmin } =
  await import("@/lib/session");

const SESSION: MeResponse = {
  userId: "u-1",
  email: "owner@example.com",
  emailVerificationStatus: "VERIFIED",
  role: "OWNER",
  status: "ACTIVE",
  company: {
    id: "c-1",
    crNumber: "1010101010",
    legalName: "Example Trading Co.",
    accountType: "TRADER",
    verificationStatus: "VERIFIED",
  },
};

function withCookies(pairs: Array<{ name: string; value: string }>) {
  cookiesMock.mockResolvedValue({ getAll: () => pairs });
}

function envelope(status: number, code: string) {
  return new Response(
    JSON.stringify({ error: { code, message: "x" }, requestId: "req-1", timestamp: "t" }),
    { status, headers: { "content-type": "application/json" } }
  );
}

/**
 * A Response body can only be read once, so a mock that resolves to the
 * SAME instance silently yields an unparseable body on the second call.
 * Every mock below therefore builds a fresh Response per invocation.
 */
function respondWith(body: unknown, status = 200) {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
    );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  cookiesMock.mockReset();
});

describe("getSession", () => {
  it("returns the session for a valid cookie", async () => {
    withCookies([{ name: "sid", value: "abc" }]);
    fetchMock.mockImplementation(respondWith(SESSION));

    await expect(getSession()).resolves.toEqual(SESSION);
  });

  it("forwards the cookie header verbatim and never parses it", async () => {
    withCookies([
      { name: "sid", value: "opaque-value" },
      { name: "other", value: "x" },
    ]);
    fetchMock.mockImplementation(respondWith(SESSION));

    await getSession();

    expect(fetchMock.mock.calls[0][1].headers.Cookie).toBe("sid=opaque-value; other=x");
  });

  it("always requests /me with no-store", async () => {
    withCookies([{ name: "sid", value: "abc" }]);
    fetchMock.mockImplementation(respondWith(SESSION));

    await getSession();

    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/me");
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
  });

  it("returns null on 401 without calling the API twice", async () => {
    withCookies([{ name: "sid", value: "stale" }]);
    fetchMock.mockImplementation(() => Promise.resolve(envelope(401, "UNAUTHORIZED")));

    await expect(getSession()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null without any network call when there is no cookie", async () => {
    withCookies([]);

    await expect(getSession()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rethrows a 500 instead of silently degrading to anonymous", async () => {
    withCookies([{ name: "sid", value: "abc" }]);
    fetchMock.mockImplementation(() => Promise.resolve(envelope(500, "INTERNAL_ERROR")));

    await expect(getSession()).rejects.toMatchObject({ kind: "server" });
  });
});

describe("requireRole", () => {
  it("returns the session when the account type matches", async () => {
    withCookies([{ name: "sid", value: "abc" }]);
    fetchMock.mockImplementation(respondWith(SESSION));

    await expect(requireRole("TRADER")).resolves.toEqual(SESSION);
  });

  it("throws ForbiddenRoleError for the wrong portal (403 case)", async () => {
    withCookies([{ name: "sid", value: "abc" }]);
    fetchMock.mockImplementation(respondWith(SESSION));

    await expect(requireRole("SUPPLIER")).rejects.toBeInstanceOf(ForbiddenRoleError);
  });

  it("throws UnauthenticatedError with no session (401 case)", async () => {
    withCookies([]);

    await expect(requireRole("TRADER")).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("derives the role from the live /me response, not from any client input", async () => {
    withCookies([{ name: "sid", value: "abc" }]);
    fetchMock.mockImplementation(respondWith({ ...SESSION, company: { ...SESSION.company, accountType: "SUPPLIER" } }));

    await expect(requireRole("TRADER")).rejects.toBeInstanceOf(ForbiddenRoleError);
    await expect(requireRole("SUPPLIER")).resolves.toBeTruthy();
  });
});

describe("requireAdmin", () => {
  it("refuses rather than treating a company session as an admin one", async () => {
    await expect(requireAdmin()).rejects.toThrow(/8F/);
  });
});
