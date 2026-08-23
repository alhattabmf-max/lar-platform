import { Module } from "@nestjs/common";
import { AdminUsersService } from "./admin-users.service";
import { AdminUsersController } from "./admin-users.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [AdminSessionModule],
  providers: [AdminUsersService],
  controllers: [AdminUsersController],
})
export class AdminUsersModule {}
