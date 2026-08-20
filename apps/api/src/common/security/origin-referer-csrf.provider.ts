import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { Env } from "@platform/config";
import { APP_ENV } from "../../config/app-config.module";
import type { CsrfProtection } from "./csrf-protection.interface";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Phase 2 baseline CSRF defense (Blueprint §65: "CSRF حيث يلزم"):
 * the session cookie is issued with SameSite=Lax (see session cookie
 * options at the call site), plus this explicit Origin/Referer
 * allow-list check on every state-changing request as defense in
 * depth. This is intentionally swappable — a future double-submit or
 * synchronizer CSRF-token implementation can be bound to the same
 * `CSRF_PROTECTION` token without touching any auth/controller code.
 */
@Injectable()
export class OriginRefererCsrfProtection implements CsrfProtection {
  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  assertValid(req: Request): void {
    if (!UNSAFE_METHODS.has(req.method)) return;

    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const source = origin ?? referer;

    if (!source) {
      throw new ForbiddenException("Missing Origin/Referer header on a state-changing request");
    }

    const sourceOrigin = this.extractOrigin(source);
    const allowed = this.env.CORS_ALLOWED_ORIGINS;

    if (allowed.length > 0 && !allowed.includes(sourceOrigin)) {
      throw new ForbiddenException("Origin/Referer not in the allowed list");
    }
  }

  private extractOrigin(value: string): string {
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}`;
    } catch {
      return value;
    }
  }
}
