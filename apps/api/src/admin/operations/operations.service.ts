import { Injectable } from "@nestjs/common";
import { AccountType, CompanyVerificationStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { VerificationService } from "../../verification/verification.service";

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

  async listPendingSupplierVerifications() {
    return this.prisma.company.findMany({
      where: {
        accountType: AccountType.SUPPLIER,
        verificationStatus: CompanyVerificationStatus.PENDING_VERIFICATION,
      },
      orderBy: { createdAt: "asc" },
    });
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
