import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { CSRF_PROTECTION, type CsrfProtection } from "./csrf-protection.interface";

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(CSRF_PROTECTION) private readonly csrf: CsrfProtection) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    this.csrf.assertValid(req);
    return true;
  }
}
