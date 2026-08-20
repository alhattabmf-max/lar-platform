import type { Request } from "express";

export interface CsrfProtection {
  /** Throws (typically ForbiddenException) if the request fails CSRF checks. */
  assertValid(req: Request): void;
}

export const CSRF_PROTECTION = Symbol("CSRF_PROTECTION");
