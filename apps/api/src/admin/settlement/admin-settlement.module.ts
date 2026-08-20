import { Module } from "@nestjs/common";
import { AdminSettlementController } from "./admin-settlement.controller";
import { SettlementModule } from "../../settlement/settlement.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [SettlementModule, AdminSessionModule],
  controllers: [AdminSettlementController],
})
export class AdminSettlementModule {}
