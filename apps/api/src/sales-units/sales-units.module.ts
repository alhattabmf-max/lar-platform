import { Module } from "@nestjs/common";
import { SalesUnitsService } from "./sales-units.service";
import { SalesUnitsController } from "./sales-units.controller";

@Module({
  controllers: [SalesUnitsController],
  providers: [SalesUnitsService],
  exports: [SalesUnitsService],
})
export class SalesUnitsModule {}
