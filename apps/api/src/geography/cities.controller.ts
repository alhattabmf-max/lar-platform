import { Controller, Get } from "@nestjs/common";
import { CitiesService } from "./cities.service";

@Controller("cities")
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  @Get("active")
  listActive() {
    return this.cities.listActive();
  }
}
