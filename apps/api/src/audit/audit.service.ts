import { Injectable } from "@nestjs/common";
import type { AuditActorType, Prisma } from "@prisma/client";
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
 * §64) goes through this service; nothing writes to audit_logs
 * directly with Prisma elsewhere.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
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
