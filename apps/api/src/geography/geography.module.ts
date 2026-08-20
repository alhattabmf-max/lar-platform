import { Module } from "@nestjs/common";
import { RegionsService } from "./regions.service";
import { RegionsController } from "./regions.controller";
import { CitiesService } from "./cities.service";
import { CitiesController } from "./cities.controller";

@Module({
  controllers: [RegionsController, CitiesController],
  providers: [RegionsService, CitiesService],
  exports: [RegionsService, CitiesService],
})
export class GeographyModule {}
