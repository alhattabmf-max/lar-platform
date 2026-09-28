import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import {
  ERROR_CODES,
  POLICY_CODE_PATTERN,
  POLICY_TEXT_MAX,
  POLICY_TEXT_MIN,
  POLICY_VERSION_LABEL_MAX,
  type AdminPolicyDocument,
  type AdminPolicyVersion,
} from "@platform/types";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { BusinessException } from "../../common/errors/business-exception";

interface AdminActorContext {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

interface VersionInput {
  versionLabel: string;
  textAr: string;
  textEn: string;
  isMandatory: boolean;
  requiresReacceptance: boolean;
}

/**
 * Authoring the platform's legal documents.
 *
 * THE THREE RULES THIS SERVICE EXISTS TO KEEP:
 *
 *   A PUBLISHED VERSION IS NEVER EDITED. `policy_acceptances` points at
 *   a version id, and a hundred and fifty-eight people have accepted the
 *   two rows currently live. Editing the text under them would rewrite
 *   what they agreed to and leave the record saying they agreed to
 *   something they never read. Every edit to published wording is a new
 *   version.
 *
 *   A VERSION IS NEVER DELETED. Same reason, from the other side: the
 *   acceptance row would be pointing at nothing. There is no delete
 *   endpoint here at all — not a guarded one, not one behind a flag.
 *
 *   PUBLISHING IS ONE-WAY, AND THE DATABASE SAYS SO. A trigger on
 *   `policy_versions` raises on ANY update to a row already published —
 *   «cannot modify a published policy version» — and on any delete of
 *   one. There is therefore no withdraw, no unpublish and no archive:
 *   they are not omitted, they are impossible. Which version is IN
 *   FORCE is answered on the read side instead — the newest published
 *   version of each document.
 *
 * NO HTML. `textAr` and `textEn` are text, rendered as text by the
 * public viewer, and nothing here parses or sanitises markup because
 * nothing is asked to interpret any.
 */
@Injectable()
export class AdminPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every document, with every version ever written for it. */
  async list(): Promise<AdminPolicyDocument[]> {
    const documents = await this.prisma.policyDocument.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        createdAt: true,
        versions: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            versionLabel: true,
            textAr: true,
            textEn: true,
            isPublished: true,
            isMandatory: true,
            requiresReacceptance: true,
            publishedAt: true,
            createdAt: true,
            updatedAt: true,
            // The count, not the rows: who accepted is a different
            // question with a different audience, and loading a hundred
            // and fifty acceptance rows to render one number is a query
            // that gets slower with every registration.
            _count: { select: { acceptances: true } },
          },
        },
      },
    });

    return documents.map((document) => ({
      id: document.id,
      code: document.code,
      createdAt: document.createdAt.toISOString(),
      versions: document.versions.map((version) => this.project(version)),
    }));
  }

  async createDocument(code: string, ctx: AdminActorContext) {
    const normalized = code.trim().toLowerCase();
    if (!POLICY_CODE_PATTERN.test(normalized)) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "A policy code is lower-case letters, digits and underscores, 3 to 49 characters, starting with a letter",
      );
    }

    const existing = await this.prisma.policyDocument.findUnique({
      where: { code: normalized },
    });
    if (existing) {
      throw new BusinessException(
        409,
        ERROR_CODES.CONFLICT,
        "A policy document with this code already exists",
      );
    }

    const document = await this.prisma.policyDocument.create({
      data: { code: normalized },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "POLICY_DOCUMENT_CREATED",
      entityType: "policy_document",
      entityId: document.id,
      after: { code: normalized },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return document;
  }

  /** A new DRAFT version of an existing document. */
  async createVersion(
    documentId: string,
    input: VersionInput,
    ctx: AdminActorContext,
  ) {
    const document = await this.prisma.policyDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException("Policy document not found");

    const clean = this.validate(input);

    const version = await this.prisma.policyVersion.create({
      data: {
        policyDocumentId: documentId,
        versionLabel: clean.versionLabel,
        textAr: clean.textAr,
        textEn: clean.textEn,
        isMandatory: clean.isMandatory,
        requiresReacceptance: clean.requiresReacceptance,
        // A DRAFT, always. Publishing is a separate, deliberate act with
        // its own audit entry — writing text and putting it in force are
        // not the same decision and must not be the same button.
        isPublished: false,
      },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "POLICY_VERSION_DRAFTED",
      entityType: "policy_version",
      entityId: version.id,
      after: {
        documentCode: document.code,
        versionLabel: clean.versionLabel,
        isMandatory: clean.isMandatory,
      },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return version;
  }

  /** Edits a DRAFT. Refuses a published version outright. */
  async updateVersion(
    versionId: string,
    input: VersionInput,
    ctx: AdminActorContext,
  ) {
    const existing = await this.prisma.policyVersion.findUnique({
      where: { id: versionId },
      include: { _count: { select: { acceptances: true } } },
    });
    if (!existing) throw new NotFoundException("Policy version not found");

    if (existing.isPublished) {
      throw new BusinessException(
        409,
        ERROR_CODES.CONFLICT,
        "A published policy version cannot be edited — publish a new version instead",
      );
    }
    // Belt and braces. A draft should have no acceptances, and if one
    // ever did, its text is what somebody agreed to.
    if (existing._count.acceptances > 0) {
      throw new BusinessException(
        409,
        ERROR_CODES.CONFLICT,
        "This version has already been accepted and cannot be edited",
      );
    }

    const clean = this.validate(input);

    const updated = await this.prisma.policyVersion.update({
      where: { id: versionId },
      data: {
        versionLabel: clean.versionLabel,
        textAr: clean.textAr,
        textEn: clean.textEn,
        isMandatory: clean.isMandatory,
        requiresReacceptance: clean.requiresReacceptance,
      },
    });

    await this.audit.log({
      actorType: AuditActorType.ADMIN,
      actorId: ctx.actorId,
      action: "POLICY_VERSION_UPDATED",
      entityType: "policy_version",
      entityId: versionId,
      before: {
        versionLabel: existing.versionLabel,
        isMandatory: existing.isMandatory,
        requiresReacceptance: existing.requiresReacceptance,
      },
      after: {
        versionLabel: clean.versionLabel,
        isMandatory: clean.isMandatory,
        requiresReacceptance: clean.requiresReacceptance,
      },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  /**
   * Puts a version in force, and withdraws whatever was in force before.
   *
   * ONE TRANSACTION. Between "unpublish the old" and "publish the new"
   * there must be no instant where the document has no live version:
   * registration refuses outright when no mandatory published policy
   * exists, so a gap of milliseconds is a gap in which nobody can
   * register.
   */
  async publish(versionId: string, ctx: AdminActorContext) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.policyVersion.findUnique({
        where: { id: versionId },
        include: { policyDocument: { select: { id: true, code: true } } },
      });
      if (!version) throw new NotFoundException("Policy version not found");

      if (version.isPublished) {
        throw new BusinessException(
          409,
          ERROR_CODES.CONFLICT,
          "This policy version is already published",
        );
      }

      // NOTHING IS WITHDRAWN HERE, and that is the database talking
      // rather than a choice. A trigger on `policy_versions` raises on
      // ANY update to a row whose `is_published` is already true —
      // «cannot modify a published policy version» — and on any delete
      // of one. A published version is permanent and immutable.
      //
      // So publishing is ONE-WAY, and "which version is in force" is
      // answered on the READ side: the newest published version of each
      // document. See `PoliciesService.getActivePolicyVersions`.
      const previouslyPublished = await tx.policyVersion.count({
        where: {
          policyDocumentId: version.policyDocument.id,
          isPublished: true,
        },
      });

      const published = await tx.policyVersion.update({
        where: { id: versionId },
        data: { isPublished: true, publishedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "POLICY_VERSION_PUBLISHED",
          entityType: "policy_version",
          entityId: versionId,
          afterData: {
            documentCode: version.policyDocument.code,
            versionLabel: version.versionLabel,
            isMandatory: version.isMandatory,
            requiresReacceptance: version.requiresReacceptance,
            // How many published versions this document already had.
            // The newest is what the public viewer and registration
            // read; the older ones stay, permanently, because the
            // acceptances recorded against them do too.
            previouslyPublishedVersions: previouslyPublished,
          },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return published;
    });
  }

  /**
   * Whether registration is currently possible.
   *
   * Not a new rule — `assertMandatoryPoliciesAccepted` has always
   * refused when the count is zero. This reports the same fact BEFORE
   * somebody discovers it by failing to register.
   */
  async registrationReadiness() {
    const mandatoryPublished = await this.prisma.policyVersion.count({
      where: { isPublished: true, isMandatory: true },
    });
    return { mandatoryPublished, registrationOpen: mandatoryPublished > 0 };
  }

  private validate(input: VersionInput): VersionInput {
    const versionLabel = input.versionLabel?.trim() ?? "";
    const textAr = input.textAr?.trim() ?? "";
    const textEn = input.textEn?.trim() ?? "";

    if (
      versionLabel.length === 0 ||
      versionLabel.length > POLICY_VERSION_LABEL_MAX
    ) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `versionLabel must be 1 to ${POLICY_VERSION_LABEL_MAX} characters`,
      );
    }
    // BOTH LANGUAGES, ALWAYS. The public viewer picks by the reader's
    // locale with no fallback, so a version published with one side
    // empty is a policy that does not exist for half the audience.
    for (const [name, value] of [
      ["textAr", textAr],
      ["textEn", textEn],
    ] as const) {
      if (value.length < POLICY_TEXT_MIN || value.length > POLICY_TEXT_MAX) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `${name} must be ${POLICY_TEXT_MIN} to ${POLICY_TEXT_MAX} characters`,
        );
      }
    }

    return {
      versionLabel,
      textAr,
      textEn,
      isMandatory: input.isMandatory,
      requiresReacceptance: input.requiresReacceptance,
    };
  }

  private project(row: {
    id: string;
    versionLabel: string;
    textAr: string;
    textEn: string;
    isPublished: boolean;
    isMandatory: boolean;
    requiresReacceptance: boolean;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    _count: { acceptances: number };
  }): AdminPolicyVersion {
    return {
      id: row.id,
      versionLabel: row.versionLabel,
      textAr: row.textAr,
      textEn: row.textEn,
      isPublished: row.isPublished,
      isMandatory: row.isMandatory,
      requiresReacceptance: row.requiresReacceptance,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      acceptanceCount: row._count.acceptances,
    };
  }
}
