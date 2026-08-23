import { Injectable } from "@nestjs/common";
import { AuditActorType, type Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import type { AdminBrandingView } from "@platform/types";
import { AuditService } from "../../audit/audit.service";
import type { UpdateBrandingDto } from "./dto/update-branding.dto";

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminBrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /**
   * Site branding, for the admin screen that edits it.
   *
   * A CLOSED projection. Two fields are deliberately absent:
   *
   *   `updatedBy` — an admin user id. Who last changed branding is an
   *   audit-log question, and mirroring it here creates a second record
   *   of "who did what" that can drift from the first.
   *
   *   `headerFooterConfig` — a free-form JSON blob with no validated
   *   shape. Rendering unvalidated JSON into a page is precisely the
   *   injection surface the settings-backed content controls exist to
   *   close; header navigation is configured through `HEADER_NAV`,
   *   which holds taxonomy ids and nothing else.
   *
   * Returns null before the singleton row has been created — a real
   * state on a fresh installation, which the screen reports rather than
   * papering over with empty strings.
   */
  async get(): Promise<AdminBrandingView | null> {
    const row = await this.prisma.brandingSettings.findUnique({
      where: { singletonKey: "default" },
      select: {
        nameAr: true,
        nameEn: true,
        shortDescriptionAr: true,
        shortDescriptionEn: true,
        logoMainUrl: true,
        logoSmallUrl: true,
        faviconUrl: true,
        invoiceLogoUrl: true,
        emailLogoUrl: true,
        updatedAt: true,
      },
    });
    if (!row) return null;

    return {
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      shortDescriptionAr: row.shortDescriptionAr,
      shortDescriptionEn: row.shortDescriptionEn,
      logoMainUrl: row.logoMainUrl,
      logoSmallUrl: row.logoSmallUrl,
      faviconUrl: row.faviconUrl,
      invoiceLogoUrl: row.invoiceLogoUrl,
      emailLogoUrl: row.emailLogoUrl,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async update(dto: UpdateBrandingDto, ctx: ActorContext) {
    const before = await this.get();

    const updated = await this.prisma.brandingSettings.upsert({
      where: { singletonKey: "default" },
      create: { singletonKey: "default", ...dto, updatedBy: ctx.actorId },
      update: { ...dto, updatedBy: ctx.actorId },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "BRANDING_UPDATED",
      entityType: "branding_settings",
      entityId: updated.id,
      before: before ? (before as unknown as Prisma.InputJsonValue) : undefined,
      after: updated as unknown as Prisma.InputJsonValue,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }
}
