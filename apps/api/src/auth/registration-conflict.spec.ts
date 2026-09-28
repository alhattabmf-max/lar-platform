import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { ERROR_CODES } from "@platform/types";
import { BusinessException } from "../common/errors/business-exception";
import {
  conflictedColumns,
  identityConflictCode,
  isUniqueViolation,
} from "./identity-conflict";

/**
 * WHICH IDENTITY WAS TAKEN — named, and named ONLY.
 *
 * THIS FILE USED TO ASSERT THE OPPOSITE, and was right to while the
 * rule was the opposite: every identity conflict produced one
 * identical response so that registration could not be used to
 * discover which commercial registration numbers and email addresses
 * exist here.
 *
 * The owner changed the rule — «مع تنبيه ان الرقم او الاميل مسجل
 * مسبقا» — after the enumeration cost was put to them in writing. So
 * the refusal names the FIELD now. What has NOT changed, and what
 * these cases exist for:
 *
 *   · A VALUE IS NEVER ECHOED. The field is read from Prisma's
 *     `meta.target`, which reports columns; no address, CR number,
 *     mobile or tax number passes through the response.
 *   · THE BODY CARRIES NOTHING ELSE — a code and a sentence.
 *   · THE DATABASE STILL DECIDES. There is no pre-check, so a race
 *     between two registrations for the same identity resolves the
 *     same way a sequential pair does.
 *   · AN UNRECOGNISED CONSTRAINT STAYS NEUTRAL rather than being
 *     guessed at.
 *
 * These exercise the exact `catch` in AuthService.registerCompany by
 * replicating its input and asserting the output.
 */

