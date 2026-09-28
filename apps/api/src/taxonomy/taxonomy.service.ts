import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import type { AdminTaxonomyNodeItem } from "@platform/types";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import {
  canNestUnder,
  ERROR_CODES,
  subtreeFitsUnder,
  TAXONOMY_MAX_DEPTH,
} from "@platform/types";
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

  /**
   * Every taxonomy node, active or not. ADMIN ONLY.
   *
   * A CLOSED projection rather than a bare `findMany`. These rows hold
   * no secrets, so this is not about concealment — it is about the
   * contract. A screen built against `findMany()` silently gains every
   * column added to the table later, and a column added for an internal
   * reason then has to be un-shipped. Naming the fields makes that
   * addition a deliberate act.
   */
  async listAll(): Promise<AdminTaxonomyNodeItem[]> {
    const rows = await this.prisma.taxonomyNode.findMany({
      select: {
        id: true,
        parentId: true,
        nameAr: true,
        nameEn: true,
        iconUrl: true,
        sortOrder: true,
        isActive: true,
        createdAt: true,
        // WHAT WOULD STOP A DELETE, counted here rather than left
        // for the screen to discover by pressing the button. An
        // operator who can see "4 products" knows why it is refused;
        // one who meets the refusal has been made to guess.
        _count: { select: { children: true, products: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });

    // DEPTH IN ONE PASS over rows already in hand. Asking the
    // database for each node's ancestors would be one query per row
    // to compute something the row set already determines.
    const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
    const depthOf = new Map<string, number>();

    const depth = (id: string): number => {
      const known = depthOf.get(id);
      if (known !== undefined) return known;

      // Walk to the root, remembering the chain, then fill it in
      // from the top. `seen` is a cycle guard: the move endpoint
      // refuses to create one, and this must not hang if a row ever
      // arrived another way.
      const chain: string[] = [];
      const seen = new Set<string>();
      let current: string | null = id;
      while (current !== null && !seen.has(current) && !depthOf.has(current)) {
        seen.add(current);
        chain.push(current);
        current = parentOf.get(current) ?? null;
      }

      let level = current !== null ? (depthOf.get(current) ?? 1) : 0;
      for (const step of chain.reverse()) {
        level += 1;
        depthOf.set(step, level);
      }
      return depthOf.get(id) ?? 1;
    };

    return rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      iconUrl: row.iconUrl,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      depth: depth(row.id),
      childCount: row._count.children,
      productCount: row._count.products,
    }));
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
      // A MAIN CATEGORY AND TWO LEVELS UNDER IT. Refused here as
      // well as on the screen: a caller that skips the screen meets
      // the same limit.
      const parentDepth = await this.depthOf(dto.parentId);
      if (!canNestUnder(parentDepth)) {
        throw new BusinessException(
          400,
          ERROR_CODES.TAXONOMY_TOO_DEEP,
          `A category tree is ${TAXONOMY_MAX_DEPTH} levels deep at most`
        );
      }
    }

    const node = await this.prisma.taxonomyNode.create({
      data: {
        parentId: dto.parentId,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        iconUrl: dto.iconUrl,
        // OMITTED MEANS ZERO, which is the column default and puts a new
        // category at the head of its level until somebody numbers it.
        sortOrder: dto.sortOrder ?? 0,
      },
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
      data: {
        nameAr: dto.nameAr,
        nameEn: dto.nameEn,
        iconUrl: dto.iconUrl,
        // UNDEFINED MEANS "LEAVE IT", which is what every other field
        // here already means: a rename must not silently renumber the
        // strip, and a renumber must not require resending the names.
        sortOrder: dto.sortOrder,
      },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "TAXONOMY_NODE_UPDATED",
      entityType: "taxonomy_node",
      entityId: id,
      before: {
        nameAr: existing.nameAr,
        nameEn: existing.nameEn,
        sortOrder: existing.sortOrder,
      },
      after: {
        nameAr: updated.nameAr,
        nameEn: updated.nameEn,
        sortOrder: updated.sortOrder,
      },
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
    // The node is read here anyway to prove it exists, and it carries
    // the parent it is leaving — so where it CAME FROM costs nothing.
    const before = await this.requireNode(id);

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

    // THE WHOLE SUBTREE HAS TO FIT. A node dragged under a new
    // parent brings its children with it, so a two-level branch
    // cannot go under a level-2 parent even though the node itself
    // would land at 3.
    if (newParentId) {
      const parentDepth = await this.depthOf(newParentId);
      const height = await this.heightOf(id);
      if (!subtreeFitsUnder(parentDepth, height)) {
        throw new BusinessException(
          400,
          ERROR_CODES.TAXONOMY_TOO_DEEP,
          `A category tree is ${TAXONOMY_MAX_DEPTH} levels deep at most`
        );
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
      // A move recorded only as "it is now under X" cannot be undone by
      // anyone reading the log a month later. Where it came from is the
      // half that makes the entry actionable.
      before: { parentId: before.parentId },
      after: { parentId: newParentId ?? null },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  /**
   * Remove a category.
   *
   * REFUSED WHILE IT HAS CHILDREN. `taxonomy_nodes.parent_id` is ON
   * DELETE SET NULL, so the database would happily delete a parent
   * and promote every branch under it to a main category — silently,
   * and with no way back. Whoever is removing it decides where the
   * children go first.
   *
   * REFUSED WHILE PRODUCTS ARE CLASSIFIED UNDER IT. That key is ON
   * DELETE RESTRICT and would refuse anyway; this refuses first, in
   * a sentence, with the count.
   */
  async remove(id: string, ctx: ActorContext) {
    const node = await this.requireNode(id);

    const [children, products] = await this.prisma.$transaction([
      this.prisma.taxonomyNode.count({ where: { parentId: id } }),
      this.prisma.product.count({ where: { taxonomyNodeId: id } }),
    ]);

    if (children > 0) {
      throw new BusinessException(
        409,
        ERROR_CODES.TAXONOMY_HAS_CHILDREN,
        `This category has ${children} sub-categories — move or remove them first`
      );
    }

    if (products > 0) {
      throw new BusinessException(
        409,
        ERROR_CODES.TAXONOMY_HAS_PRODUCTS,
        `${products} products are classified under this category`
      );
    }

    await this.prisma.taxonomyNode.delete({ where: { id } });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "TAXONOMY_NODE_DELETED",
      entityType: "taxonomy_node",
      entityId: id,
      // THE NAME OUTLIVES THE ROW. `audit_logs` has no foreign key
      // here, so this line stays readable after the category it
      // names is gone.
      before: {
        nameAr: node.nameAr,
        nameEn: node.nameEn,
        parentId: node.parentId,
      },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /** How deep a node sits, counted from one. */
  private async depthOf(id: string): Promise<number> {
    let depth = 1;
    let current = await this.prisma.taxonomyNode.findUnique({
      where: { id },
      select: { parentId: true },
    });

    // Bounded by the limit itself plus one, so a cycle that somehow
    // existed could not spin here.
    while (current?.parentId && depth <= TAXONOMY_MAX_DEPTH + 1) {
      depth += 1;
      current = await this.prisma.taxonomyNode.findUnique({
        where: { id: current.parentId },
        select: { parentId: true },
      });
    }
    return depth;
  }

  /** How many levels a node's own subtree spans — 1 for a leaf. */
  private async heightOf(id: string): Promise<number> {
    let height = 1;
    let frontier = [id];

    while (frontier.length > 0 && height <= TAXONOMY_MAX_DEPTH + 1) {
      const children = await this.prisma.taxonomyNode.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true },
      });
      if (children.length === 0) break;
      height += 1;
      frontier = children.map((child) => child.id);
    }
    return height;
  }

  private async requireNode(id: string) {
    const node = await this.prisma.taxonomyNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException("Taxonomy node not found");
    return node;
  }
}
