import { Module } from "@nestjs/common";
import { AdminBankAccountsService } from "./admin-bank-accounts.service";
import { AdminBankAccountsController } from "./admin-bank-accounts.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";
import { FinancialSettingsModule } from "../../settings/financial-settings.module";

@Module({
  imports: [AdminSessionModule, FinancialSettingsModule],
  controllers: [AdminBankAccountsController],
  providers: [AdminBankAccountsService],
})
export class AdminFinancialModule {}
