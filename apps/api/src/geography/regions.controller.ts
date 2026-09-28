import { Controller, Get } from "@nestjs/common";
import type { RegionItem } from "@platform/types";
import { RegionsService } from "./regions.service";

@Controller("regions")
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  /** The regions a branch form and the marketplace filter offer. */
  @Get("active")
  listActive(): Promise<RegionItem[]> {
    return this.regions.listActive();
  }
}
