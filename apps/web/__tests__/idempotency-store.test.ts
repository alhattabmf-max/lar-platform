import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IDEMPOTENT_OPERATIONS,
  claimKey,
  fingerprint,
  hasKey,
  releaseKey,
} from "@/lib/idempotency-store";

/**
 * The key that has to survive a reload.
 *
 * A `useRef` covers a double click and dies with the component — and a
 * reload IS a remount. Someone whose request stalled, who reloads and
 * presses again, would otherwise arrive with a fresh key, which the
 * server reads as a NEW payment. That is the precise failure
 * idempotency exists to prevent, so these tests pin the storage
 * behaviour rather than the in-memory behaviour.
 */

const SESSION = "22222222-2222-2222-2222-222222222222";
const OTHER_SESSION = "44444444-4444-4444-4444-444444444444";

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("a key survives what a ref would not", () => {
  it("returns the SAME key on a second claim — the reload case", () => {
    const first = claimKey("payment-attempt", SESSION);
    const second = claimKey("payment-attempt", SESSION);

    expect(second).toBe(first);
  });

  it("stores it where a new page load can find it", () => {
    const key = claimKey("payment-attempt", SESSION);

    // Read straight out of storage: a fresh mount reads the same slot.
    const stored = Object.entries(window.sessionStorage).find(([, v]) => v === key);
    expect(stored).toBeDefined();
  });

  it("issues a real UUID, not a counter", () => {
    expect(claimKey("payment-attempt", SESSION)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});

describe("the two operations never share a key", () => {
  it("gives checkout-create and payment-attempt different keys", () => {
    // Two operations, two server-side idempotency scopes
    // (TRADER_CHECKOUT_CREATE and PAYMENT_ATTEMPT_START). One key
    // across both would make a replay of one look like the other.
    const create = claimKey("checkout-create", SESSION);
    const attempt = claimKey("payment-attempt", SESSION);

    expect(create).not.toBe(attempt);
  });

  it("gives two different sessions different keys", () => {
    expect(claimKey("payment-attempt", SESSION)).not.toBe(
      claimKey("payment-attempt", OTHER_SESSION)
    );
  });

  it("names the operations as a closed list, not free text", () => {
    // Every operation whose key must survive a reload, named. Free text
    // here would let two features collide on one storage slot.
    expect([...IDEMPOTENT_OPERATIONS]).toEqual([
      "checkout-create",
      "payment-attempt",
      "dispute-open",
    ]);
  });
});

describe("releasing makes the next attempt a NEW operation", () => {
  it("issues a different key after a release", () => {
    // What an explicit retry after a definitive refusal needs: reusing
    // the key would replay the stored refusal forever.
    const first = claimKey("payment-attempt", SESSION);
    releaseKey("payment-attempt", SESSION);
    const second = claimKey("payment-attempt", SESSION);

    expect(second).not.toBe(first);
  });

  it("releases only the operation it was asked to", () => {
    const create = claimKey("checkout-create", SESSION);
    claimKey("payment-attempt", SESSION);

    releaseKey("payment-attempt", SESSION);

    expect(hasKey("payment-attempt", SESSION)).toBe(false);
    expect(claimKey("checkout-create", SESSION)).toBe(create);
  });

  it("is safe to call when nothing is stored", () => {
    expect(() => releaseKey("payment-attempt", SESSION)).not.toThrow();
  });
});

describe("nothing readable goes into a key name", () => {
  it("stores only the namespace, the operation and an opaque id", () => {
    // A storage key is readable by any script on the origin and visible
    // in devtools. "8 cartons to the Riyadh branch" is commercial
    // detail and has no business being there.
    claimKey("payment-attempt", SESSION);

    const names = Object.keys(window.sessionStorage);
    expect(names).toHaveLength(1);
    expect(names[0]).toBe(`forsa.idem.payment-attempt.${SESSION}`);
  });

  it("carries no quantity, allocation, company or personal detail", () => {
    claimKey("checkout-create", SESSION);
    claimKey("payment-attempt", OTHER_SESSION);

    const names = Object.keys(window.sessionStorage).join(" ");
    for (const forbidden of [
      "quantity",
      "allocation",
      "location",
      "branch",
      "company",
      "email",
      "@",
      "legalName",
      "crNumber",
      "iban",
      "price",
      "amount",
    ]) {
      expect(names.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("offers a ONE-WAY digest for an operation with no id yet", async () => {
    // Creating a checkout session is defined by its opportunity,
    // quantity and allocations — none of which may appear in a key
    // name. A digest is a stable discriminator that cannot be read back.
    const input = {
      opportunityId: "55555555-5555-5555-5555-555555555555",
      quantity: 8,
      allocations: [{ companyLocationId: SESSION, quantity: 8 }],
    };

    const digest = await fingerprint(input);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain("8");
    expect(digest).not.toContain(input.opportunityId);
  });

  it("gives the same digest for the same inputs and a different one otherwise", async () => {
    // Which is what makes a changed request get a new key naturally,
    // rather than colliding with the previous one and being replayed.
    const base = { opportunityId: "a", quantity: 8, allocations: [] };

    expect(await fingerprint(base)).toBe(await fingerprint({ ...base }));
    expect(await fingerprint(base)).not.toBe(await fingerprint({ ...base, quantity: 12 }));
  });
});

describe("storage being unavailable never fails the operation", () => {
  it("still returns a usable key when sessionStorage throws", () => {
    // Private mode, a policy, a quota. Degrading to the per-mount
    // behaviour still guards a double click; degrading to no key at all
    // would remove the protection entirely.
    vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    const key = claimKey("payment-attempt", SESSION);

    expect(key).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("does not throw when a release cannot be written", () => {
    vi.spyOn(window.sessionStorage, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => releaseKey("payment-attempt", SESSION)).not.toThrow();
  });
});

describe("the key reaches no channel it should not", () => {
  const STORE = readFileSync(join(__dirname, "..", "lib", "idempotency-store.ts"), "utf8");
  const BUTTON = readFileSync(
    join(__dirname, "..", "components", "checkout", "start-payment-button.tsx"),
    "utf8"
  );
  const code = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("uses sessionStorage and nothing more persistent", () => {
    // localStorage would outlive the tab, the sign-out, and the session
    // it belongs to.
    expect(code(STORE)).toContain("window.sessionStorage");
    expect(code(STORE)).not.toContain("localStorage");
  });

  it("never puts the key in a cookie, a URL or a log", () => {
    for (const source of [code(STORE), code(BUTTON)]) {
      expect(source).not.toContain("document.cookie");
      expect(source).not.toContain("console.");
      expect(source).not.toMatch(/searchParams\.set/);
      expect(source).not.toMatch(/location\.(href|hash|search)\s*=/);
      expect(source).not.toMatch(/window\.history/);
    }
  });

  it("sends it only as the Idempotency-Key header", () => {
    expect(code(BUTTON)).toContain("idempotencyKey: key");
    expect(code(BUTTON)).not.toMatch(/body[^)]*key/);
  });
});

describe("the payment button's key lifecycle", () => {
  const BUTTON = readFileSync(
    join(__dirname, "..", "components", "checkout", "start-payment-button.tsx"),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("stores the key rather than holding it in a ref", () => {
    expect(BUTTON).toContain('claimKey("payment-attempt", checkoutSessionId)');
    expect(BUTTON).not.toContain("useRef");
    expect(BUTTON).not.toContain("IdempotentOperation");
  });

  it("releases on success", () => {
    const success = BUTTON.slice(BUTTON.indexOf("await apiClient.post("));
    expect(success.slice(0, success.indexOf("catch"))).toContain(
      'releaseKey("payment-attempt", checkoutSessionId)'
    );
  });

  it("releases on an explicit retry after a terminal failure", () => {
    const retry = BUTTON.slice(BUTTON.indexOf("function retryAfterTerminalFailure"));
    expect(retry.slice(0, 400)).toContain('releaseKey("payment-attempt", checkoutSessionId)');
  });

  it("treats a NETWORK failure as retryable with the same key", () => {
    // The one case where the request may have reached the server, and
    // the whole purpose of the key is to make the retry recognisable.
    expect(BUTTON).toMatch(/function isTerminalFailure/);
    expect(BUTTON).not.toMatch(/isTerminalFailure[\s\S]{0,300}"network"/);
    expect(BUTTON).toMatch(/error\.kind === "conflict"/);
  });

  it("never retries a terminal failure automatically", () => {
    // A definitive failure that retries itself is a loop.
    expect(BUTTON).toContain("onClick={terminal ? retryAfterTerminalFailure : start}");
    expect(BUTTON).not.toContain("setTimeout");
    expect(BUTTON).not.toContain("setInterval");
  });
});
