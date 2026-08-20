import { Injectable } from "@nestjs/common";
import type { AccountType, PolicyVersion } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuditActorType } from "@prisma/client";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES, type PublicPolicyVersion } from "@platform/types";

interface AcceptContext {
  companyId: string;
  userId: string;
  accountType: AccountType;
  ipAddress?: string;
  userAgent?: string;
  requestId: string;
}

@Injectable()
export class PoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /**
   * Published policy versions, projected onto the public contract.
   *
   * The document `code` is joined in because it is the ONLY label a
   * policy has — PolicyDocument carries a code, not a title — and both
   * consumers (registration and the public viewer) need to say which
   * document a checkbox or a section refers to.
   *
   * `isPublished`, `requiresReacceptance`, `policyDocumentId`,
   * `createdAt` and `updatedAt` are deliberately not forwarded; see
   * PublicPolicyVersion for why.
   */
  async getActivePolicyVersions(): Promise<PublicPolicyVersion[]> {
    const rows = await this.prisma.policyVersion.findMany({
      where: { isPublished: true },
      orderBy: { publishedAt: "desc" },
      include: { policyDocument: { select: { code: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      documentCode: row.policyDocument.code,
      versionLabel: row.versionLabel,
      textAr: row.textAr,
      textEn: row.textEn,
      isMandatory: row.isMandatory,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    }));
  }

  async getMandatoryActivePolicyVersions(): Promise<PolicyVersion[]> {
    return this.prisma.policyVersion.findMany({
      where: { isPublished: true, isMandatory: true },
    });
  }

  /**
   * Validates that every currently-mandatory published policy is
   * included in `acceptedVersionIds` — used during registration.
   *
   * Fail-closed by design: if there are currently ZERO mandatory
   * published policies at all (e.g. only DRAFT placeholder content
   * exists, nothing has been legally reviewed and published yet),
   * registration must be refused outright rather than silently
   * treating "nothing required" as "nothing to check".
   */
  async assertMandatoryPoliciesAccepted(acceptedVersionIds: string[]): Promise<PolicyVersion[]> {
    const mandatory = await this.getMandatoryActivePolicyVersions();

    if (mandatory.length === 0) {
      throw new BusinessException(
        503,
        ERROR_CODES.REGISTRATION_UNAVAILABLE,
        "No mandatory published policies are configured — registration is closed until legal content is published."
      );
    }

    const missing = mandatory.filter((p) => !acceptedVersionIds.includes(p.id));
    if (missing.length > 0) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Missing acceptance for mandatory polic${missing.length === 1 ? "y" : "ies"}: ${missing
          .map((p) => p.id)
          .join(", ")}`
      );
    }
    return mandatory;
  }

  async recordAcceptances(versionIds: string[], ctx: AcceptContext): Promise<void> {
    for (const versionId of versionIds) {
      await this.prisma.policyAcceptance.upsert({
        where: { policyVersionId_userId: { policyVersionId: versionId, userId: ctx.userId } },
        create: {
          policyVersionId: versionId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          accountTypeSnapshot: ctx.accountType,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        update: {},
      });

      await this.audit.log({
        actorType: AuditActorType.USER,
        actorId: ctx.userId,
        companyId: ctx.companyId,
        action: "POLICY_ACCEPTED",
        entityType: "policy_version",
        entityId: versionId,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }
  }
}
