import { Module } from "@nestjs/common";
import { OperationsService } from "./operations.service";
import { OperationsController } from "./operations.controller";
import { VerificationModule } from "../../verification/verification.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [VerificationModule, AdminSessionModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
