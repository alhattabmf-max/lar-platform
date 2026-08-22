import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import type {
  DisputeSummary,
  DocumentSummary,
  OrderDetail,
  OrderSummary,
  Paginated,
  ReplacementDetail,
  ReplacementSummary,
} from "@platform/types";
import { TraderOrdersService } from "./trader-orders.service";
import { TraderPageQueryDto } from "./dto/trader-page-query.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireTraderGuard } from "../common/security/require-trader.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";

/**
 * Trader read surfaces added in 8D.3.
 *
 * Read-only, so no `CsrfGuard` — the underlying check exempts safe
 * methods anyway, and every route here is a GET.
 *
 * There is deliberately NO `GET /trader/order-allocations/:id`. An
 * allocation is only meaningful inside its order, and a separate route
 * would be a second ownership boundary to get right for nothing in
 * return; the allocations arrive inline on the order detail.
 */
@Controller("trader")
@UseGuards(SessionAuthGuard, RequireTraderGuard)
export class TraderReadsController {
  constructor(private readonly orders: TraderOrdersService) {}

  /**
   * Internal documents for one order.
   *
   * `INTERNAL_COMMISSION_DRAFT` is never returned, `snapshotData` is
   * never selected, and every item carries `notice: NOT_A_TAX_INVOICE`.
   * No PDF, no QR code, no ZATCA identifier exists on this contract.
   */
  @Get("orders/:masterOrderId/documents")
  listDocuments(
    @Param("masterOrderId", new ParseUUIDPipe()) masterOrderId: string,
    @CurrentSession() session: SessionData
  ): Promise<DocumentSummary[]> {
    return this.orders.listDocuments({ companyId: session.companyId }, masterOrderId);
  }

  @Get("disputes")
  listDisputes(
    @Query() query: TraderPageQueryDto,
    @CurrentSession() session: SessionData
  ): Promise<Paginated<DisputeSummary>> {
    return this.orders.listDisputes({ companyId: session.companyId }, query);
  }

  @Get("replacement-obligations")
  listReplacements(
    @Query() query: TraderPageQueryDto,
    @CurrentSession() session: SessionData
  ): Promise<Paginated<ReplacementSummary>> {
    return this.orders.listReplacements({ companyId: session.companyId }, query);
  }

  /**
   * Closes the action target of a `REPLACEMENT_FAILED` notification —
   * until this existed, that notification had nowhere to send anyone.
   */
  @Get("replacement-obligations/:id")
  getReplacement(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData
  ): Promise<ReplacementDetail> {
    return this.orders.getReplacement({ companyId: session.companyId }, id);
  }
}

/**
 * The widened order list and detail.
 *
 * A separate controller because `trader/orders` already existed and
 * keeps its own path; the routes are unchanged, only what they return.
 */
@Controller("trader/orders")
@UseGuards(SessionAuthGuard, RequireTraderGuard)
export class TraderOrdersReadController {
  constructor(private readonly orders: TraderOrdersService) {}

  @Get()
  list(
    @Query() query: TraderPageQueryDto,
    @CurrentSession() session: SessionData
  ): Promise<Paginated<OrderSummary>> {
    return this.orders.listOrders({ companyId: session.companyId }, query);
  }

  @Get(":id")
  get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData
  ): Promise<OrderDetail> {
    return this.orders.getOrder({ companyId: session.companyId }, id);
  }
}
