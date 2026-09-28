import {
  missingRequirements,
  profileState,
  requirementsFor,
} from "@platform/types";

/**
 * THE BILLING IDENTITY IS PART OF THE RECORD AN ADMINISTRATOR REVIEWS.
 *
 * It used to be entered strictly AFTER approval, which made the review
 * incomplete in both directions: the administrator was asked to approve
 * a company whose billing name and VAT status it could not see, and the
 * supplier was told to wait for an approval that was waiting for them.
 * The bank account was moved out of that circle first; this is the same
 * move for the other two.
 *
 * WHAT APPROVAL GATES DID NOT CHANGE — publishing a product, publishing
 * a listing, taking an order, being paid. `supplier-gating.spec.ts`
 * holds that line; what this file holds is that the supplier is ASKED
 * for the data before submitting, and cannot submit without it.
 */

const COMPLETE = {
  hasCompanyDetails: true,
  hasMainBranch: true,
  hasBankAccount: true,
  hasBillingIdentity: true,
};

describe("a supplier is asked for its billing identity, a buyer is not", () => {
  it("lists it among a supplier's requirements", () => {
    expect(requirementsFor("SUPPLIER")).toContain("billingIdentity");
  });

  it("never asks a buyer for it", () => {
    // Nothing is ever paid out to a buyer, and no commission document
    // is ever addressed to one.
    expect(requirementsFor("TRADER")).not.toContain("billingIdentity");
    expect(requirementsFor("TRADER")).toEqual(["companyDetails", "mainBranch"]);
  });

  it("puts it last, after the account the money goes to", () => {
    // The order is what the banner lists, and a list that reshuffles
    // itself between two loads is one nobody can act on twice.
    expect(requirementsFor("SUPPLIER")).toEqual([
      "companyDetails",
      "mainBranch",
      "bankAccount",
      "billingIdentity",
    ]);
  });
});

describe("what counts as finished", () => {
  it("is not finished while the billing identity is absent", () => {
    const state = profileState("SUPPLIER", {
      ...COMPLETE,
      hasBillingIdentity: false,
    });

    expect(state.complete).toBe(false);
    expect(state.missing).toEqual(["billingIdentity"]);
  });

  it("is finished once it is there", () => {
    expect(profileState("SUPPLIER", COMPLETE)).toEqual({
      complete: true,
      missing: [],
    });
  });

  it("names it beside the others rather than instead of them", () => {
    // A supplier with nothing filled in is told all four, in order, so
    // the screen can link to each.
    expect(
      missingRequirements("SUPPLIER", {
        hasCompanyDetails: false,
        hasMainBranch: false,
        hasBankAccount: false,
        hasBillingIdentity: false,
      }),
    ).toEqual([
      "companyDetails",
      "mainBranch",
      "bankAccount",
      "billingIdentity",
    ]);
  });

  it("leaves a buyer complete without it", () => {
    expect(
      profileState("TRADER", {
        hasCompanyDetails: true,
        hasMainBranch: true,
        hasBankAccount: false,
        hasBillingIdentity: false,
      }).complete,
    ).toBe(true);
  });
});

/**
 * THE FACT IS ONE, AND IT IS THE WHOLE CARD.
 *
 * A supplier that has named its billing identity but left the VAT
 * question unanswered has not finished. Splitting the two would put
 * half an answer in the "done" column — which is how a badge comes to
 * disagree with the form it points at.
 *
 * The composition is asserted here as a table so the rule is readable
 * in one place; the services compute it from the two rows.
 */
describe("the VAT answer is part of it", () => {
  const billingIdentityFrom = (
    invoicingLegalName: string | null,
    tax: { isVatRegistered: boolean; vatNumber: string | null } | null,
  ) =>
    (invoicingLegalName?.trim() ?? "") !== "" &&
    tax !== null &&
    (!tax.isVatRegistered || (tax.vatNumber ?? "").trim() !== "");

  it.each([
    ["a name and a registered VAT number", "شركة", { isVatRegistered: true, vatNumber: "310123456700003" }, true],
    ["a name and «not registered»", "شركة", { isVatRegistered: false, vatNumber: null }, true],
    ["a name but no VAT answer at all", "شركة", null, false],
    ["registered with no number", "شركة", { isVatRegistered: true, vatNumber: null }, false],
    ["registered with a blank number", "شركة", { isVatRegistered: true, vatNumber: "   " }, false],
    ["a VAT answer but no name", null, { isVatRegistered: false, vatNumber: null }, false],
    ["a blank name", "   ", { isVatRegistered: false, vatNumber: null }, false],
    ["neither", null, null, false],
  ] as const)("%s → %s", (_label, name, tax, expected) => {
    expect(billingIdentityFrom(name, tax)).toBe(expected);
  });
});
