import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "./admin-reason.constants";
import { AdminReasonBodyDto } from "./admin-reason.dto";
import { RejectSupplierDto } from "../../admin/operations/dto/reject-supplier.dto";
import { RejectBankAccountDto } from "../../admin/financial/dto/reject-bank-account.dto";
import { RejectProductDto } from "../../admin/products/dto/reject-product.dto";
import { ProductAdministrativeActionDto } from "../../admin/products/dto/product-administrative-action.dto";
import { PauseOpportunityDto } from "../../admin/opportunities/dto/pause-opportunity.dto";
import { CancelOpportunityDto } from "../../admin/opportunities/dto/cancel-opportunity.dto";
import { AdminConfirmDeliveryDto } from "../../fulfillment/dto/admin-confirm-delivery.dto";
import { DecideProductReportDto } from "../../product-reports/dto/decide-product-report.dto";
import { AdminReasonDto } from "../../admin/admin-users/dto/admin-reason.dto";

/**
 * Every administrative denial carries a real, written reason.
 *
 * THREE of these DTOs declared `reason` optional, and their controllers
 * then substituted the literal string "No reason provided" into the
 * audit log and into the message delivered to the company. That is a
 * fabricated record: it reads exactly like a sentence an administrator
 * typed, and nothing downstream can tell the difference.
 *
 * THREE more declared `@MinLength(1)`, which accepts a single character
 * — a bound in name only, on decisions that cancel a supplier's ability
 * to sell.
 *
 * The global pipe runs with `whitelist: true, forbidNonWhitelisted: true`
 * (configure-app.ts), so these are validated exactly as a real request
 * would be.
 */

function check(cls: new () => object, raw: unknown) {
  const instance = plainToInstance(cls, raw);
  return validateSync(instance, { whitelist: true, forbidNonWhitelisted: true });
}

/** Every DTO whose reason field is named `reason`. */
const REASON_DTOS: ReadonlyArray<readonly [string, new () => object]> = [
  ["AdminReasonBodyDto", AdminReasonBodyDto],
  ["AdminReasonDto (admin users)", AdminReasonDto],
  ["RejectSupplierDto", RejectSupplierDto],
  ["RejectBankAccountDto", RejectBankAccountDto],
  ["RejectProductDto", RejectProductDto],
  ["ProductAdministrativeActionDto", ProductAdministrativeActionDto],
  ["PauseOpportunityDto", PauseOpportunityDto],
  ["CancelOpportunityDto", CancelOpportunityDto],
];

/** The two whose field is named something else. */
const OTHER_FIELD_DTOS: ReadonlyArray<readonly [string, new () => object, string]> = [
  ["AdminConfirmDeliveryDto", AdminConfirmDeliveryDto, "reasonNote"],
  ["DecideProductReportDto", DecideProductReportDto, "note"],
];

describe("the shared bounds", () => {
  it("require more than one character and cap stored text", () => {
    expect(ADMIN_REASON_MIN).toBeGreaterThan(1);
    expect(ADMIN_REASON_MAX).toBeGreaterThan(ADMIN_REASON_MIN);
  });
});

describe.each(REASON_DTOS)("%s", (_name, cls) => {
  it("REJECTS an omitted reason", () => {
    // The regression that matters: an optional field here is what let
    // "No reason provided" become a stored sentence.
    expect(check(cls, {}).length).toBeGreaterThan(0);
  });

  it("REJECTS a single character", () => {
    expect(check(cls, { reason: "x" }).length).toBeGreaterThan(0);
  });

  it("REJECTS whitespace that would otherwise satisfy the minimum", () => {
    // Trimmed BEFORE the length is measured, so a field of spaces is
    // not a reason.
    expect(check(cls, { reason: " ".repeat(ADMIN_REASON_MIN + 5) }).length).toBeGreaterThan(0);
  });

  it("REJECTS text beyond the maximum", () => {
    expect(check(cls, { reason: "x".repeat(ADMIN_REASON_MAX + 1) }).length).toBeGreaterThan(0);
  });

  it("accepts a real reason", () => {
    expect(check(cls, { reason: "Documents do not match the registration" })).toHaveLength(0);
  });

  it("REJECTS an undeclared property", () => {
    // `forbidNonWhitelisted` is what makes these DTOs closed: an extra
    // field is a 400, not a silently ignored value.
    expect(check(cls, { reason: "A valid reason here", adminUserId: "x" }).length).toBeGreaterThan(
      0
    );
  });
});

describe.each(OTHER_FIELD_DTOS)("%s", (_name, cls, field) => {
  it("REJECTS an omitted value", () => {
    expect(check(cls, {}).length).toBeGreaterThan(0);
  });

  it("REJECTS a single character", () => {
    expect(check(cls, { [field]: "x" }).length).toBeGreaterThan(0);
  });

  it("accepts a real one", () => {
    expect(check(cls, { [field]: "Buyer confirmed receipt by phone" })).toHaveLength(0);
  });
});
