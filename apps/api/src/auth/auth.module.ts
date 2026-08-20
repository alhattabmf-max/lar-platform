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
})
export class AuthModule {}
