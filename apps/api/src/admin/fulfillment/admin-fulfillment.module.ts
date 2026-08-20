import { Module } from "@nestjs/common";
import { AdminFulfillmentController } from "./admin-fulfillment.controller";
import { FulfillmentModule } from "../../fulfillment/fulfillment.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [FulfillmentModule, AdminSessionModule],
  controllers: [AdminFulfillmentController],
})
export class AdminFulfillmentModule {}
