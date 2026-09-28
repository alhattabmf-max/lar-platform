import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import type { AdminRegionItem, RegionItem } from "@platform/types";
import { AuditService } from "../audit/audit.service";
import { SENTINEL_REGION_ID } from "./sentinel.constants";
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

  /**
   * Every region, active or not. ADMIN ONLY.
   *
   * A CLOSED projection rather than a bare `findMany`, so a column
   * added to this table later reaches a screen only when someone puts
   * it here on purpose.
   */
  async listAll(): Promise<AdminRegionItem[]> {
    const rows = await this.prisma.region.findMany({
      // Hidden for the same reason its city is — see cities.service.ts.
      // Kept in the database, absent from the screen.
      where: { id: { not: SENTINEL_REGION_ID } },
      select: { id: true, nameAr: true, nameEn: true, isActive: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * The regions a visitor and a branch form may choose from.
   *
   * A CLOSED PROJECTION — three fields, matching `RegionItem`. It used
   * to return the raw row, which put `isActive`, `createdAt` and
   * `updatedAt` on a public, unauthenticated response: every one of
   * them is an administrative fact about reference data, and none of
   * them is anything a picker reads.
   *
   * THE SENTINEL IS EXCLUDED BY ID, not only by its inactive flag. It
   * is the «غير محدد» placeholder that exists because
   * `company_locations.city_id` was once NOT NULL, and it must never
   * appear in a list somebody chooses from — switching it on by
   * accident would otherwise put it in every region picker on the
   * platform.
   */
  async listActive(): Promise<RegionItem[]> {
    const rows = await this.prisma.region.findMany({
      where: { isActive: true, id: { not: SENTINEL_REGION_ID } },
      select: { id: true, nameAr: true, nameEn: true },
      orderBy: [{ nameAr: "asc" }, { id: "asc" }],
    });
    return rows;
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
