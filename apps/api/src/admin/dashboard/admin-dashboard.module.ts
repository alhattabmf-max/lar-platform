import { Module } from "@nestjs/common";
import { AdminDashboardController } from "./admin-dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { AdminOrdersService } from "./admin-orders.service";
import { FollowUpService } from "./follow-up.service";
import { AdminExportService } from "../exports/admin-export.service";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

/**
 * The three screens of the overview decision.
 *
 * They share a module because they share a period: the same window is
 * resolved once, in one place, and an operator moving from the overview
 * to the orders page sees the same thirty days on both.
 */
@Module({
  imports: [AdminSessionModule],
  controllers: [AdminDashboardController],
  providers: [
    DashboardService,
    AdminOrdersService,
    FollowUpService,
    AdminExportService,
  ],
})
export class AdminDashboardModule {}
