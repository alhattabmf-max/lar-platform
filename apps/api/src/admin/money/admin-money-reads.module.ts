import { Module } from "@nestjs/common";
import { AdminMoneyReadsService } from "./admin-money-reads.service";
import { AdminMoneyReadsController } from "./admin-money-reads.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [AdminSessionModule],
  providers: [AdminMoneyReadsService],
  controllers: [AdminMoneyReadsController],
})
export class AdminMoneyReadsModule {}
