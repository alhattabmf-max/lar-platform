import { Controller, Get, UseGuards } from "@nestjs/common";
import type { PolicyLimits } from "@platform/types";
import { MediaPolicyService } from "../settings/media-policy.service";
import { OpportunitySettingsService } from "../settings/opportunity-settings.service";
import { SessionAuthGuard } from "../common/security/session-auth.guard";

/**
 * The limits a supplier's own forms need, and nothing else.
 *
 * Both settings are admin-configured and were readable only at
 * `GET /admin/settings/*` behind the admin guard, so the product and
 * listing forms stated no limit and relied on the server's refusal to
 * explain what went wrong. Correct, but unkind: someone discovers a
 * limit by hitting it.
 *
 * A PROJECTION, not a re-export. `OpportunitySettingsConfig` also
 * carries `showScheduledPubliclyEnabled` — an internal display policy
 * about what anonymous visitors see — and it is deliberately absent.
 * Exposing a settings object wholesale because part of it is useful is
 * how an internal flag ends up on a public surface.
 *
 * Behind `SessionAuthGuard` and under `companies/me` because these are
 * operating limits for a signed-in company, not marketing copy. No role
 * guard: a trader reading them learns nothing about anyone's business,
 * and adding one would mean this route disagreed with the two settings
 * services about who may know a maximum file size.
 *
 * Read-only, so no `CsrfGuard`.
 *
 * THE SERVER REMAINS THE AUTHORITY. These figures let a form warn before
 * a submit; they do not let it decide.
 */
@Controller("companies/me")
@UseGuards(SessionAuthGuard)
export class PolicyLimitsController {
  constructor(
    private readonly mediaPolicy: MediaPolicyService,
    private readonly opportunitySettings: OpportunitySettingsService
  ) {}

  @Get("policy-limits")
  async limits(): Promise<PolicyLimits> {
    const [media, opportunity] = await Promise.all([
      this.mediaPolicy.getPolicy(),
      this.opportunitySettings.getConfig(),
    ]);

    return {
      media: {
        maxImagesPerProduct: media.maxImagesPerProduct,
        maxSizeBytes: media.maxSizeBytes,
        allowedTypes: [...media.allowedTypes],
        maxPixels: media.maxPixels,
      },
      opportunity: {
        minDurationHours: opportunity.minDurationHours,
        maxDurationDays: opportunity.maxDurationDays,
        minTargetQuantity: opportunity.minTargetQuantity,
        maxTargetQuantity: opportunity.maxTargetQuantity,
        // `showScheduledPubliclyEnabled` is NOT here, deliberately.
      },
    };
  }
}
