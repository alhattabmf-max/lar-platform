import { IsString, MinLength } from "class-validator";

/**
 * Regenerating recovery codes.
 *
 * Takes the current password even though the caller already holds an
 * MFA-completed session: this mints a fresh set of bearer credentials
 * that bypass the authenticator, and possession of a session is a weaker
 * proof than knowing the password. An unattended logged-in machine
 * should not be enough.
 */
export class AdminRecoveryRegenerateDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;
}
