import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import { OPPORTUNITY_SORTS, type OpportunitySort } from "@platform/types";

export class ListOpportunitiesQueryDto {
  /**
   * Matched against the FROZEN approval snapshot's own taxonomyNodeId
   * with equality — descendants are NOT included. See
   * TAXONOMY_FILTER_INCLUDES_DESCENDANTS in @platform/types, which any
   * UI offering this filter must read so its copy stays truthful.
   */
  @IsOptional()
  @IsUUID()
  taxonomyNodeId?: string;

  @IsOptional()
  @IsUUID()
  cityId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  /**
   * Validated against the SHARED vocabulary rather than a locally
   * declared enum, so the API and the web app cannot drift apart on
   * what a valid sort is. Anything outside it is a 400, not a silent
   * fallback to the default — a caller that sends `sort=cheapest` has a
   * bug, and quietly serving newest-first would hide it.
   */
  @IsOptional()
  @IsIn(OPPORTUNITY_SORTS)
  sort?: OpportunitySort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
