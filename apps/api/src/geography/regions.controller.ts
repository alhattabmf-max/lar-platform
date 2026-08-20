import { Controller, Get } from "@nestjs/common";
import { RegionsService } from "./regions.service";

@Controller("regions")
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  @Get("active")
  listActive() {
    return this.regions.listActive();
  }
}
