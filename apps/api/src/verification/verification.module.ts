import { Module } from "@nestjs/common";
import { VERIFICATION_PROVIDER } from "./verification-provider.interface";
import { MockVerificationProvider } from "./mock-verification.provider";
import { VerificationService } from "./verification.service";
import { VerificationController } from "./verification.controller";

@Module({
  controllers: [VerificationController],
  providers: [
    { provide: VERIFICATION_PROVIDER, useClass: MockVerificationProvider },
    VerificationService,
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
