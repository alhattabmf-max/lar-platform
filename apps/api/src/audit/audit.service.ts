import { Injectable } from "@nestjs/common";
import { type AuditActorType, type Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

export interface AuditLogInput {
  actorType: AuditActorType;
  actorId?: string;
  companyId?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * The single write path for audit_logs. Every sensitive change
 * (money, settings, permissions, integrations, policies — Blueprint
 * §64) goes through this service.
 *
 * `tx` makes the audit entry ATOMIC with the mutation it records. Pass
 * it whenever the caller already owns a transaction: without it the
 * mutation commits first and the audit write is a separate round trip,
 * so a crash in between leaves a successful change with no record of
 * who made it. Omitting it stays valid for callers that have no
 * transaction, which is why the parameter is optional rather than
 * required — every existing caller keeps its current behaviour.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).auditLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId,
        companyId: input.companyId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeData: input.before,
        afterData: input.after,
        reason: input.reason,
        requestId: input.requestId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }
}
