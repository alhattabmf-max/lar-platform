import { Module } from "@nestjs/common";
import { AdminAuditService } from "./admin-audit.service";
import { AdminAuditController } from "./admin-audit.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [AdminSessionModule],
  providers: [AdminAuditService],
  controllers: [AdminAuditController],
})
export class AdminAuditModule {}
