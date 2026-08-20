import { Module } from "@nestjs/common";
import { AdminRegionsController } from "./admin-regions.controller";
import { AdminCitiesController } from "./admin-cities.controller";
import { GeographyModule } from "../../geography/geography.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [GeographyModule, AdminSessionModule],
  controllers: [AdminRegionsController, AdminCitiesController],
})
export class AdminGeographyModule {}
