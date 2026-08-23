/**
 * The limits a supplier's own forms need, and nothing else.
 *
 * Both values are admin-configured — `MediaPolicyService` and
 * `OpportunitySettingsService` — and until now were readable only at
 * `GET /admin/settings/*` behind the admin guard. A supplier could not
 * see them, so the product and listing forms stated no limit at all and
 * relied on the server's refusal to explain what went wrong. That is
 * correct but unkind: someone discovers a limit by hitting it.
 *
 * This is a PROJECTION of those two settings, not a re-export.
 * `OpportunitySettingsConfig` also carries `showScheduledPubliclyEnabled`
 * — an internal display policy about what anonymous visitors see — and it
 * is deliberately absent here. Exposing a settings object wholesale
 * because part of it is useful is how an internal flag ends up on a
 * public surface.
 *
 * THE SERVER REMAINS THE AUTHORITY. These figures let a form warn before
 * a submit; they do not let it decide. Every bound is re-checked server
 * side, and a form that passed these checks can still be refused.
 */

export interface MediaPolicyLimits {
  maxImagesPerProduct: number;
  maxSizeBytes: number;
  /** MIME types the image processor accepts, e.g. `["image/jpeg", …]`. */
  allowedTypes: string[];
  maxPixels: number;
}

export const MEDIA_POLICY_LIMITS_KEYS = [
  "maxImagesPerProduct",
  "maxSizeBytes",
  "allowedTypes",
  "maxPixels",
] as const satisfies readonly (keyof MediaPolicyLimits)[];

export interface OpportunityLimits {
  minDurationHours: number;
  maxDurationDays: number;
  minTargetQuantity: number;
  maxTargetQuantity: number;
}

export const OPPORTUNITY_LIMITS_KEYS = [
  "minDurationHours",
  "maxDurationDays",
  "minTargetQuantity",
  "maxTargetQuantity",
] as const satisfies readonly (keyof OpportunityLimits)[];

/**
 * `GET /companies/me/policy-limits` — one request, both forms.
 *
 * Under `companies/me` rather than a public path because it is scoped to
 * a signed-in company: these are operating limits, not marketing copy.
 */
export interface PolicyLimits {
  media: MediaPolicyLimits;
  opportunity: OpportunityLimits;
}

export const POLICY_LIMITS_KEYS = [
  "media",
  "opportunity",
] as const satisfies readonly (keyof PolicyLimits)[];

/** Settings that must NEVER appear on this contract. */
export const POLICY_LIMITS_FORBIDDEN_FIELDS = [
  "showScheduledPubliclyEnabled",
  "commissionRateBasisPoints",
  "ratePercent",
  "payoutHoldDays",
  "sessionDuration",
] as const;