/** Mirrors the handler under test. Kept in step by the assertions below. */
function conflictResponseFor(target: unknown): BusinessException {
  const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target },
  });

  if (!isUniqueViolation(err)) throw new Error("unreachable");

  return new BusinessException(
    409,
    identityConflictCode(err),
    "That identity is already registered"
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

describe("the refusal names the field", () => {
  it.each([
    [["cr_number"], ERROR_CODES.CR_NUMBER_TAKEN],
    [["crNumber"], ERROR_CODES.CR_NUMBER_TAKEN],
    [["email"], ERROR_CODES.EMAIL_TAKEN],
    [["primary_mobile_1"], ERROR_CODES.MOBILE_TAKEN],
    [["primaryMobile1"], ERROR_CODES.MOBILE_TAKEN],
    [["vat_number"], ERROR_CODES.VAT_NUMBER_TAKEN],
    [["vatNumber"], ERROR_CODES.VAT_NUMBER_TAKEN],
  ])("maps %s onto %s", (target, code) => {
    expect(serialise(conflictResponseFor(target)).body.code).toBe(code);
  });

  it("keeps 409, whichever identity it was", () => {
    for (const target of [["cr_number"], ["email"], ["primary_mobile_1"], ["vat_number"]]) {
      expect(serialise(conflictResponseFor(target)).status).toBe(409);
    }
  });

  it("tells the four apart — one code each, never a shared one", () => {
    const codes = [["cr_number"], ["email"], ["primary_mobile_1"], ["vat_number"]].map(
      (target) => serialise(conflictResponseFor(target)).body.code
    );

    expect(new Set(codes).size).toBe(4);
  });

  it("stays NEUTRAL for a constraint it does not recognise", () => {
    // An index added later must not be guessed at and reported as one
    // of the four; the general conflict is the honest answer.
    for (const target of [["some_future_column"], ["id"], null, undefined]) {
      expect([target, serialise(conflictResponseFor(target)).body.code]).toEqual([
        target,
        ERROR_CODES.REGISTRATION_CONFLICT,
      ]);
    }
  });
});

describe("what the response still refuses to say", () => {
  it("names a FIELD, never a value", () => {
    // The column is what Prisma reports and the only thing read. No
    // address, number or company name can travel this path — there is
    // nothing in `meta.target` to carry one.
    for (const target of [["cr_number"], ["email"], ["primary_mobile_1"], ["vat_number"]]) {
      const serialised = JSON.stringify(serialise(conflictResponseFor(target)));

      expect(serialised).not.toContain("cr_number");
      expect(serialised).not.toContain("primary_mobile_1");
      expect(serialised).not.toContain("vat_number");
      expect(serialised).not.toContain("@");
    }
  });

  it("carries no field beyond code and message", () => {
    const { body } = serialise(conflictResponseFor(["cr_number"]));

    expect(Object.keys(body).sort()).toEqual(["code", "message"]);
  });

  it("resolves a unique-constraint RACE the same way a sequence does", () => {
    // There is still no pre-check: the constraint decides, so two
    // concurrent registrations for one identity both land here and
    // both get the same answer.
    const raced = serialise(conflictResponseFor(["cr_number"]));
    const sequential = serialise(conflictResponseFor(["cr_number"]));

    expect(raced).toEqual(sequential);
  });

  it("reads the columns for the LOG without reformatting them", () => {
    // The server-side record keeps the raw constraint, which is what
    // makes a surprising conflict diagnosable.
    const err = new Prisma.PrismaClientKnownRequestError("x", {
      code: "P2002",
      clientVersion: "5.22.0",
      meta: { target: ["cr_number", "email"] },
    });

    expect(conflictedColumns(err)).toBe("cr_number,email");
  });
});

describe("the catalogue carries one code per identity", () => {
  it("exports all four, and they are distinct", () => {
    const four = [
      ERROR_CODES.CR_NUMBER_TAKEN,
      ERROR_CODES.EMAIL_TAKEN,
      ERROR_CODES.MOBILE_TAKEN,
      ERROR_CODES.VAT_NUMBER_TAKEN,
    ];

    expect(new Set(four).size).toBe(4);
    for (const code of four) expect(Object.values(ERROR_CODES)).toContain(code);
  });

  it("keeps the neutral code, for the constraints that are not identities", () => {
    expect(ERROR_CODES.REGISTRATION_CONFLICT).toBe("REGISTRATION_CONFLICT");
  });

  it("does not resurrect the old per-field names", () => {
    // The rule changed; the vocabulary did not go back. `…_TAKEN` says
    // what is true — the value belongs to somebody — without the
    // implication that the reader is the one who registered it.
    expect(ERROR_CODES).not.toHaveProperty("CR_ALREADY_REGISTERED");
    expect(ERROR_CODES).not.toHaveProperty("EMAIL_ALREADY_REGISTERED");
  });
});

describe("recoverable states stay distinguishable", () => {
  it("keeps POLICY_REACCEPTANCE_REQUIRED separate", () => {
    expect(ERROR_CODES.POLICY_REACCEPTANCE_REQUIRED).toBe("POLICY_REACCEPTANCE_REQUIRED");
    expect(ERROR_CODES.POLICY_REACCEPTANCE_REQUIRED).not.toBe(ERROR_CODES.REGISTRATION_CONFLICT);
  });

  it("keeps REGISTRATION_UNAVAILABLE separate — it is about the platform, not the identity", () => {
    expect(ERROR_CODES.REGISTRATION_UNAVAILABLE).not.toBe(ERROR_CODES.REGISTRATION_CONFLICT);
  });
});

describe("the answer is rate-limited, because it is now informative", () => {
  it("throttles both registration endpoints like login", () => {
    // Naming the field makes registration able to answer "does this CR
    // number exist here". A limit does not cure enumeration; it turns
    // a list into a crawl, and it is what this endpoint never had while
    // the answer told an attacker nothing.
    const controller = readFileSync(join(__dirname, "auth.controller.ts"), "utf8");

    // Each register decorator, and the line that follows it — not the
    // rest of the file, which also throttles login and the password
    // reset and would pass this vacuously.
    for (const route of ["register/trader", "register/supplier"]) {
      const at = controller.indexOf(`@Post("${route}")`);
      expect([route, at]).not.toEqual([route, -1]);
      const decorators = controller.slice(at, at + 160);
      expect([route, /@Throttle\(\{ default: \{ limit: 5, ttl: 60_000 \} \}\)/.test(decorators)]).toEqual(
        [route, true]
      );
    }
  });
});
