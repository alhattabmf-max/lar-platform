import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AdminSessionService, type AdminSessionData } from "./admin-session.service";
import { ADMIN_SESSION_COOKIE_NAME } from "./admin-session-cookie.constants";

export interface AdminAuthenticatedRequest extends Request {
  adminSession: AdminSessionData;
  adminSessionId: string;
}

@Injectable()
export class AdminSessionAuthGuard implements CanActivate {
  constructor(private readonly sessions: AdminSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    const sessionId = (req.cookies as Record<string, string> | undefined)?.[
      ADMIN_SESSION_COOKIE_NAME
    ];

    if (!sessionId) {
      throw new UnauthorizedException("No active admin session");
    }

    const data = await this.sessions.get(sessionId);
    if (!data) {
      throw new UnauthorizedException("Admin session expired or invalid");
    }

    req.adminSession = data;
    req.adminSessionId = sessionId;
    return true;
  }
}
