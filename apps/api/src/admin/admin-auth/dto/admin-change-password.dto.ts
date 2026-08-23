import { IsString, MaxLength, MinLength } from "class-validator";

/**
 * Changing an administrator's own password.
 *
 * The minimum matches the bootstrap CLI's — 12 characters, not the
 * company-user minimum of 8. An administrator's credential protects the
 * whole platform, and two different floors for the same account would
 * mean the CLI and this route disagreed about what is acceptable.
 *
 * The maximum exists because Argon2 hashes whatever it is given, and an
 * unbounded password is an unbounded amount of work per attempt.
 *
 * Neither value is trimmed. Leading and trailing spaces are legitimate
 * password characters, and silently removing them would make a password
 * set here fail against a password manager that kept them.
 */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_LENGTH = 256;

export class AdminChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(ADMIN_PASSWORD_MIN_LENGTH)
  @MaxLength(ADMIN_PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
