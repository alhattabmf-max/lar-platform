import { Module } from "@nestjs/common";
import { AdminReplacementController } from "./admin-replacement.controller";
import { ReplacementModule } from "../../replacement/replacement.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [ReplacementModule, AdminSessionModule],
  controllers: [AdminReplacementController],
})
export class AdminReplacementModule {}
