import { Module } from "@nestjs/common";
import { IntegrationCenterService } from "./integration-center.service";
import { IntegrationCenterController } from "./integration-center.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [AdminSessionModule],
  controllers: [IntegrationCenterController],
  providers: [IntegrationCenterService],
})
export class IntegrationCenterModule {}
