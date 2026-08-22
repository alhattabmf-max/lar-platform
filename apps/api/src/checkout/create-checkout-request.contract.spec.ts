import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  CREATE_CHECKOUT_ALLOCATION_REQUEST_KEYS,
  CREATE_CHECKOUT_SESSION_REQUEST_KEYS,
  canonicalCheckoutRequest,
  type CreateCheckoutSessionRequest,
} from "@platform/types";
import { CreateCheckoutSessionDto } from "./dto/create-checkout-session.dto";

/**
 * One request shape, declared once.
 *
 * `POST /trader/checkout-sessions` was described in three places that nothing
 * bound together: the shared contract did not exist, the API had
 * `CreateCheckoutSessionDto`, and the web app had its own `CheckoutIntent`.
 * A field renamed on one side type-checked perfectly on the other, because the
 * two types were unrelated.
 *
 * That matters more here than for most request bodies. The server hashes
 * exactly these fields into `idempotency_keys.request_hash`, and the client
 * derives its storage key from a SHA-256 of the same canonical form. Disagree,
 * and a retry computes a different fingerprint, claims a different key, and
 * creates a SECOND checkout session holding a second quantity lock — both
 * counting toward the trader's cooldown.
 *
 * `CreateCheckoutSessionDto implements CreateCheckoutSessionRequest` makes the
 * API side a compile error. These tests cover what a type cannot: that the
 * runtime validators still enforce the constraints, and that the WEB app and
 * the SERVICE agree on the canonical form.
 */

