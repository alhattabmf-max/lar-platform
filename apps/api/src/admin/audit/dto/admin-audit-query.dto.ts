import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { AUDIT_ACTOR_TYPES } from "@platform/types";

/**
 * Filters for the audit trail.
 *
 * `pageSize` clamps at 100 — the plan is explicit that a larger request
 * is clamped rather than honoured. An audit table is the one place where
 * "give me everything" is both tempting and expensive.
 *
 * `entityId` and `requestId` are the two filters that make the trail
 * usable in an investigation: "what happened to this order" and "what
 * else happened in this request". Both are exact matches.
 */
export class AdminAuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsIn(AUDIT_ACTOR_TYPES)
  actorType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  entityType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}
