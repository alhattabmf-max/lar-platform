import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { CompaniesService } from "./companies.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";
import { CreateLocationDto } from "./dto/create-location.dto";
import { UpdateLocationDto } from "./dto/update-location.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { CsrfGuard } from "../common/security/csrf.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";
import { getRequestId } from "../common/logger/request-id.util";

@Controller("companies/me")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  private ctx(session: SessionData, req: Request) {
    return {
      userId: session.userId,
      companyId: session.companyId,
      requestId: getRequestId(req),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    };
  }

  @Get("contacts")
  listContacts(@CurrentSession() session: SessionData) {
    return this.companies.listContacts(session.companyId);
  }

  @Post("contacts")
  createContact(
    @Body() dto: CreateContactDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.companies.createContact(dto, this.ctx(session, req));
  }

  @Patch("contacts/:id")
  updateContact(
    @Param("id") id: string,
    @Body() dto: UpdateContactDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.companies.updateContact(id, dto, this.ctx(session, req));
  }

  @Delete("contacts/:id")
  removeContact(
    @Param("id") id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.companies.removeContact(id, this.ctx(session, req));
  }

  @Get("locations")
  listLocations(@CurrentSession() session: SessionData) {
    return this.companies.listLocations(session.companyId);
  }

  @Post("locations")
  createLocation(
    @Body() dto: CreateLocationDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.companies.createLocation(dto, this.ctx(session, req));
  }

  @Patch("locations/:id")
  updateLocation(
    @Param("id") id: string,
    @Body() dto: UpdateLocationDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.companies.updateLocation(id, dto, this.ctx(session, req));
  }

  @Post("locations/:id/set-default")
  setDefaultLocation(
    @Param("id") id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.companies.setDefaultLocation(id, this.ctx(session, req));
  }

  @Delete("locations/:id")
  removeLocation(
    @Param("id") id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.companies.removeLocation(id, this.ctx(session, req));
  }
}
