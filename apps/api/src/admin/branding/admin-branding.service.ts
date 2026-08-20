import { Injectable } from "@nestjs/common";
import { AuditActorType, type Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
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

  async get() {
    return this.prisma.brandingSettings.findUnique({ where: { singletonKey: "default" } });
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
