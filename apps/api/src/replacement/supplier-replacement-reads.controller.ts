import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import type {
  Paginated,
  SupplierReplacementDetail,
  SupplierReplacementSummary,
} from "@platform/types";
import { SupplierReplacementReadsService } from "./supplier-replacement-reads.service";
import { TraderPageQueryDto } from "../orders/dto/trader-page-query.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireSupplierGuard } from "../common/security/require-supplier.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";

/**
 * Reading the replacement obligations a supplier owes.
 *
 * A SEPARATE controller from `SupplierReplacementController`, which owns the
 * three POST transitions. That one carries a `CsrfGuard` because it writes;
 * this one is read-only and does not need it, and keeping them apart means the
 * guard set on each says exactly what that class does.
 *
 * Both mount at `supplier/replacement-obligations`. Nest merges the routes, so
 * the paths are what the contract says regardless of which class holds them.
 *
 * Until these two routes existed there was no read surface at all: a supplier
 * could be told to send a replacement and had no way to see what they owed,
 * and `REPLACEMENT_REQUIRED` — an ACTION_REQUIRED notification — pointed
 * nowhere.
 */
@Controller("supplier/replacement-obligations")
@UseGuards(SessionAuthGuard, RequireSupplierGuard)
export class SupplierReplacementReadsController {
  constructor(private readonly replacements: SupplierReplacementReadsService) {}

  @Get()
  list(
    @Query() query: TraderPageQueryDto,
    @CurrentSession() session: SessionData
  ): Promise<Paginated<SupplierReplacementSummary>> {
    return this.replacements.list({ companyId: session.companyId }, query);
  }

  @Get(":id")
  get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentSession() session: SessionData
  ): Promise<SupplierReplacementDetail> {
    return this.replacements.get({ companyId: session.companyId }, id);
  }
}
