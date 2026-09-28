import { Injectable } from "@nestjs/common";
import {
  AccountType,
  CompanyVerificationStatus,
  SupplierVerificationRequestStatus,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { SupplierVerificationRequestService } from "../../verification/supplier-verification-request.service";
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
 *
 * DECISIONS GO THROUGH THE REQUEST. They used to call
 * `VerificationService.approve/reject` straight, which moved the
 * company's status with nothing recording WHAT had been reviewed. A
 * supplier now submits its whole record as one request and the
 * decision lands on that request, in one transaction with the
 * company's status — so approving is never separable from the thing
 * approved.
 */
const MAX_PENDING_VERIFICATIONS = 200;

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: SupplierVerificationRequestService,
  ) {}

  /**
   * Suppliers waiting for verification.
   *
   * A CLOSED projection. The previous read was a bare findMany, so it
   * returned whole Company rows and would silently gain every column
   * added to that table later. The queue needs the name, the commercial
   * registration number and how long the company has waited.
   */
  async listPendingSupplierVerifications(): Promise<
    AdminPendingSupplierItem[]
  > {
    const rows = await this.prisma.company.findMany({
      where: {
        accountType: AccountType.SUPPLIER,
        verificationStatus: CompanyVerificationStatus.PENDING_VERIFICATION,
        // ONLY THOSE WHO ASKED. This listed every supplier who had ever
        // registered, because `PENDING_VERIFICATION` is also the state
        // of a company that signed up a minute ago and has submitted
        // nothing — so the queue filled with rows an administrator
        // could not act on. A queue is what somebody sent you.
        verificationRequests: {
          some: { status: SupplierVerificationRequestStatus.UNDER_REVIEW },
        },
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
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      // A DELIBERATE CEILING, NOT A PAGE. The ordering above decides
      // which end it cuts, and it cuts the NEWEST — so the queue never
      // loses the company that has waited longest. Two hundred pending
      // verifications is a staffing problem, not a paging one.
      take: MAX_PENDING_VERIFICATIONS,
    });

    return rows.map((row) => ({
      id: row.id,
      legalName: row.legalName,
      crNumber: row.crNumber,
      verificationStatus: row.verificationStatus,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** The whole record, approved at once — and the only path to VERIFIED. */
  async approveSupplier(
    companyId: string,
    adminUserId: string,
    ctx: ActorContext,
  ): Promise<void> {
    await this.requests.approve(companyId, adminUserId, ctx);
  }

  /**
   * Sent back with what is missing.
   *
   * THE COMPANY DOES NOT MOVE: a return is not a refusal. The record
   * reopens for editing and the supplier may submit again.
   */
  async returnSupplier(
    companyId: string,
    adminUserId: string,
    reason: string,
    ctx: ActorContext,
  ): Promise<void> {
    await this.requests.returnForCompletion(
      companyId,
      adminUserId,
      reason,
      ctx,
    );
  }

  async rejectSupplier(
    companyId: string,
    adminUserId: string,
    reason: string,
    ctx: ActorContext,
  ): Promise<void> {
    await this.requests.reject(companyId, adminUserId, reason, ctx);
  }
}
