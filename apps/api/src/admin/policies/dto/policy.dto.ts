import { IsBoolean, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  POLICY_CODE_PATTERN,
  POLICY_TEXT_MAX,
  POLICY_TEXT_MIN,
  POLICY_VERSION_LABEL_MAX,
} from "@platform/types";

/**
 * The bounds are the shared constants, not numbers retyped here.
 *
 * The service re-checks every one of them: these DTOs stop a malformed
 * request at the edge, and the service is what decides — a rule enforced
 * only at the edge is a rule any other caller skips.
 */

export class CreatePolicyDocumentDto {
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(POLICY_CODE_PATTERN, {
    message:
      "code must be lower-case letters, digits and underscores, starting with a letter",
  })
  code!: string;
}

export class WritePolicyVersionDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(POLICY_VERSION_LABEL_MAX)
  versionLabel!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(POLICY_TEXT_MIN)
  @MaxLength(POLICY_TEXT_MAX)
  textAr!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(POLICY_TEXT_MIN)
  @MaxLength(POLICY_TEXT_MAX)
  textEn!: string;

  /** Whether registration cannot complete without accepting it. */
  @IsBoolean()
  isMandatory!: boolean;

  /** Whether existing users must accept it again. */
  @IsBoolean()
  requiresReacceptance!: boolean;
}
