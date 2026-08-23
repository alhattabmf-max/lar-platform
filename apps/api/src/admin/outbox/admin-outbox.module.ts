import { Module } from "@nestjs/common";
import { AdminOutboxService } from "./admin-outbox.service";
import { AdminOutboxController } from "./admin-outbox.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [AdminSessionModule],
  providers: [AdminOutboxService],
  controllers: [AdminOutboxController],
})
export class AdminOutboxModule {}
