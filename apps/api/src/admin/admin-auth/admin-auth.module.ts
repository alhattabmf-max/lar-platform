import { Module } from "@nestjs/common";
import { AdminAuthService } from "./admin-auth.service";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminLoginTicketService } from "./admin-login-ticket.service";
import { AdminSessionModule } from "./admin-session.module";
import { DynamicRateLimiter } from "../../common/security/dynamic-rate-limiter";
import { RedisThrottlerStorage } from "../../common/security/redis-throttler.storage";
import { SecuritySettingsModule } from "../../settings/security-settings.module";

@Module({
  imports: [AdminSessionModule, SecuritySettingsModule],
  providers: [AdminAuthService, AdminLoginTicketService, DynamicRateLimiter, RedisThrottlerStorage],
  controllers: [AdminAuthController],
  exports: [AdminSessionModule],
})
export class AdminAuthModule {}
