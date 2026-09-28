import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ProductsService } from "./products.service";
import type { Paginated, ProductDetail, ProductSummary } from "@platform/types";
import { ListMyProductsQueryDto } from "./dto/list-my-products.dto";
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

  /**
   * One page of the supplier's own catalogue.
   *
   * PAGED AND SEARCHABLE, where it used to answer with the whole list
   * under a five-hundred ceiling. The query decides the page, the
   * search term and which half of the catalogue is wanted; the service
   * clamps the page size.
   */
  @Get()
  listMine(
    @CurrentSession() session: SessionData,
    @Query() query: ListMyProductsQueryDto
  ): Promise<Paginated<ProductSummary>> {
    return this.products.listMine(session.companyId, query);
  }

  /**
   * One product, as the closed `ProductDetail`.
   *
   * The list existed; the detail did not, so a supplier could see a product
   * was rejected and had no way to open it and read why.
   */
  @Get(":id")
  getOne(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData
  ): Promise<ProductDetail> {
    return this.products.getOwned(id, session.companyId);
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

  /**
   * «المنتج يُحذف من صفحة المورّد ومن صفحة الإدارة.»
   *
   * The console has had `DELETE admin/products/:id` since the owner
   * asked for it; the supplier had only archive, which is a one-way
   * door. Both now run the same rule and the same routine — see
   * `common/removal.ts`.
   */
  @Delete(":id")
  remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData,
    @Req() req: Request
  ) {
    return this.products.remove(id, ctxFrom(session, req));
  }
}
