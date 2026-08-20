import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ProductsService } from "./products.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
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

@Controller("companies/me/products")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  listMine(@CurrentSession() session: SessionData) {
    return this.products.listMine(session.companyId);
  }

  @Post()
  create(
    @Body() dto: CreateProductDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.products.create(dto, ctxFrom(session, req));
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.products.update(id, dto, ctxFrom(session, req));
  }

  @Post(":id/submit")
  submit(
    @Param("id") id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.products.submit(id, ctxFrom(session, req));
  }

  @Post(":id/archive")
  archive(
    @Param("id") id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.products.archive(id, ctxFrom(session, req));
  }
}
