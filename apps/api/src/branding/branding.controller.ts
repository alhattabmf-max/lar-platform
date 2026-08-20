import { Controller, Get } from "@nestjs/common";
import type { BrandingPublic } from "@platform/types";
import { BrandingService } from "./branding.service";

/**
 * Public, read-only branding. No session, no guards — the web app's
 * shell needs the brand name and logo before anyone has signed in.
 *
 * Deliberately separate from AdminBrandingController: that one is
 * admin-authenticated, CSRF-guarded, returns the FULL row (including
 * invoiceLogoUrl and updatedBy) and can write. Sharing a controller or a
 * service between the two would put the public path one refactor away
 * from leaking admin-only fields.
 *
 * No CSRF guard is needed: this is a GET, and the CSRF provider exempts
 * safe methods by design.
 */
@Controller("branding")
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  get(): Promise<BrandingPublic> {
    return this.branding.getPublic();
  }
}
