import {
  ADMIN_DECIDED_LISTING_BLOCKERS,
  CLASSIFIED_LISTING_BLOCKERS,
  DASHBOARD_ATTENTION_KINDS,
  ELSEWHERE_QUEUED_LISTING_BLOCKERS,
  FOLLOW_UP_CASE_KINDS,
  PLATFORM_OWNED_LISTING_BLOCKERS,
  SUPPLIER_OPPORTUNITY_REASON_CODES,
  SUPPLIER_OWNED_LISTING_BLOCKERS,
  isPlatformOwnedListingBlocker,
} from "@platform/types";

/**
 * WHOSE PROBLEM IS A BLOCKED LISTING — one assertion per reason code.
 *
 * A listing that cannot go live carries one of ten codes saying why, and
 * the whole correction rests on not reading the enum name as the answer.
 * `PRODUCT_SUSPENDED` sounds like outstanding work and is the record of
 * work already done by the very person who would be reminded of it.
 * `LOCATION_INACTIVE` sounds like the platform and is a supplier
 * switching off their own branch.
 *
 * These tests are the classification itself. If a code moves bucket, one
 * of them has to be edited on purpose.
 */

describe("every reason code is classified, exactly once", () => {
  it("covers the whole vocabulary", () => {
    expect([...CLASSIFIED_LISTING_BLOCKERS].sort()).toEqual(
      [...SUPPLIER_OPPORTUNITY_REASON_CODES].sort(),
    );
  });

  it("puts no code in two buckets", () => {
    // The failure this guards against is silent: a code in two buckets
    // is a piece of work counted in two queues, cleared in one, and
    // still standing in the other.
    expect(new Set(CLASSIFIED_LISTING_BLOCKERS).size).toBe(
      CLASSIFIED_LISTING_BLOCKERS.length,
    );
  });

  it("leaves no code unclassified", () => {
    const classified = new Set<string>(CLASSIFIED_LISTING_BLOCKERS);
    const missing = SUPPLIER_OPPORTUNITY_REASON_CODES.filter(
      (code) => !classified.has(code),
    );
    // A code added to the evaluator and forgotten here would fall out of
    // every queue and be reported to nobody.
    expect(missing).toEqual([]);
  });
});

describe("what the overview counts", () => {
  it.each([
    [
      "LOCATION_CITY_INACTIVE",
      "a city switched off in reference data — no supplier can turn it back on",
    ],
    [
      "TAX_RATE_NOT_CONFIGURED",
      "platform tax configuration — nothing outside this console sets it",
    ],
  ])("counts %s, because %s", (code) => {
    expect(isPlatformOwnedListingBlocker(code)).toBe(true);
    expect(PLATFORM_OWNED_LISTING_BLOCKERS).toContain(code);
  });

  it.each([
    [
      "PRODUCT_SUSPENDED",
      "the console suspended it; a decision is not an outstanding task",
    ],
    [
      "PRODUCT_CLOSED",
      "the console closed it; the same reason",
    ],
  ])("does NOT count %s, because %s", (code) => {
    expect(isPlatformOwnedListingBlocker(code)).toBe(false);
    expect(ADMIN_DECIDED_LISTING_BLOCKERS).toContain(code);
  });

  it.each([
    [
      "SUPPLIER_NOT_VERIFIED",
      "SUPPLIER_VERIFICATION already counts it, where it is decided",
    ],
    [
      "SUPPLIER_NOT_FINANCIALLY_READY",
      "BANK_ACCOUNT_REVIEW already counts the half this console owns",
    ],
  ])("does NOT count %s, because %s", (code) => {
    expect(isPlatformOwnedListingBlocker(code)).toBe(false);
    expect(ELSEWHERE_QUEUED_LISTING_BLOCKERS).toContain(code);
  });

  it.each([
    ["PRODUCT_ARCHIVED", "the supplier archived their own product"],
    ["LOCATION_INACTIVE", "the supplier switched off their own branch"],
    [
      "PURCHASE_QUANTITY_NOT_COMPATIBLE",
      "the supplier sets the quantity and can change it",
    ],
    [
      "PRODUCT_NOT_APPROVED",
      "unreachable since approval was abolished, and still the supplier's if it ever fires",
    ],
  ])("does NOT count %s, because %s", (code) => {
    expect(isPlatformOwnedListingBlocker(code)).toBe(false);
    expect(SUPPLIER_OWNED_LISTING_BLOCKERS).toContain(code);
  });

  it("treats a listing with no reason code as nobody's task", () => {
    // ACTION_REQUIRED with a null reason is a row the evaluator has not
    // written to. Counting it would report a case with nothing to say.
    expect(isPlatformOwnedListingBlocker(null)).toBe(false);
  });

  it("refuses a code outside the vocabulary", () => {
    expect(isPlatformOwnedListingBlocker("SOMETHING_ELSE")).toBe(false);
  });
});

describe("an attention row is not a follow-up case", () => {
  it("adds the new kind to the overview only", () => {
    expect(DASHBOARD_ATTENTION_KINDS).toContain("LISTING_BLOCKED_BY_PLATFORM");
    // NOT assignable. `follow_up_assignments.case_kind` is a Postgres
    // enum; adding a kind there is a migration, and this case needs
    // none — it is a counter and a link.
    expect(FOLLOW_UP_CASE_KINDS).not.toContain(
      "LISTING_BLOCKED_BY_PLATFORM" as never,
    );
  });

  it("keeps every follow-up kind countable on the overview", () => {
    for (const kind of FOLLOW_UP_CASE_KINDS) {
      expect(DASHBOARD_ATTENTION_KINDS).toContain(kind);
    }
  });
});