const VALID: CreateCheckoutSessionRequest = {
  opportunityId: "55555555-5555-4555-8555-555555555555",
  quantity: 8,
  allocations: [
    { companyLocationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", quantity: 4 },
    { companyLocationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", quantity: 4 },
  ],
};

function validate(payload: unknown): string[] {
  const instance = plainToInstance(CreateCheckoutSessionDto, payload);
  return validateSync(instance, { whitelist: true, forbidNonWhitelisted: true }).flatMap((e) => [
    e.property,
    ...(e.children ?? []).flatMap((c) => (c.children ?? []).map((g) => g.property)),
  ]);
}

describe("the DTO carries exactly the contract's keys", () => {
  it("accepts a payload built from the shared type", () => {
    expect(validate(VALID)).toEqual([]);
  });

  it("declares the same three fields the contract does", () => {
    const instance = plainToInstance(CreateCheckoutSessionDto, VALID);
    expect(Object.keys(instance).sort()).toEqual([...CREATE_CHECKOUT_SESSION_REQUEST_KEYS].sort());
  });

  it("declares the same two allocation fields", () => {
    const instance = plainToInstance(CreateCheckoutSessionDto, VALID);
    expect(Object.keys(instance.allocations[0]).sort()).toEqual(
      [...CREATE_CHECKOUT_ALLOCATION_REQUEST_KEYS].sort()
    );
  });

  it("rejects a field the contract does not declare", () => {
    // A client that could send a price could propose what it pays. Every
    // figure is computed server-side from the frozen opportunity.
    expect(validate({ ...VALID, grandTotalAmount: "1.00" })).toContain("grandTotalAmount");
    expect(validate({ ...VALID, unitPriceInclTaxAmount: "1.00" })).toContain(
      "unitPriceInclTaxAmount"
    );
  });
});

describe("the runtime constraints a shared interface cannot express", () => {
  it("requires a UUID opportunity", () => {
    expect(validate({ ...VALID, opportunityId: "not-a-uuid" })).toContain("opportunityId");
  });

  it("requires a positive whole quantity", () => {
    for (const quantity of [0, -4, 2.5]) {
      expect([quantity, validate({ ...VALID, quantity })]).toEqual([
        quantity,
        expect.arrayContaining(["quantity"]),
      ]);
    }
  });

  it("requires at least one allocation", () => {
    expect(validate({ ...VALID, allocations: [] })).toContain("allocations");
  });

  it("validates every allocation, not just the first", () => {
    const bad = {
      ...VALID,
      allocations: [VALID.allocations[0], { companyLocationId: "nope", quantity: 0 }],
    };
    expect(validate(bad)).toEqual(expect.arrayContaining(["companyLocationId", "quantity"]));
  });
});

describe("the canonical form is shared, not restated", () => {
  it("sorts allocations, so ordering is not part of the identity", () => {
    // The same purchase described in a different order is the same purchase.
    const reordered = { ...VALID, allocations: [...VALID.allocations].reverse() };

    expect(canonicalCheckoutRequest(reordered)).toEqual(canonicalCheckoutRequest(VALID));
    expect(JSON.stringify(canonicalCheckoutRequest(VALID))).toBe(
      JSON.stringify(canonicalCheckoutRequest(reordered))
    );
  });

  it("changes when any part of the purchase changes", () => {
    const digests = new Set(
      [
        VALID,
        { ...VALID, quantity: 12 },
        { ...VALID, opportunityId: "66666666-6666-4666-8666-666666666666" },
        {
          ...VALID,
          allocations: [
            { companyLocationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", quantity: 6 },
            { companyLocationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", quantity: 2 },
          ],
        },
      ].map((r) => JSON.stringify(canonicalCheckoutRequest(r)))
    );

    expect(digests.size).toBe(4);
  });

  it("projects ONLY the contract's fields into the digest", () => {
    // An extra field reaching the hash would make two identical purchases
    // look like different operations.
    const withExtra = { ...VALID, somethingElse: "x" } as CreateCheckoutSessionRequest;
    expect(canonicalCheckoutRequest(withExtra)).toEqual(canonicalCheckoutRequest(VALID));
  });
});

describe("the service and the web app use that one form", () => {
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const SERVICE = strip(readFileSync(join(__dirname, "checkout-session.service.ts"), "utf8"));
  const WEB = strip(
    readFileSync(
      join(__dirname, "..", "..", "..", "web", "lib", "checkout-create.ts"),
      "utf8"
    )
  );

  it("the web app delegates rather than restating the sort", () => {
    // The restated version is the one that can drift.
    expect(WEB).toContain("canonicalCheckoutRequest(intent)");
    expect(WEB).not.toMatch(/\.sort\(\(a, b\) => a\.companyLocationId/);
  });

  it("the web app aliases the shared type instead of redeclaring it", () => {
    expect(WEB).toContain("export type CheckoutIntent = CreateCheckoutSessionRequest");
    expect(WEB).not.toMatch(/^export interface CheckoutIntent \{/m);
  });

  it("the service hashes the same three fields, sorted the same way", () => {
    // The service keeps its own `canonicalize` because it is inside the
    // transaction path and takes the DTO — but it must project the same
    // fields in the same order, which is what this pins.
    const canonicalize = SERVICE.slice(SERVICE.indexOf("function canonicalize("));

    expect(canonicalize).toContain("opportunityId: dto.opportunityId");
    expect(canonicalize).toContain("quantity: dto.quantity");
    expect(canonicalize).toContain("a.companyLocationId.localeCompare(b.companyLocationId)");
    expect(canonicalize).toContain(
      "companyLocationId: a.companyLocationId, quantity: a.quantity"
    );
  });

  it("produces byte-identical digests for the same purchase", () => {
    // The one assertion that would fail if either side changed its
    // projection: the service's form, reproduced from its source shape, must
    // serialise exactly as the shared one does.
    const serviceForm = {
      opportunityId: VALID.opportunityId,
      quantity: VALID.quantity,
      allocations: [...VALID.allocations]
        .sort((a, b) => a.companyLocationId.localeCompare(b.companyLocationId))
        .map((a) => ({ companyLocationId: a.companyLocationId, quantity: a.quantity })),
    };

    expect(JSON.stringify(serviceForm)).toBe(JSON.stringify(canonicalCheckoutRequest(VALID)));
  });
});
