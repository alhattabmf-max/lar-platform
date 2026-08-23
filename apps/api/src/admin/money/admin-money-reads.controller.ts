import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { AdminRefundItem, AdminSettlementItem, Paginated } from "@platform/types";
import { AdminMoneyReadsService } from "./admin-money-reads.service";
import { AdminRefundsQueryDto, AdminSettlementsQueryDto } from "./dto/admin-money-query.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";

/**
 * Refunds and settlements, read-only.
 *
 * Both areas already had actions with no way to reach them. The writes
 * stay where they are — `POST /admin/refund-obligations/:id/attempts`
 * and `POST /admin/order-allocations/:id/settle` — and nothing new is
 * added here.
 */
@Controller("admin")
@UseGuards(AdminSessionAuthGuard)
export class AdminMoneyReadsController {
  constructor(private readonly money: AdminMoneyReadsService) {}

  @Get("refund-obligations")
  refunds(@Query() query: AdminRefundsQueryDto): Promise<Paginated<AdminRefundItem>> {
    return this.money.listRefunds(query);
  }

  @Get("settlements")
  settlements(@Query() query: AdminSettlementsQueryDto): Promise<Paginated<AdminSettlementItem>> {
    return this.money.listSettlements(query);
  }
}
