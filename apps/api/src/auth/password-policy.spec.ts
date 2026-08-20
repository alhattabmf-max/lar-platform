import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { PASSWORD_MIN_LENGTH } from "@platform/types";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { RegisterCompanyDto } from "./dto/register-company.dto";
import { VerifyEmailDto } from "./dto/verify-email.dto";

/**
 * Contract test for the shared password rule.
 *
 * apps/web validates password length before submitting, using
 * PASSWORD_MIN_LENGTH from @platform/types. If that constant drifted
 * from the `@MinLength` on these DTOs, the client would either reject
 * passwords the server accepts, or promise acceptance and then fail on
 * submit. This is what keeps the two in step.
 */
function errorsFor(cls: new () => object, raw: unknown) {
  return validateSync(plainToInstance(cls, raw), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

function passwordErrors(errors: ReturnType<typeof errorsFor>, field: string) {
  return errors.filter((e) => e.property === field);
}

describe("the shared PASSWORD_MIN_LENGTH matches the DTOs", () => {
  it("ResetPasswordDto rejects one character below the shared minimum", () => {
    const errors = errorsFor(ResetPasswordDto, {
      token: "t",
      newPassword: "x".repeat(PASSWORD_MIN_LENGTH - 1),
    });

    expect(passwordErrors(errors, "newPassword")).toHaveLength(1);
  });

  it("ResetPasswordDto accepts exactly the shared minimum", () => {
    const errors = errorsFor(ResetPasswordDto, {
      token: "t",
      newPassword: "x".repeat(PASSWORD_MIN_LENGTH),
    });

    expect(passwordErrors(errors, "newPassword")).toHaveLength(0);
  });

  it("RegisterCompanyDto uses the same minimum", () => {
    const base = {
      crNumber: "1010101010",
      legalName: "Example",
      email: "owner@example.com",
      primaryMobile1: "0500000000",
      primaryMobile2: "0500000001",
      cityId: "11111111-1111-4111-8111-111111111111",
      shortAddress: "ABCD1234",
      latitude: 24.7,
      longitude: 46.6,
      acceptedPolicyVersionIds: ["22222222-2222-4222-8222-222222222222"],
    };

    const tooShort = errorsFor(RegisterCompanyDto, {
      ...base,
      password: "x".repeat(PASSWORD_MIN_LENGTH - 1),
    });
    const exact = errorsFor(RegisterCompanyDto, {
      ...base,
      password: "x".repeat(PASSWORD_MIN_LENGTH),
    });

    expect(passwordErrors(tooShort, "password")).toHaveLength(1);
    expect(passwordErrors(exact, "password")).toHaveLength(0);
  });
});

describe("the token DTOs are exactly what the web app sends", () => {
  it("ResetPasswordDto requires token and newPassword — not `password`", () => {
    const wrongFieldName = errorsFor(ResetPasswordDto, {
      token: "t",
      password: "a-strong-passphrase",
    });

    expect(wrongFieldName.length).toBeGreaterThan(0);
    expect(errorsFor(ResetPasswordDto, { token: "t", newPassword: "a-strong-passphrase" }))
      .toHaveLength(0);
  });

  it("ResetPasswordDto rejects an empty token", () => {
    const errors = errorsFor(ResetPasswordDto, {
      token: "",
      newPassword: "a-strong-passphrase",
    });

    expect(passwordErrors(errors, "token")).toHaveLength(1);
  });

  it("VerifyEmailDto accepts a token and nothing else", () => {
    expect(errorsFor(VerifyEmailDto, { token: "t" })).toHaveLength(0);
    expect(errorsFor(VerifyEmailDto, { token: "" }).length).toBeGreaterThan(0);
    // Closed: an extra property is a 400 under forbidNonWhitelisted.
    expect(errorsFor(VerifyEmailDto, { token: "t", email: "a@b.test" }).length).toBeGreaterThan(0);
  });

  it("neither DTO accepts a one-time code field", () => {
    for (const field of ["otp", "code", "verificationCode", "totp"]) {
      expect(
        errorsFor(ResetPasswordDto, {
          token: "t",
          newPassword: "a-strong-passphrase",
          [field]: "123456",
        }).length
      ).toBeGreaterThan(0);
      expect(errorsFor(VerifyEmailDto, { token: "t", [field]: "123456" }).length).toBeGreaterThan(0);
    }
  });
});
