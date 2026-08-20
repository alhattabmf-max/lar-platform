import { Module } from "@nestjs/common";
import { AdminRefundController } from "./admin-refund.controller";
import { RefundModule } from "../../refunds/refund.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [RefundModule, AdminSessionModule],
  controllers: [AdminRefundController],
})
export class AdminRefundModule {}
