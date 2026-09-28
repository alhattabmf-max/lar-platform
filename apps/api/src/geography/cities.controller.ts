import { Controller, Get, Query } from "@nestjs/common";
import { IsOptional, IsUUID } from "class-validator";
import type { CityItem } from "@platform/types";
import { CitiesService } from "./cities.service";

/**
 * Which cities to list.
 *
 * `regionId` IS THE WHOLE POINT of this DTO: a picker shows one
 * region's cities, and asking for them by region is what stops the
 * marketplace shipping every city on the platform into the browser to
 * filter them there.
 */
class ListCitiesQueryDto {
  @IsOptional()
  @IsUUID()
  regionId?: string;
}

@Controller("cities")
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  /**
   * Projected onto the shared contract. The region is flattened to
   * id + names; the raw joined Region row (with its own isActive and
   * timestamps) is not forwarded.
   */
  @Get("active")
  async listActive(@Query() query: ListCitiesQueryDto): Promise<CityItem[]> {
    const rows = await this.cities.listActive(query.regionId);

    return rows.map((row) => ({
      id: row.id,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      region: {
        id: row.region.id,
        nameAr: row.region.nameAr,
        nameEn: row.region.nameEn,
      },
    }));
  }
}
