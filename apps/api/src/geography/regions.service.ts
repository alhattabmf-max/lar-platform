import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { CreateRegionDto } from "./dto/create-region.dto";
import type { UpdateRegionDto } from "./dto/update-region.dto";

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class RegionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async listAll() {
    return this.prisma.region.findMany({ orderBy: [{ createdAt: "asc" }] });
  }

  async listActive() {
    return this.prisma.region.findMany({
      where: { isActive: true },
      orderBy: [{ createdAt: "asc" }],
    });
  }

  async create(dto: CreateRegionDto, ctx: ActorContext) {
    const region = await this.prisma.region.create({
      data: { nameAr: dto.nameAr, nameEn: dto.nameEn },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "REGION_CREATED",
      entityType: "region",
      entityId: region.id,
      after: { nameAr: region.nameAr, nameEn: region.nameEn },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return region;
  }

  async update(id: string, dto: UpdateRegionDto, ctx: ActorContext) {
    const existing = await this.requireRegion(id);

    const updated = await this.prisma.region.update({
      where: { id },
      data: { nameAr: dto.nameAr, nameEn: dto.nameEn },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "REGION_UPDATED",
      entityType: "region",
      entityId: id,
      before: { nameAr: existing.nameAr, nameEn: existing.nameEn },
      after: { nameAr: updated.nameAr, nameEn: updated.nameEn },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async toggle(id: string, ctx: ActorContext) {
    const existing = await this.requireRegion(id);

    const updated = await this.prisma.region.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "REGION_TOGGLED",
      entityType: "region",
      entityId: id,
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  private async requireRegion(id: string) {
    const region = await this.prisma.region.findUnique({ where: { id } });
    if (!region) throw new NotFoundException("Region not found");
    return region;
  }
}
