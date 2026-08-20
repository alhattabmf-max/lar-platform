import { Injectable } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { SettingsService } from "./settings.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

export interface MediaPolicyConfig {
  maxSizeBytes: number;
  maxImagesPerProduct: number;
  allowedTypes: string[];
  maxPixels: number;
}

const KEY = "product_media_policy";

// The full set the code can actually decode/process — an admin can
// narrow this list but never widen it beyond what sharp supports here.
const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Infrastructure hard ceiling — the single source of truth for the
 * maximum an admin-configured maxSizeBytes can ever be (see BOUNDS
 * below, which uses this same constant) AND the literal Multer
 * `limits.fileSize` value applied at the HTTP layer
 * (product-media.controller.ts). Because both read from this one
 * constant, the HTTP-layer hard limit can never be lower than what
 * MediaPolicyService would otherwise accept, and an admin can never
 * configure a policy value the transport layer would silently reject
 * before it even reaches validation.
 */
export const MEDIA_SIZE_HARD_CEILING_BYTES = 20 * 1024 * 1024; // 20MB

const DEFAULT_POLICY: MediaPolicyConfig = {
  maxSizeBytes: 5 * 1024 * 1024, // 5MB
  maxImagesPerProduct: 10,
  allowedTypes: [...SUPPORTED_TYPES],
  maxPixels: 40_000_000, // 40 megapixels
};

const BOUNDS = {
  maxSizeBytes: { min: 100 * 1024, max: MEDIA_SIZE_HARD_CEILING_BYTES },
  maxImagesPerProduct: { min: 1, max: 30 },
  maxPixels: { min: 1_000_000, max: 100_000_000 },
};

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class MediaPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService
  ) {}

  async getPolicy(): Promise<MediaPolicyConfig> {
    return this.settings.getJsonSafe(KEY, (v) => this.validate(v), DEFAULT_POLICY);
  }

  async setPolicy(value: MediaPolicyConfig, ctx: ActorContext): Promise<void> {
    if (this.validate(value) === null) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Media policy value is outside the allowed bounds"
      );
    }

    const before = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });

    await this.prisma.systemSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: value as never, updatedBy: ctx.actorId },
      update: { value: value as never, updatedBy: ctx.actorId },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "MEDIA_POLICY_UPDATED",
      entityType: "system_setting",
      entityId: KEY,
      before: before ? { value: before.value } : undefined,
      after: { value: value as never },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private validate(value: unknown): MediaPolicyConfig | null {
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;

    if (
      typeof v.maxSizeBytes !== "number" ||
      !Number.isInteger(v.maxSizeBytes) ||
      v.maxSizeBytes < BOUNDS.maxSizeBytes.min ||
      v.maxSizeBytes > BOUNDS.maxSizeBytes.max
    ) {
      return null;
    }
    if (
      typeof v.maxImagesPerProduct !== "number" ||
      !Number.isInteger(v.maxImagesPerProduct) ||
      v.maxImagesPerProduct < BOUNDS.maxImagesPerProduct.min ||
      v.maxImagesPerProduct > BOUNDS.maxImagesPerProduct.max
    ) {
      return null;
    }
    if (
      typeof v.maxPixels !== "number" ||
      !Number.isInteger(v.maxPixels) ||
      v.maxPixels < BOUNDS.maxPixels.min ||
      v.maxPixels > BOUNDS.maxPixels.max
    ) {
      return null;
    }
    if (
      !Array.isArray(v.allowedTypes) ||
      v.allowedTypes.length === 0 ||
      !v.allowedTypes.every((t) => typeof t === "string" && (SUPPORTED_TYPES as readonly string[]).includes(t))
    ) {
      return null;
    }

    return {
      maxSizeBytes: v.maxSizeBytes,
      maxImagesPerProduct: v.maxImagesPerProduct,
      allowedTypes: v.allowedTypes as string[],
      maxPixels: v.maxPixels,
    };
  }
}
