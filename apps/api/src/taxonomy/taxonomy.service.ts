import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { CreateTaxonomyNodeDto } from "./dto/create-taxonomy-node.dto";
import type { UpdateTaxonomyNodeDto } from "./dto/update-taxonomy-node.dto";

interface ActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class TaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  async listAll() {
    return this.prisma.taxonomyNode.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  }

  async listActive() {
    return this.prisma.taxonomyNode.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }

  async create(dto: CreateTaxonomyNodeDto, ctx: ActorContext) {
    if (dto.parentId) {
      await this.requireNode(dto.parentId);
    }

    const node = await this.prisma.taxonomyNode.create({
      data: { parentId: dto.parentId, nameAr: dto.nameAr, nameEn: dto.nameEn, iconUrl: dto.iconUrl },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "TAXONOMY_NODE_CREATED",
      entityType: "taxonomy_node",
      entityId: node.id,
      after: { nameAr: node.nameAr, nameEn: node.nameEn, parentId: node.parentId },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return node;
  }

  async update(id: string, dto: UpdateTaxonomyNodeDto, ctx: ActorContext) {
    const existing = await this.requireNode(id);

    const updated = await this.prisma.taxonomyNode.update({
      where: { id },
      data: { nameAr: dto.nameAr, nameEn: dto.nameEn, iconUrl: dto.iconUrl },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "TAXONOMY_NODE_UPDATED",
      entityType: "taxonomy_node",
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
    const existing = await this.requireNode(id);

    const updated = await this.prisma.taxonomyNode.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "TAXONOMY_NODE_TOGGLED",
      entityType: "taxonomy_node",
      entityId: id,
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  /**
   * Moves a node under a new parent (or to root if newParentId is
   * undefined). Explicitly rejects: a node becoming its own parent,
   * and a node being moved under any of its own descendants — walking
   * the ancestor chain from newParentId up to the root and checking
   * that `id` never appears in it.
   */
  async move(id: string, newParentId: string | undefined, ctx: ActorContext) {
    await this.requireNode(id);

    if (newParentId === id) {
      throw new BusinessException(
        400,
        ERROR_CODES.TAXONOMY_CYCLE_DETECTED,
        "A taxonomy node cannot be its own parent"
      );
    }

    if (newParentId) {
      await this.requireNode(newParentId);
      let current = await this.prisma.taxonomyNode.findUnique({ where: { id: newParentId } });
      while (current) {
        if (current.id === id) {
          throw new BusinessException(
            400,
            ERROR_CODES.TAXONOMY_CYCLE_DETECTED,
            "Cannot move a node under one of its own descendants"
          );
        }
        if (!current.parentId) break;
        current = await this.prisma.taxonomyNode.findUnique({ where: { id: current.parentId } });
      }
    }

    const updated = await this.prisma.taxonomyNode.update({
      where: { id },
      data: { parentId: newParentId ?? null },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "TAXONOMY_NODE_MOVED",
      entityType: "taxonomy_node",
      entityId: id,
      after: { newParentId: newParentId ?? null },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  private async requireNode(id: string) {
    const node = await this.prisma.taxonomyNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException("Taxonomy node not found");
    return node;
  }
}
