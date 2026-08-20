import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request } from "express";
import { DisputeService } from "./dispute.service";
import { EvidenceUploadService } from "./evidence-upload.service";
import { OpenDisputeDto } from "./dto/open-dispute.dto";
import { AddEvidenceDto } from "./dto/add-evidence.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireTraderGuard } from "../common/security/require-trader.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { getRequestId } from "../common/logger/request-id.util";

function ctxFrom(session: SessionData, req: Request) {
  return {
    userId: session.userId,
    companyId: session.companyId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

@Controller("trader/order-allocations")
@UseGuards(SessionAuthGuard, RequireTraderGuard, CsrfGuard)
export class TraderOrderAllocationDisputeController {
  constructor(private readonly disputes: DisputeService) {}

  @Post(":id/disputes")
  open(
    @Param("id") orderAllocationId: string,
    @Body() dto: OpenDisputeDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key header is required");
    return this.disputes.openDisputeIdempotent(orderAllocationId, dto, ctxFrom(session, req), idempotencyKey);
  }
}

@Controller("trader/disputes")
@UseGuards(SessionAuthGuard, RequireTraderGuard, CsrfGuard)
export class TraderDisputeDetailController {
  constructor(private readonly disputes: DisputeService) {}

  @Get(":id")
  get(@Param("id") id: string, @CurrentSession() session: SessionData) {
    return this.disputes.getForTrader(id, session.companyId);
  }

  @Post(":id/evidence")
  addEvidence(
    @Param("id") id: string,
    @Body() dto: AddEvidenceDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    if (!idempotencyKey) throw new BadRequestException("Idempotency-Key header is required");
    return this.disputes.addEvidenceIdempotent(id, dto.storageObjectKey, ctxFrom(session, req), idempotencyKey);
  }
}

@Controller("trader/evidence-uploads")
@UseGuards(SessionAuthGuard, RequireTraderGuard, CsrfGuard)
export class TraderEvidenceUploadController {
  constructor(private readonly evidenceUploads: EvidenceUploadService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentSession() session: SessionData, @Req() req: Request) {
    if (!file) throw new BadRequestException('A file field named "file" is required');
    return this.evidenceUploads.upload(file.buffer, file.mimetype, ctxFrom(session, req));
  }
}
