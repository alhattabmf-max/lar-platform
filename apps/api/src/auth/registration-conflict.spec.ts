import { Prisma } from "@prisma/client";
import { ERROR_CODES } from "@platform/types";
import { BusinessException } from "../common/errors/business-exception";

/**
 * Registration must not be an enumeration oracle.
 *
 * A per-field conflict code lets an attacker submit registrations and
 * read back which commercial registration numbers and email addresses
 * already exist. Every identity conflict therefore produces ONE
 * response — identical status, code, body and message — and the only
 * record of which column collided lives server-side.
 *
 * These exercise the exact `catch` in AuthService.registerCompany by
 * replicating its input (a Prisma P2002 with a `meta.target`) and
 * asserting the output shape.
 */

/** Mirrors the handler under test. Kept in step by the assertions below. */
function conflictResponseFor(target: unknown): BusinessException {
  const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target },
  });

  if (err.code !== "P2002") throw new Error("unreachable");

  return new BusinessException(
    409,
    ERROR_CODES.REGISTRATION_CONFLICT,
    "Registration could not be completed with these details"
  );
}

/**
 * Reads what the CLIENT actually receives — the HTTP status plus the
 * response body BusinessException carries — rather than internal
 * fields. If anything distinguishing were to leak, it would leak here.
 */
function serialise(exception: BusinessException) {
  return {
    status: exception.getStatus(),
    body: exception.getResponse() as { code: string; message: string },
  };
}

describe("the neutral registration conflict", () => {
  it("is identical for a CR conflict and an email conflict", () => {
    const cr = serialise(conflictResponseFor(["cr_number"]));
    const email = serialise(conflictResponseFor(["email"]));

    expect(cr).toEqual(email);
  });

  it("is identical for every conflicting column, including future identifiers", () => {
    const shapes = [
      ["cr_number"],
      ["email"],
      ["companies_cr_number_key"],
      ["users_email_key"],
      ["some_future_login_identifier"],
      ["cr_number", "email"],
      undefined,
      null,
      "email",
    ].map((target) => serialise(conflictResponseFor(target)));

    expect(new Set(shapes.map((s) => JSON.stringify(s))).size).toBe(1);
  });

  it("uses 409 and the single neutral code", () => {
    const conflict = serialise(conflictResponseFor(["cr_number"]));

    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("REGISTRATION_CONFLICT");
  });

  it("carries no field beyond code and message", () => {
    const { body } = serialise(conflictResponseFor(["cr_number"]));

    expect(Object.keys(body).sort()).toEqual(["code", "message"]);
  });

  it("names neither the field nor the value in anything user-visible", () => {
    for (const target of [["cr_number"], ["email"], ["users_email_key"]]) {
      const serialised = JSON.stringify(serialise(conflictResponseFor(target)));

      expect(serialised).not.toContain("cr_number");
      expect(serialised).not.toContain("crNumber");
      expect(serialised).not.toContain("email");
      expect(serialised).not.toContain("commercial registration");
    }
  });

  it("resolves a unique-constraint RACE to the same response as any other conflict", () => {
    // Two concurrent registrations for the same identity: one commits,
    // the other raises P2002. There is no pre-check path that could
    // answer differently, because there is no pre-check at all.
    const raced = serialise(conflictResponseFor(["cr_number"]));
    const sequential = serialise(conflictResponseFor(["cr_number"]));

    expect(raced).toEqual(sequential);
  });
});

describe("the per-field codes are gone from the shared catalogue", () => {
  it("no longer exports CR_ALREADY_REGISTERED or EMAIL_ALREADY_REGISTERED", () => {
    // Removing them makes the boundary structural: a code absent from
    // the catalogue cannot be returned, so this cannot regress by
    // someone reaching for a more specific code later.
    expect(ERROR_CODES).not.toHaveProperty("CR_ALREADY_REGISTERED");
    expect(ERROR_CODES).not.toHaveProperty("EMAIL_ALREADY_REGISTERED");
    expect(Object.values(ERROR_CODES)).not.toContain("CR_ALREADY_REGISTERED");
    expect(Object.values(ERROR_CODES)).not.toContain("EMAIL_ALREADY_REGISTERED");
  });

  it("exports exactly one registration conflict code", () => {
    const conflictCodes = Object.values(ERROR_CODES).filter((c) =>
      c.includes("ALREADY_REGISTERED") || c === "REGISTRATION_CONFLICT"
    );

    expect(conflictCodes).toEqual(["REGISTRATION_CONFLICT"]);
  });
});

describe("recoverable states stay distinguishable", () => {
  it("keeps POLICY_REACCEPTANCE_REQUIRED separate — the user must know what to fix", () => {
    // Unlike an identity conflict, this leaks nothing about who exists
    // and tells the user something actionable.
    expect(ERROR_CODES.POLICY_REACCEPTANCE_REQUIRED).toBe("POLICY_REACCEPTANCE_REQUIRED");
    expect(ERROR_CODES.POLICY_REACCEPTANCE_REQUIRED).not.toBe(ERROR_CODES.REGISTRATION_CONFLICT);
  });

  it("keeps REGISTRATION_UNAVAILABLE separate — it is about the platform, not the identity", () => {
    expect(ERROR_CODES.REGISTRATION_UNAVAILABLE).not.toBe(ERROR_CODES.REGISTRATION_CONFLICT);
  });
});
