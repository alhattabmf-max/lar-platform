import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { SupplierDashboardOverview } from "@platform/types";
import { SupplierDashboardService } from "./supplier-dashboard.service";
import { SupplierDashboardQueryDto } from "./dto/supplier-dashboard-query.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireSupplierGuard } from "../common/security/require-supplier.guard";
import { CurrentSession } from "../common/security/current-session.decorator";
import type { SessionData } from "../common/security/session.service";

/**
 * The supplier's own landing screen, as ONE read.
 *
 * WHAT IT REPLACES. The page assembled itself from six list endpoints
 * and counted the rows that came back — which answers "how many are on
 * the first page", not "how many are there".
 *
 * THE COMPANY COMES FROM THE SESSION, never from the query. There is
 * no parameter on this route that could name another company, so there
 * is nothing for a caller to tamper with: `RequireSupplierGuard`
 * settles who may ask, and the session settles what they are asking
 * about.
 */
@Controller("supplier")
@UseGuards(SessionAuthGuard, RequireSupplierGuard)
export class SupplierDashboardController {
  constructor(private readonly dashboard: SupplierDashboardService) {}

  @Get("dashboard/overview")
  overview(
    @CurrentSession() session: SessionData,
    @Query() query: SupplierDashboardQueryDto,
  ): Promise<SupplierDashboardOverview> {
    return this.dashboard.overview(session.companyId, query.resolvedPeriod());
  }
}
