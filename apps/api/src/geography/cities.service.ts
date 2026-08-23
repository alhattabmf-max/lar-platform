import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import type { AdminCityItem } from "@platform/types";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { CreateCityDto } from "./dto/create-city.dto";
import type { UpdateCityDto } from "./dto/update-city.dto";

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class CitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /**
   * Every city, active or not, with its region's names. ADMIN ONLY.
   *
   * A CLOSED projection. The previous read used
   * `include: { region: true }`, which nested the whole `Region` row
   * inside every city; the screen needs the region's two names, so
   * those are what it gets.
   */
  async listAll(): Promise<AdminCityItem[]> {
    const rows = await this.prisma.city.findMany({
      select: {
        id: true,
        regionId: true,
        nameAr: true,
        nameEn: true,
        sortOrder: true,
        isActive: true,
        createdAt: true,
        region: { select: { nameAr: true, nameEn: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      regionId: row.regionId,
      regionNameAr: row.region.nameAr,
      regionNameEn: row.region.nameEn,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async listActive() {
    return this.prisma.city.findMany({
      where: { isActive: true },
      include: { region: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async create(dto: CreateCityDto, ctx: ActorContext) {
    await this.requireActiveRegion(dto.regionId);

    const city = await this.prisma.city.create({
      data: { regionId: dto.regionId, nameAr: dto.nameAr, nameEn: dto.nameEn },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "CITY_CREATED",
      entityType: "city",
      entityId: city.id,
      after: { nameAr: city.nameAr, nameEn: city.nameEn, regionId: city.regionId },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return city;
  }

  async update(id: string, dto: UpdateCityDto, ctx: ActorContext) {
    const existing = await this.requireCity(id);
    if (dto.regionId) await this.requireActiveRegion(dto.regionId);

    const updated = await this.prisma.city.update({
      where: { id },
      data: { regionId: dto.regionId, nameAr: dto.nameAr, nameEn: dto.nameEn },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "CITY_UPDATED",
      entityType: "city",
      entityId: id,
      before: { nameAr: existing.nameAr, nameEn: existing.nameEn, regionId: existing.regionId },
      after: { nameAr: updated.nameAr, nameEn: updated.nameEn, regionId: updated.regionId },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async toggle(id: string, ctx: ActorContext) {
    const existing = await this.requireCity(id);

    const updated = await this.prisma.city.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "CITY_TOGGLED",
      entityType: "city",
      entityId: id,
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    // Deliberately does NOT touch company_locations that reference
    // this city — disabling a city never deletes or reassigns
    // existing locations. It only blocks the city from being chosen
    // going forward, and blocks publishing/activating an opportunity
    // whose location resolves to it (enforced in OpportunitiesService,
    // not here).
    return updated;
  }

  private async requireCity(id: string) {
    const city = await this.prisma.city.findUnique({ where: { id } });
    if (!city) throw new NotFoundException("City not found");
    return city;
  }

  private async requireActiveRegion(regionId: string): Promise<void> {
    const region = await this.prisma.region.findUnique({ where: { id: regionId } });
    if (!region || !region.isActive) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid or inactive region");
    }
  }
}
