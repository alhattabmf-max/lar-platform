import { Module } from "@nestjs/common";
import { AdminOpportunitiesService } from "./admin-opportunities.service";
import { AdminOpportunitiesController } from "./admin-opportunities.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [AdminSessionModule],
  controllers: [AdminOpportunitiesController],
  providers: [AdminOpportunitiesService],
})
export class AdminOpportunitiesModule {}
