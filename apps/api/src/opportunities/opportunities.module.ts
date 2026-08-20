import { Module } from "@nestjs/common";
import { OpportunitiesService } from "./opportunities.service";
import { OpportunitiesController } from "./opportunities.controller";
import { OpportunityDiscoveryService } from "./opportunity-discovery.service";
import { OpportunityImageService } from "./opportunity-image.service";
import { PublicOpportunitiesController } from "./public-opportunities.controller";
import { TraderOpportunitiesController } from "./trader-opportunities.controller";
import { OpportunityImageController } from "./opportunity-image.controller";
import { OpportunitySettingsModule } from "../settings/opportunity-settings.module";
import { ShareTierSettingsModule } from "../settings/share-tier-settings.module";
import { CommissionPolicyModule } from "../settings/commission-policy.module";
import { TaxModule } from "../tax/tax.module";
import { ImageDeliveryService } from "../common/media/image-delivery.service";

@Module({
  imports: [OpportunitySettingsModule, ShareTierSettingsModule, CommissionPolicyModule, TaxModule],
  controllers: [
    OpportunitiesController,
    TraderOpportunitiesController,
    PublicOpportunitiesController,
    OpportunityImageController,
  ],
  providers: [
    OpportunitiesService,
    OpportunityDiscoveryService,
    OpportunityImageService,
    // The same shared delivery service the banner routes use, so the
    // caching and content-type behaviour is identical on both surfaces.
    ImageDeliveryService,
  ],
  exports: [OpportunitiesService],
})
export class OpportunitiesModule {}
