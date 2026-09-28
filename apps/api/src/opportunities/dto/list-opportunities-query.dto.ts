import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { OPPORTUNITY_SORTS, type OpportunitySort } from "@platform/types";

export class ListOpportunitiesQueryDto {
  /**
   * FREE TEXT, matched against what the offer SHOWS.
   *
   * The owner's decision: «الاسم والوصف معًا» — the product's name and
   * description as FROZEN in the approval snapshot, plus the offer's
   * own description. Never the live product row: a page displays the
   * snapshot, so searching anything else could match a name nobody can
   * see and miss the one on the screen.
   *
   * TRIMMED, AND EMPTY MEANS ABSENT. A caller sending `?q=` is not
   * asking for the offers whose name contains nothing; it is a form
   * submitted with an empty box, and the honest answer is the
   * unfiltered list.
   *
   * BOUNDED AT A HUNDRED CHARACTERS. Nobody types a product name
   * longer than that, and an unbounded string reaches a LIKE pattern.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;

  /**
   * Matched against the FROZEN approval snapshot's own taxonomyNodeId
   * with equality — descendants are NOT included. See
   * TAXONOMY_FILTER_INCLUDES_DESCENDANTS in @platform/types, which any
   * UI offering this filter must read so its copy stays truthful.
   */
  @IsOptional()
  @IsUUID()
  taxonomyNodeId?: string;

  /**
   * THE PRIMARY PLACE FILTER. A listing ships from a branch, a branch
   * is recorded against a region, and this is what a buyer narrows by.
   */
  @IsOptional()
  @IsUUID()
  regionId?: string;

  /**
   * THE OPTIONAL REFINEMENT beneath it, kept for two reasons: a link
   * somebody bookmarked before the region became the filter still
   * works, and a buyer who wants one city inside a region can still
   * say so where active cities exist.
   *
   * A listing whose branch named no city matches no `cityId`, which is
   * correct — it cannot claim to be in a city it does not name.
   */
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
