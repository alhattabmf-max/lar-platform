import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { SessionService, type SessionData } from "./session.service";
import { SESSION_COOKIE_NAME } from "./session-cookie.constants";

export interface AuthenticatedRequest extends Request {
  session: SessionData;
  sessionId: string;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionId = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];

    if (!sessionId) {
      throw new UnauthorizedException("No active session");
    }

    const data = await this.sessions.get(sessionId);
    if (!data) {
      throw new UnauthorizedException("Session expired or invalid");
    }

    req.session = data;
    req.sessionId = sessionId;
    return true;
  }
}
