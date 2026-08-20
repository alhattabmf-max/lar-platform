import { Controller, Get } from "@nestjs/common";
import type { CityItem } from "@platform/types";
import { CitiesService } from "./cities.service";

@Controller("cities")
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  /**
   * Projected onto the shared contract. The region is flattened to
   * id + names; the raw joined Region row (with its own isActive and
   * timestamps) is not forwarded.
   */
  @Get("active")
  async listActive(): Promise<CityItem[]> {
    const rows = await this.cities.listActive();

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
