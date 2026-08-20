import { Controller, Get, NotFoundException, Param, Query, UseGuards } from "@nestjs/common";
import { OpportunityDiscoveryService } from "./opportunity-discovery.service";
import { ListOpportunitiesQueryDto } from "./dto/list-opportunities-query.dto";
import { SessionAuthGuard } from "../common/security/session-auth.guard";
import { RequireTraderGuard } from "../common/security/require-trader.guard";

@Controller("trader/opportunities")
@UseGuards(SessionAuthGuard, RequireTraderGuard)
export class TraderOpportunitiesController {
  constructor(private readonly discovery: OpportunityDiscoveryService) {}

  @Get("active")
  list(@Query() query: ListOpportunitiesQueryDto) {
    return this.discovery.listForTrader(query);
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const opp = await this.discovery.getTraderDetail(id);
    if (!opp) throw new NotFoundException("Opportunity not found");
    return opp;
  }
}
