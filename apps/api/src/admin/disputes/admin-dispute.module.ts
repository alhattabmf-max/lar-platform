import { Module } from "@nestjs/common";
import { AdminDisputeController } from "./admin-dispute.controller";
import { DisputeModule } from "../../disputes/dispute.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [DisputeModule, AdminSessionModule],
  controllers: [AdminDisputeController],
})
export class AdminDisputeModule {}
