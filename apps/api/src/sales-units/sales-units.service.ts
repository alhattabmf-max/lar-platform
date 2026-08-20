import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { CreateSalesUnitDto } from "./dto/create-sales-unit.dto";
import type { UpdateSalesUnitDto } from "./dto/update-sales-unit.dto";

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class SalesUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async listAll() {
    return this.prisma.salesUnit.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  }

  async listActive() {
    return this.prisma.salesUnit.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async create(dto: CreateSalesUnitDto, ctx: ActorContext) {
    const unit = await this.prisma.salesUnit.create({
      data: { nameAr: dto.nameAr, nameEn: dto.nameEn },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "SALES_UNIT_CREATED",
      entityType: "sales_unit",
      entityId: unit.id,
      after: { nameAr: unit.nameAr, nameEn: unit.nameEn },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return unit;
  }

  async update(id: string, dto: UpdateSalesUnitDto, ctx: ActorContext) {
    const existing = await this.requireUnit(id);

    const updated = await this.prisma.salesUnit.update({
      where: { id },
      data: { nameAr: dto.nameAr, nameEn: dto.nameEn },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "SALES_UNIT_UPDATED",
      entityType: "sales_unit",
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
    const existing = await this.requireUnit(id);

    const updated = await this.prisma.salesUnit.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "SALES_UNIT_TOGGLED",
      entityType: "sales_unit",
      entityId: id,
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  private async requireUnit(id: string) {
    const unit = await this.prisma.salesUnit.findUnique({ where: { id } });
    if (!unit) throw new NotFoundException("Sales unit not found");
    return unit;
  }
}
