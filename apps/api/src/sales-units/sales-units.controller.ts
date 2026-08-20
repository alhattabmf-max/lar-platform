import { Controller, Get } from "@nestjs/common";
import { SalesUnitsService } from "./sales-units.service";

@Controller("sales-units")
export class SalesUnitsController {
  constructor(private readonly salesUnits: SalesUnitsService) {}

  @Get("active")
  listActive() {
    return this.salesUnits.listActive();
  }
}
