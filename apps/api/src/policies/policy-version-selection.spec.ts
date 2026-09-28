import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isNewerPolicyVersion,
  newestPolicyVersionPerDocument,
} from "./policy-version-selection";

/**
 * THE PURCHASE THAT COULD NOT BE MADE.
 *
 * A buyer pressed «متابعة الشراء» and was told «يلزم قبول السياسات
 * المحدّثة», with a reference number and no way forward. They had
 * accepted every policy the platform ever showed them — registration
 * asks for the newest version of each mandatory document, and they had
 * ticked both boxes.
 *
 * The checkout guard asked a different question. It read EVERY
 * published mandatory row, and publishing is one-way: a database
 * trigger refuses to update or delete a published version, so a second
 * version of the terms leaves the first one published for ever. Four
 * rows were published; two had ever been offered; the other two could
 * not be accepted by anybody, from any screen, at any time.
 *
 * So the condition was not a policy a buyer had missed. It was a
 * condition that no company on the platform could satisfy — and it
 * refused every purchase from the moment the terms were republished.
 */
const TERMS = "doc-terms";
const PRIVACY = "doc-privacy";

const at = (iso: string) => new Date(iso);

/** The four rows the live database actually held. */
const PUBLISHED = [
  {
    id: "6d7f3611",
    label: "privacy placeholder-v0",
    policyDocumentId: PRIVACY,
    publishedAt: null,
    createdAt: at("2026-08-23T12:04:49.705Z"),
  },
  {
    id: "3edc9a4d",
    label: "terms placeholder-v0",
    policyDocumentId: TERMS,
    publishedAt: null,
    createdAt: at("2026-08-23T12:04:49.679Z"),
  },
  {
    id: "64ea4688",
    label: "terms check-mtduf0yq-edited",
    policyDocumentId: TERMS,
    publishedAt: at("2026-08-29T03:50:47.796Z"),
    createdAt: at("2026-08-29T03:50:47.730Z"),
  },
  {
    id: "067ade25",
    label: "terms placeholder-v0-restored",
    policyDocumentId: TERMS,
    publishedAt: at("2026-08-29T03:51:40.000Z"),
    createdAt: at("2026-08-29T03:51:39.973Z"),
  },
];

describe("which policy version is in force", () => {
  it("is ONE per document, however many were published", () => {
    const inForce = newestPolicyVersionPerDocument(PUBLISHED);

    expect(inForce).toHaveLength(2);
    expect(new Set(inForce.map((row) => row.policyDocumentId))).toEqual(
      new Set([TERMS, PRIVACY]),
    );
  });

  it("picks the version the buyer was actually shown", () => {
    const inForce = newestPolicyVersionPerDocument(PUBLISHED);
    const terms = inForce.find((row) => row.policyDocumentId === TERMS);

    // «عبدالعزيز» registered on 30 Aug and accepted this one. The guard
    // demanded three terms versions and refused them for the two it
    // never offered.
    expect(terms?.label).toBe("terms placeholder-v0-restored");
  });

  it("prefers a PUBLISHED row over one that never carried a date", () => {
    // `publishedAt` is null on the seeded placeholders even though
    // `isPublished` is true, so a missing date sorts oldest rather than
    // throwing the comparison.
    const older = PUBLISHED.find((row) => row.id === "3edc9a4d")!;
    const newer = PUBLISHED.find((row) => row.id === "067ade25")!;

    expect(isNewerPolicyVersion(newer, older)).toBe(true);
    expect(isNewerPolicyVersion(older, newer)).toBe(false);
  });

  it("orders the same way on every read, to the id if it must", () => {
    // Two rows published in the same millisecond must not swap between
    // reads: a registrant shown one version and checked against the
    // other is refused for consent they gave.
    const same = { policyDocumentId: TERMS, publishedAt: at("2026-08-29T03:50:47.796Z"), createdAt: at("2026-08-29T03:50:47.730Z") };
    expect(isNewerPolicyVersion({ ...same, id: "b" }, { ...same, id: "a" })).toBe(true);
    expect(isNewerPolicyVersion({ ...same, id: "a" }, { ...same, id: "b" })).toBe(false);
  });

  it("holds an empty set rather than inventing one", () => {
    expect(newestPolicyVersionPerDocument([])).toEqual([]);
  });
});

describe("every gate asks the same question", () => {
  /**
   * THE RULE WAS WRITTEN TWICE AND OBEYED ONCE. Registration selected
   * the newest per document; checkout and the payment attempt read the
   * raw `findMany`. A source check, because the disagreement is the
   * defect — the two would still be individually reasonable.
   */
  const read = (path: string) =>
    readFileSync(join(__dirname, "..", ...path.split("/")), "utf8");

  it.each([
    "checkout/checkout-session.service.ts",
    "payments/payment-attempt.service.ts",
    "policies/policies.service.ts",
  ])("%s selects the versions in force", (file) => {
    const source = read(file);
    expect(source).toContain("newestPolicyVersionPerDocument");

    // AND NO READ OF THE MANDATORY SET ESCAPES THE SELECTION. The
    // window looks both ways: this file wraps the call, and the owning
    // service selects from the rows on the line after it.
    const RAW = /findMany\(\{\s*where: \{ isPublished: true, isMandatory: true \}/g;
    for (const found of source.matchAll(RAW)) {
      const at = found.index ?? 0;
      const around = source.slice(Math.max(0, at - 260), at + 260);
      expect([file, at, around.includes("newestPolicyVersionPerDocument")]).toEqual([
        file,
        at,
        true,
      ]);
    }
  });
});
