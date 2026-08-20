import { describe, expect, it, vi, beforeEach } from "vitest";
import { apiClient } from "@/lib/api-client";
import { ApiError } from "@/lib/errors";
import { newIdempotencyKey } from "@/lib/idempotency";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function envelope(code: string, requestId = "req-123") {
  return { error: { code, message: "developer facing" }, requestId, timestamp: "2026-08-20T00:00:00Z" };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("request construction", () => {
  it("prefixes every path with /api/v1", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await apiClient.get("/branding");

    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/branding");
  });

  it("defaults to cache:'no-store' so a sensitive read is never cached by omission", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiClient.get("/me");

    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
    expect(fetchMock.mock.calls[0][1].next).toBeUndefined();
  });

  it("uses an explicit revalidate window only when asked", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiClient.get("/branding", { revalidate: 60 });

    expect(fetchMock.mock.calls[0][1].next).toEqual({ revalidate: 60 });
    expect(fetchMock.mock.calls[0][1].cache).toBeUndefined();
  });

  it("refuses to combine revalidate with no-store", async () => {
    await expect(
      apiClient.get("/branding", { revalidate: 60, cache: "no-store" })
    ).rejects.toThrow(/mutually exclusive/);
  });

  it("sends credentials:'include' in the browser", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    // jsdom provides `window`, so this exercises the browser branch.
    await apiClient.get("/me");

    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
  });

  it("sends a caller-supplied Idempotency-Key and never invents one", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    const key = newIdempotencyKey();

    await apiClient.post("/trader/checkout-sessions", { a: 1 }, { idempotencyKey: key });
    await apiClient.post("/policies/accept", { a: 1 });

    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBe(key);
    expect(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]).toBeUndefined();
  });

  it("sets Content-Type only when there is a body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiClient.get("/branding");
    await apiClient.post("/policies/accept", { versionId: "x" });

    expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBeUndefined();
    expect(fetchMock.mock.calls[1][1].headers["Content-Type"]).toBe("application/json");
  });
});

describe("forbidden routes", () => {
  it.each([
    "/webhooks/payments/moyasar",
    "/webhooks/refunds/provider",
    "/webhooks/shipping/carrier",
    "/health",
    "/ready",
  ])("refuses to call %s", async (path) => {
    await expect(apiClient.post(path)).rejects.toThrow(/not callable from the web app|webhook/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a path that does not start with a slash", async () => {
    await expect(apiClient.get("branding")).rejects.toThrow(/must start with/);
  });
});

describe("error mapping", () => {
  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "notFound"],
    [409, "conflict"],
    [422, "validation"],
    [400, "validation"],
    [429, "rateLimited"],
    [500, "server"],
    [503, "server"],
  ])("maps status %i to kind %s", async (status, kind) => {
    fetchMock.mockResolvedValue(jsonResponse(status, envelope("FORBIDDEN")));

    await expect(apiClient.get("/me")).rejects.toMatchObject({ kind, status });
  });

  it("carries code and requestId from the Error Envelope, and never `details`", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: { code: "FORBIDDEN", message: "nope", details: { internalField: "SECRET" } },
        requestId: "req-abc",
        timestamp: "2026-08-20T00:00:00Z",
      })
    );

    const error = await apiClient.get("/me").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe("FORBIDDEN");
    expect(apiError.requestId).toBe("req-abc");
    expect(apiError.translationKey).toBe("errors.codes.FORBIDDEN");
    expect(JSON.stringify(apiError)).not.toContain("SECRET");
    expect(apiError).not.toHaveProperty("details");
  });

  it("falls back to a status-derived code when the body is not an envelope", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html", "x-request-id": "req-proxy" },
      })
    );

    const error = (await apiClient.get("/me").catch((e: unknown) => e)) as ApiError;

    expect(error.kind).toBe("server");
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.requestId).toBe("req-proxy");
  });

  it("maps a thrown fetch to a network error rather than crashing", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const error = (await apiClient.get("/branding").catch((e: unknown) => e)) as ApiError;

    expect(error.kind).toBe("network");
    expect(error.status).toBe(0);
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("responses", () => {
  it("returns undefined for 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiClient.delete("/companies/me/contacts/1")).resolves.toBeUndefined();
  });

  it("parses a JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { nameEn: "FORSA" }));

    await expect(apiClient.get<{ nameEn: string }>("/branding")).resolves.toEqual({
      nameEn: "FORSA",
    });
  });
});
