import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import type { SalesUnitItem } from "@platform/types";
import type { AdminSalesUnitItem } from "@platform/types";
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

  /**
   * Every sales unit, active or not. ADMIN ONLY.
   *
   * A CLOSED projection: same reason as `listActiveProjected` below —
   * not selecting is stronger than not mapping — applied to the admin
   * read so a column added later cannot appear on a screen by default.
   */
  async listAll(): Promise<AdminSalesUnitItem[]> {
    const rows = await this.prisma.salesUnit.findMany({
      select: {
        id: true,
        nameAr: true,
        nameEn: true,
        sortOrder: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Raw rows. ADMIN ONLY — `listActiveProjected` is what leaves the
   * server on the public route.
   */
  async listActive() {
    return this.prisma.salesUnit.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  /**
   * The active units, as the closed `SalesUnitItem`.
   *
   * A `select` rather than a mapped row: not selecting is stronger than
   * not mapping, since a later refactor that spreads cannot leak a column
   * the query never asked for.
   *
   * Ordering terminates in the primary key. `sortOrder` is not unique —
   * every unit defaults to 0 — and `createdAt` alone can tie, so without
   * `id` two units could swap places between requests and a picker would
   * reorder itself under the reader.
   */
  async listActiveProjected(): Promise<SalesUnitItem[]> {
    return this.prisma.salesUnit.findMany({
      where: { isActive: true },
      select: { id: true, nameAr: true, nameEn: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
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
