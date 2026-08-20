import { describe, expect, it, vi } from "vitest";
import {
  IdempotentOperation,
  newIdempotencyKey,
  withIdempotency,
} from "@/lib/idempotency";

describe("idempotency keys", () => {
  it("generates a distinct UUID per new operation", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();

    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(a).not.toBe(b);
  });

  it("returns the SAME key on every read of one operation", () => {
    const operation = new IdempotentOperation();

    expect(operation.get()).toBe(operation.get());
    expect(operation.headers()["Idempotency-Key"]).toBe(operation.get());
  });

  it("reuses one key across every retry of the same operation", async () => {
    const seen: string[] = [];
    let attempts = 0;

    await withIdempotency(
      async (key) => {
        seen.push(key);
        attempts += 1;
        if (attempts < 3) throw new Error("transient");
        return "ok";
      },
      { maxAttempts: 3, shouldRetry: () => true }
    );

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1);
  });

  it("does not retry when shouldRetry is not provided", async () => {
    const attempt = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(withIdempotency(attempt, { maxAttempts: 5 })).rejects.toThrow("boom");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when shouldRetry returns false", async () => {
    const attempt = vi.fn().mockRejectedValue(new Error("permanent"));

    await expect(
      withIdempotency(attempt, { maxAttempts: 5, shouldRetry: () => false })
    ).rejects.toThrow("permanent");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("two separate operations never share a key", async () => {
    const keys: string[] = [];
    const capture = async (key: string) => {
      keys.push(key);
      return "ok";
    };

    await withIdempotency(capture);
    await withIdempotency(capture);

    expect(new Set(keys).size).toBe(2);
  });
});
