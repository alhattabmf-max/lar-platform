import { Global, Module } from "@nestjs/common";
import { SessionService } from "./session.service";
import { CSRF_PROTECTION } from "./csrf-protection.interface";
import { OriginRefererCsrfProtection } from "./origin-referer-csrf.provider";
import { CsrfGuard } from "./csrf.guard";
import { SessionAuthGuard } from "./session-auth.guard";

@Global()
@Module({
  providers: [
    SessionService,
    { provide: CSRF_PROTECTION, useClass: OriginRefererCsrfProtection },
    CsrfGuard,
    SessionAuthGuard,
  ],
  exports: [SessionService, CSRF_PROTECTION, CsrfGuard, SessionAuthGuard],
})
export class SecurityModule {}
