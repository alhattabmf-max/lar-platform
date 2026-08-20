import { Module } from "@nestjs/common";
import { OpportunitiesService } from "./opportunities.service";
import { OpportunitiesController } from "./opportunities.controller";
import { OpportunityDiscoveryService } from "./opportunity-discovery.service";
import { PublicOpportunitiesController } from "./public-opportunities.controller";
import { TraderOpportunitiesController } from "./trader-opportunities.controller";
import { OpportunitySettingsModule } from "../settings/opportunity-settings.module";
import { ShareTierSettingsModule } from "../settings/share-tier-settings.module";
import { CommissionPolicyModule } from "../settings/commission-policy.module";
import { TaxModule } from "../tax/tax.module";

@Module({
  imports: [OpportunitySettingsModule, ShareTierSettingsModule, CommissionPolicyModule, TaxModule],
  controllers: [OpportunitiesController, TraderOpportunitiesController, PublicOpportunitiesController],
  providers: [OpportunitiesService, OpportunityDiscoveryService],
  exports: [OpportunitiesService],
})
export class OpportunitiesModule {}
