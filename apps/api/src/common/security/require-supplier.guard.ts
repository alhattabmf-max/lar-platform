import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthenticatedRequest } from "./session-auth.guard";

@Injectable()
export class RequireSupplierGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.session?.accountType !== "SUPPLIER") {
      throw new ForbiddenException("This action requires a supplier account");
    }
    return true;
  }
}
