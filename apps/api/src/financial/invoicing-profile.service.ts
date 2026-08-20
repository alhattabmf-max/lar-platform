import { Injectable } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { requireVerifiedSupplierCompany } from "./require-verified-supplier";
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
    private readonly audit: AuditService
  ) {}

  async get(companyId: string) {
    return this.prisma.supplierInvoicingProfile.findUnique({ where: { companyId } });
  }

  async upsert(dto: UpdateInvoicingProfileDto, ctx: ActorContext) {
    await requireVerifiedSupplierCompany(this.prisma, ctx.companyId);

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

    return profile;
  }
}
