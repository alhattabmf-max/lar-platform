import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { OpportunityDiscoveryService } from "./opportunity-discovery.service";
import { ListOpportunitiesQueryDto } from "./dto/list-opportunities-query.dto";

@Controller("opportunities")
export class PublicOpportunitiesController {
  constructor(private readonly discovery: OpportunityDiscoveryService) {}

  @Get("active")
  list(@Query() query: ListOpportunitiesQueryDto) {
    return this.discovery.listPublic(query);
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const opp = await this.discovery.getPublicDetail(id);
    if (!opp) throw new NotFoundException("Opportunity not found");
    return opp;
  }
}
