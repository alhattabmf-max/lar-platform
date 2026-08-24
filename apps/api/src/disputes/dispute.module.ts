import { Module } from "@nestjs/common";
import { DisputeService } from "./dispute.service";
import { EvidenceUploadService } from "./evidence-upload.service";
import { TraderOrderAllocationDisputeController, TraderDisputeDetailController, TraderEvidenceUploadController } from "./trader-dispute.controller";
import { SupplierDisputeController } from "./supplier-dispute.controller";
import { StorageModule } from "../storage/storage.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule, StorageModule],
  controllers: [TraderOrderAllocationDisputeController, TraderDisputeDetailController, TraderEvidenceUploadController, SupplierDisputeController],
  providers: [DisputeService, EvidenceUploadService],
  exports: [DisputeService, EvidenceUploadService],
})
export class DisputeModule {}
