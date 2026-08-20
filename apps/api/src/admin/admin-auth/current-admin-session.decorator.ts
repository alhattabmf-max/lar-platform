import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AdminAuthenticatedRequest } from "./admin-session-auth.guard";

export const CurrentAdminSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    return req.adminSession;
  }
);
