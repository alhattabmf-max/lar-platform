import { Injectable, NotFoundException } from "@nestjs/common";
import {
  MAX_TRADER_PAGE_SIZE,
  type Paginated,
  type SupplierReplacementDetail,
  type SupplierReplacementSummary,
} from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import {
  SUPPLIER_REPLACEMENT_DETAIL_SELECT,
  SUPPLIER_REPLACEMENT_SUMMARY_SELECT,
  supplierReplacementWhere,
  toSupplierReplacementDetail,
  toSupplierReplacementSummary,
} from "./supplier-replacement.view";

/**
 * Reads for the supplier's replacement obligations.
 *
 * Separate from `ReplacementObligationService`, which owns the three state
 * transitions. That service is a write path with conditional UPDATEs and its
 * own transaction handling; mixing paginated reads into it would put two very
 * different concerns behind one class, and the reads need a projection the
 * writes have no use for.
 */

interface SupplierScope {
  companyId: string;
}

@Injectable()
export class SupplierReplacementReadsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    scope: SupplierScope,
    query: { page?: number; pageSize?: number }
  ): Promise<Paginated<SupplierReplacementSummary>> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(MAX_TRADER_PAGE_SIZE, Math.max(1, query.pageSize ?? 20));

    const where = supplierReplacementWhere(scope.companyId);

    const [rows, total] = await Promise.all([
      this.prisma.replacementObligation.findMany({
        where,
        select: SUPPLIER_REPLACEMENT_SUMMARY_SELECT,
        // Terminating in `id`: `createdAt` is not unique, and a tie spanning
        // a page boundary can serve one row twice and another never.
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.replacementObligation.count({ where }),
    ]);

    return { items: rows.map(toSupplierReplacementSummary), page, pageSize, total };
  }

  async get(scope: SupplierScope, id: string): Promise<SupplierReplacementDetail> {
    const row = await this.prisma.replacementObligation.findFirst({
      // Ownership in the query, so an unknown id and another supplier's
      // obligation are indistinguishable.
      where: { id, ...supplierReplacementWhere(scope.companyId) },
      select: SUPPLIER_REPLACEMENT_DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException("Replacement obligation not found");

    return toSupplierReplacementDetail(row);
  }
}
