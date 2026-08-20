import { Module } from "@nestjs/common";
import { AdminSessionService } from "./admin-session.service";
import { AdminSessionAuthGuard } from "./admin-session-auth.guard";

@Module({
  providers: [AdminSessionService, AdminSessionAuthGuard],
  exports: [AdminSessionService, AdminSessionAuthGuard],
})
export class AdminSessionModule {}
