import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthenticatedRequest } from "./session-auth.guard";

@Injectable()
export class RequireTraderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.session?.accountType !== "TRADER") {
      throw new ForbiddenException("This action requires a trader account");
    }
    return true;
  }
}
