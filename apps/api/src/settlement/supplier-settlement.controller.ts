import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import type { Paginated, SettlementDetail, SettlementSummary } from "@platform/types";
import { SupplierSettlementService } from "./supplier-settlement.service";
import { TraderPageQueryDto } from "../orders/dto/trader-page-query.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireSupplierGuard } from "../common/security/require-supplier.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";

/**
 * What a supplier may read of being paid.
 *
 * The first read surface on `supplier_payouts` — until 8E the table was
 * written by the admin settlement path and never exposed. That is why the
 * projection behind these two routes is deliberate about what it does NOT
 * select: `externalTransferReference`, `executedByAdminUserId` and
 * `supplierBankAccountId` describe the platform's banking operation, not the
 * supplier's money.
 *
 * Read-only, so no `CsrfGuard`.
 */
@Controller("supplier/settlements")
@UseGuards(SessionAuthGuard, RequireSupplierGuard)
export class SupplierSettlementController {
  constructor(private readonly settlements: SupplierSettlementService) {}

  @Get()
  list(
    @Query() query: TraderPageQueryDto,
    @CurrentSession() session: SessionData
  ): Promise<Paginated<SettlementSummary>> {
    return this.settlements.list({ companyId: session.companyId }, query);
  }

  @Get(":id")
  get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData
  ): Promise<SettlementDetail> {
    return this.settlements.get({ companyId: session.companyId }, id);
  }
}
