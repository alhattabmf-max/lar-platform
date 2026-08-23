import { Module } from "@nestjs/common";
import { AdminDirectoryService } from "./admin-directory.service";
import { AdminDirectoryController } from "./admin-directory.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [AdminSessionModule],
  providers: [AdminDirectoryService],
  controllers: [AdminDirectoryController],
})
export class AdminDirectoryModule {}
