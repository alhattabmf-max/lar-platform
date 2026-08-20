import { Module } from "@nestjs/common";
import { AdminBuyerBillingOverrideController } from "./admin-buyer-billing-override.controller";
import { FinancialModule } from "../../financial/financial.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [FinancialModule, AdminSessionModule],
  controllers: [AdminBuyerBillingOverrideController],
})
export class AdminBuyerBillingOverrideModule {}
