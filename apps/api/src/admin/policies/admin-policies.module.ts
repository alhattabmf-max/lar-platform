import { Module } from "@nestjs/common";
import { AdminPoliciesController } from "./admin-policies.controller";
import { AdminPoliciesService } from "./admin-policies.service";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [AdminSessionModule],
  providers: [AdminPoliciesService],
  controllers: [AdminPoliciesController],
})
export class AdminPoliciesModule {}
