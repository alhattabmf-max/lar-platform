import { Injectable } from "@nestjs/common";
import { AccountType, CompanyVerificationStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { VerificationService } from "../../verification/verification.service";
import type { AdminPendingSupplierItem } from "@platform/types";

interface ActorContext {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * No persistent "exception" table here on purpose (per explicit
 * instruction): this service just queries the real, already-existing
 * source of truth (companies.verification_status) and delegates
 * transitions to the Phase 2 VerificationService, which already does
 * the state-machine validation and audit logging. A generic,
 * DB-backed Operations exception model is introduced only once a
 * second real exception workflow needs persistence beyond "current
 * state of some existing table."
 */
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verification: VerificationService
  ) {}

  /**
   * Suppliers waiting for verification.
   *
   * A CLOSED projection. The previous read was a bare findMany, so it
   * returned whole Company rows and would silently gain every column
   * added to that table later. The queue needs the name, the commercial
   * registration number and how long the company has waited.
   */
  async listPendingSupplierVerifications(): Promise<AdminPendingSupplierItem[]> {
    const rows = await this.prisma.company.findMany({
      where: {
        accountType: AccountType.SUPPLIER,
        verificationStatus: CompanyVerificationStatus.PENDING_VERIFICATION,
      },
      select: {
        id: true,
        legalName: true,
        crNumber: true,
        verificationStatus: true,
        createdAt: true,
      },
      // Oldest first, terminating in id: the company that has waited
      // longest is the one to act on, and two registered in the same
      // millisecond must not swap places between reads.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      legalName: row.legalName,
      crNumber: row.crNumber,
      verificationStatus: row.verificationStatus,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async approveSupplier(companyId: string, adminUserId: string, ctx: ActorContext): Promise<void> {
    await this.verification.approve(companyId, adminUserId, ctx);
  }

  async rejectSupplier(
    companyId: string,
    adminUserId: string,
    reason: string,
    ctx: ActorContext
  ): Promise<void> {
    await this.verification.reject(companyId, adminUserId, reason, ctx);
  }
}
