import { Module } from "@nestjs/common";
import { ListingsService } from "./listings.service";
import { ListingsController } from "./listings.controller";
import { ProductsModule } from "../products/products.module";
import { OpportunitiesModule } from "../opportunities/opportunities.module";
import { MediaPolicyModule } from "../settings/media-policy.module";
import { AuditModule } from "../audit/audit.module";

/**
 * The seam module.
 *
 * It owns no data and no rules — it imports the two modules that do and
 * puts one door in front of them. If this file ever grows a policy of
 * its own, the policy belongs in whichever module owns the row it
 * governs, not here.
 */
@Module({
  imports: [ProductsModule, OpportunitiesModule, MediaPolicyModule, AuditModule],
  controllers: [ListingsController],
  providers: [ListingsService],
})
export class ListingsModule {}
