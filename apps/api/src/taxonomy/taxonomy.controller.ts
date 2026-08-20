import { Controller, Get } from "@nestjs/common";
import { TaxonomyService } from "./taxonomy.service";

@Controller("taxonomy")
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get("active")
  listActive() {
    return this.taxonomy.listActive();
  }
}
