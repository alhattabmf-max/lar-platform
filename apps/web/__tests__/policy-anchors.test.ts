import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KNOWN_POLICY_DOCUMENT_CODES,
  POLICY_ANCHORS,
  policyAnchorId,
} from "@/lib/policy-labels";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * Terms and Privacy must reach their OWN document.
 *
 * Both footer links used to point at `/policies` with no fragment, so a
 * visitor asking for the privacy policy landed at the top of a page
 * listing every document and had to find it themselves.
 */
describe("a policy anchor is derived, never invented", () => {
  it("turns a document code into a readable fragment", () => {
    expect(policyAnchorId("terms_of_service")).toBe("policy-terms-of-service");
    expect(policyAnchorId("privacy_policy")).toBe("policy-privacy-policy");
  });

  it("covers exactly the closed vocabulary of known documents", () => {
    expect(Object.keys(POLICY_ANCHORS).sort()).toEqual(
      [...KNOWN_POLICY_DOCUMENT_CODES].sort(),
    );
  });

  it("gives every known document a distinct anchor", () => {
    const anchors = Object.values(POLICY_ANCHORS);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("produces a URL-safe fragment with no underscores", () => {
    for (const anchor of Object.values(POLICY_ANCHORS)) {
      // It appears in the address bar and gets pasted into messages.
      expect(anchor).toMatch(/^[a-z-]+$/);
      expect(anchor).not.toContain("_");
    }
  });

  it("handles an unknown code without throwing", () => {
    // A document nobody has translated yet still gets an anchor rather
    // than crashing the page that lists it.
    expect(policyAnchorId("some_future_document")).toBe(
      "policy-some-future-document",
    );
  });
});

/**
 * WHERE THIS BEHAVIOUR NOW LIVES.
 *
 * The footer's links used to be written into `footer.tsx`, and so were
 * its two policy fragments — which is what this block used to read. The
 * footer became operator-configurable, so the server decides the order,
 * the wording and the destinations, and `footer.tsx` draws whatever it
 * is handed.
 *
 * What survives on this side is the FALLBACK the shell renders when the
 * footer cannot be read at all. It still names the two policy links, so
 * it is still a place a fragment could be typed by hand and drift — and
 * it is what these checks moved to. The server's own version of the
 * same rule is pinned in `apps/api/src/branding/footer.service.spec.ts`
 * ("addresses a policy by its code, never by a version id").
 */
describe("the footer's fallback links to the right document", () => {
  const BRANDING = read("lib/branding.ts");
  const FOOTER = read("components/shell/footer.tsx");

  it("sends Terms and Privacy to different fragments", () => {
    expect(BRANDING).toContain("POLICY_ANCHORS.terms_of_service");
    expect(BRANDING).toContain("POLICY_ANCHORS.privacy_policy");
  });

  it("does not hardcode either fragment as a string", () => {
    // A fragment typed here and an id built there is exactly how the
    // two drift apart, and a broken anchor fails silently.
    expect(BRANDING).not.toContain('"#terms');
    expect(BRANDING).not.toContain('"#privacy');
    expect(BRANDING).not.toContain("policy-terms-of-service");
    expect(BRANDING).not.toContain("policy-privacy-policy");
  });

  it("still points at the one policies route — no invented per-document page", () => {
    expect(BRANDING).toContain("/policies#");
    expect(BRANDING).not.toContain("/terms-of-service");
    expect(BRANDING).not.toContain("/privacy-policy");
  });

  it("leaves the component with no destination of its own to drift", () => {
    // The component builds NO href beyond the locale prefix. That is
    // what makes the server the single place a footer destination is
    // decided, rather than two places that agree today.
    expect(FOOTER).not.toContain("/policies");
    expect(FOOTER).not.toContain("POLICY_ANCHORS");
  });
});

describe("the policies page carries those anchors", () => {
  const PAGE = read("app/[locale]/(public)/policies/page.tsx");

  it("ids each section by document code, not by version id", () => {
    // A version id changes on every revision, so a link built on one
    // would rot the first time the document was updated.
    expect(PAGE).toContain("id={policyAnchorId(policy.documentCode)}");
    expect(PAGE).not.toContain("id={`policy-${policy.id}`}");
  });

  it("uses the same helper for its own contents list", () => {
    expect(PAGE).toContain("href={`#${policyAnchorId(policy.documentCode)}`}");
  });

  it("moves FOCUS to the section, not only the scroll position", () => {
    // Without this a keyboard or screen-reader user is scrolled to the
    // section while focus stays at the top of the document.
    expect(PAGE).toContain("tabIndex={-1}");
    expect(PAGE).toContain("scroll-mt-24");
  });

  it("keeps its safe state when nothing is published", () => {
    // The API returns only published versions. An empty list is the
    // normal "nothing published yet" state, not an error — and the
    // fragment simply matches nothing.
    expect(PAGE).toContain("result.data.length === 0");
    expect(PAGE).toContain("EmptyState");
  });

  it("invents no document content", () => {
    for (const code of KNOWN_POLICY_DOCUMENT_CODES) {
      // Titles come from the message catalogue by code; body text comes
      // from the API. Neither is written into this page.
      expect(PAGE).not.toContain(`"${code}":`);
    }
    expect(PAGE).toContain("policyDocumentLabel");
  });
});

describe("quantities are shown without a guessed plural", () => {
  const LABELS = read("lib/offer-labels.ts");
  const DETAIL = read("app/[locale]/(public)/opportunities/[id]/page.tsx");

  it("renders a bare number, never number-plus-unit", () => {
    // Arabic inflects a counted noun by the count and the catalogue
    // stores one name per selling unit, so "10 طبلية" is wrong and
    // deriving the plural would be inventing grammar.
    expect(LABELS).toContain("function quantity(count: number)");
    expect(LABELS).not.toContain("quantityWithUnit");
    expect(DETAIL).not.toContain("card.quantityWithUnit");
  });

  it("dropped the interpolation key from both catalogues", () => {
    for (const locale of ["ar-SA", "en-SA"]) {
      const messages = JSON.parse(read(`messages/${locale}.json`));
      expect(messages.marketplace.card.quantityWithUnit).toBeUndefined();
    }
  });

  it("shows the selling unit NOWHERE on the card, and once on the detail", () => {
    // IT HAD A ROW, THEN A PLACE ON THE PRICE, AND NOW NEITHER —
    // «كلمة طبلية، اللي هي وحدة البيع، موجودة في التفاصيل، ما
    //  أحتاجها».
    //
    // THE RULE THIS CASE EXISTS FOR IS UNCHANGED: wherever the unit
    // IS shown it is shown ONCE and never pluralised by guess. The
    // words are still in both catalogues because the detail page
    // states them.
    for (const locale of ["ar-SA", "en-SA"]) {
      const messages = JSON.parse(read(`messages/${locale}.json`));
      expect(messages.marketplace.card.unit.trim()).not.toBe("");
    }
    const card = read("components/opportunities/opportunity-card.tsx");
    expect(card).not.toContain("/ {unit}");
    expect(card).not.toContain("labels.unitLabel");
  });
});
