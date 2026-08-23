import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import type {
  DocumentSummary,
  Paginated,
  SupplierOrderDetail,
  SupplierOrderSummary,
} from "@platform/types";
import { SupplierOrdersService } from "./supplier-orders.service";
import { TraderPageQueryDto } from "./dto/trader-page-query.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireSupplierGuard } from "../common/security/require-supplier.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";

/**
 * The supplier's orders and their documents.
 *
 * Read-only, so no `CsrfGuard` — the underlying provider exempts safe methods
 * and every route here is a GET.
 *
 * The three routes replace `SupplierOrdersController`, which returned raw
 * Prisma rows from the same SELECT the admin list used. The company comes from
 * the SESSION on every call; nothing in a path or a query names a company.
 */
@Controller("supplier/orders")
@UseGuards(SessionAuthGuard, RequireSupplierGuard)
export class SupplierOrdersReadController {
  constructor(private readonly orders: SupplierOrdersService) {}

  @Get()
  list(
    @Query() query: TraderPageQueryDto,
    @CurrentSession() session: SessionData
  ): Promise<Paginated<SupplierOrderSummary>> {
    return this.orders.listOrders({ companyId: session.companyId }, query);
  }

  @Get(":id")
  get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData
  ): Promise<SupplierOrderDetail> {
    return this.orders.getOrder({ companyId: session.companyId }, id);
  }

  /**
   * Internal documents for one order.
   *
   * The supplier DOES see `INTERNAL_COMMISSION_DRAFT`, unlike the trader: it
   * records what the platform charges them, and billing someone without
   * letting them see what for is not defensible.
   *
   * `snapshotData` is never selected, every item carries
   * `notice: NOT_A_TAX_INVOICE`, and the contract has no field for a PDF, a QR
   * code or a ZATCA identifier — so none can be rendered by accident.
   */
  @Get(":id/documents")
  listDocuments(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData
  ): Promise<DocumentSummary[]> {
    return this.orders.listDocuments({ companyId: session.companyId }, id);
  }
}
