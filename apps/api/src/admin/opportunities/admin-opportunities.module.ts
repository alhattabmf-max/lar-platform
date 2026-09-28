import { Module } from "@nestjs/common";
import { AdminOpportunitiesService } from "./admin-opportunities.service";
import { AdminOpportunitiesController } from "./admin-opportunities.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";
import { OpportunitiesModule } from "../../opportunities/opportunities.module";

@Module({
  // THE OFFER'S OWN SERVICE, not a second copy of its rules — the
  // console's edit delegates to it.
  imports: [AdminSessionModule, OpportunitiesModule],
  controllers: [AdminOpportunitiesController],
  providers: [AdminOpportunitiesService],
})
export class AdminOpportunitiesModule {}
