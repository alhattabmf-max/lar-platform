import { Controller, Get } from "@nestjs/common";
import type { SiteContent } from "@platform/types";
import { SiteContentService } from "./site-content.service";

/**
 * Administrator-editable homepage text and header categories.
 *
 * ANONYMOUS and cacheable, like the branding and taxonomy reads it sits
 * beside — this is what an unauthenticated visitor sees on the front
 * page, so gating it would mean the homepage could not render.
 *
 * Every text field may be null. A consumer MUST fall back to its own
 * message catalogue for each null rather than rendering an empty string:
 * "not customised" and "set to nothing" are the same state, and the
 * shipped copy is the right answer to both.
 */
@Controller("public/site-content")
export class SiteContentController {
  constructor(private readonly siteContent: SiteContentService) {}

  @Get()
  get(): Promise<SiteContent> {
    return this.siteContent.get();
  }
}
