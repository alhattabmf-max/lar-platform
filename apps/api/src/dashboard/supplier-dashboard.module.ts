import { Module } from "@nestjs/common";
import { SupplierDashboardController } from "./supplier-dashboard.controller";
import { SupplierDashboardService } from "./supplier-dashboard.service";

/**
 * The supplier's landing screen.
 *
 * It reads `PrismaService` and nothing else — the period arithmetic and
 * the snapshot media reader it borrows are pure functions, so there is
 * no second module to wire and no cycle to create.
 */
@Module({
  controllers: [SupplierDashboardController],
  providers: [SupplierDashboardService],
})
export class SupplierDashboardModule {}
