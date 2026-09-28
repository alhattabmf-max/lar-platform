import { Injectable } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { requireSupplierCompany } from "./require-verified-supplier";
import { SupplierVerificationRequestService } from "../verification/supplier-verification-request.service";
import type { UpdateInvoicingProfileDto } from "./dto/update-invoicing-profile.dto";

interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class InvoicingProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly verificationRequests: SupplierVerificationRequestService
  ) {}

  async get(companyId: string) {
    return this.prisma.supplierInvoicingProfile.findUnique({ where: { companyId } });
  }

  async upsert(dto: UpdateInvoicingProfileDto, ctx: ActorContext) {
    // A SUPPLIER ACCOUNT, APPROVED OR NOT — see the note in
    // `require-verified-supplier.ts`. Who a commission document is
    // addressed to is reviewed with the rest of the record.
    await requireSupplierCompany(this.prisma, ctx.companyId);

    const before = await this.get(ctx.companyId);

    const profile = await this.prisma.supplierInvoicingProfile.upsert({
      where: { companyId: ctx.companyId },
      create: { companyId: ctx.companyId, invoicingLegalName: dto.invoicingLegalName },
      update: { invoicingLegalName: dto.invoicingLegalName },
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "INVOICING_PROFILE_UPDATED",
      entityType: "supplier_invoicing_profile",
      entityId: profile.id,
      before: before ? { invoicingLegalName: before.invoicingLegalName } : undefined,
      after: { invoicingLegalName: profile.invoicingLegalName },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    // WHO THE INVOICE IS ADDRESSED TO. Same reason as the tax
    // number: it is printed on a document, not a note in a screen.
    await this.verificationRequests.markChangedSinceApproval(
      ctx.companyId,
      "INVOICING_NAME",
      ctx,
    );

    return profile;
  }
}
