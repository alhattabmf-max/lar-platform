import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AdminPoliciesService } from "./admin-policies.service";
import { CreatePolicyDocumentDto, WritePolicyVersionDto } from "./dto/policy.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

function ctxFrom(session: AdminSessionData, req: Request) {
  return {
    actorId: session.adminUserId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

/**
 * Authoring the platform's legal documents.
 *
 * THERE IS NO WITHDRAW ROUTE, and that is the database rather than a
 * decision: a trigger on `policy_versions` raises on any update to a row
 * that is already published, and on any delete of one. Publishing is
 * one-way and permanent. Which version is IN FORCE is answered on the
 * read side — the newest published version of each document.
 *
 * THERE IS NO DELETE ROUTE, and its absence is the point rather than an
 * omission. `policy_acceptances` points at a version id; removing a
 * version would leave a hundred and fifty-eight consent records pointing
 * at nothing. Withdrawing a version from force is `unpublish`, which
 * keeps the text and the date it was in force.
 *
 * THE PUBLIC ROUTES ARE NOT DUPLICATED HERE. `GET /policies/active` and
 * `POST /policies/accept` already exist and already serve the viewer and
 * registration; this controller writes what those two read.
 */
@Controller("admin/policies")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminPoliciesController {
  constructor(private readonly policies: AdminPoliciesService) {}

  @Get()
  list() {
    return this.policies.list();
  }

  /**
   * Whether registration is currently possible.
   *
   * Registration refuses outright when no mandatory published policy
   * exists. This says so on the screen that can cause it, rather than
   * leaving it to be discovered by a company that cannot sign up.
   */
  @Get("registration-readiness")
  readiness() {
    return this.policies.registrationReadiness();
  }

  @Post()
  createDocument(
    @Body() dto: CreatePolicyDocumentDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.policies.createDocument(dto.code, ctxFrom(session, req));
  }

  @Post(":documentId/versions")
  createVersion(
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Body() dto: WritePolicyVersionDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.policies.createVersion(documentId, dto, ctxFrom(session, req));
  }

  /** A DRAFT only. The service refuses a published version. */
  @Patch("versions/:versionId")
  updateVersion(
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @Body() dto: WritePolicyVersionDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.policies.updateVersion(versionId, dto, ctxFrom(session, req));
  }

  @Post("versions/:versionId/publish")
  publish(
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request,
  ) {
    return this.policies.publish(versionId, ctxFrom(session, req));
  }

}
