import { Module } from "@nestjs/common";
import { AdminSalesUnitsController } from "./admin-sales-units.controller";
import { SalesUnitsModule } from "../../sales-units/sales-units.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [SalesUnitsModule, AdminSessionModule],
  controllers: [AdminSalesUnitsController],
})
export class AdminSalesUnitsModule {}
