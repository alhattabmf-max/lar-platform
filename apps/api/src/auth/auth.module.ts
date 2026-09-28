import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { MeController } from "./me.controller";
import { PoliciesModule } from "../policies/policies.module";
import { VerificationModule } from "../verification/verification.module";
import { EmailModule } from "../email/email.module";

@Module({
  imports: [PoliciesModule, VerificationModule, EmailModule],
  controllers: [AuthController, MeController],
  providers: [AuthService],
  // EXPORTED for one caller and one method: the control panel sends a
  // company user a password-reset link, and it must be THE reset flow —
  // same single-use token, same expiry, same delivery — rather than a
  // second one written beside it. Nothing else in this module leaves it.
  exports: [AuthService],
})
export class AuthModule {}
