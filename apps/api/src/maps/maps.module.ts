import { Module } from "@nestjs/common";
import { MAPS_PROVIDER } from "./maps-provider.interface";
import { ManualMapsProvider } from "./manual-maps.provider";

@Module({
  providers: [{ provide: MAPS_PROVIDER, useClass: ManualMapsProvider }],
  exports: [MAPS_PROVIDER],
})
export class MapsModule {}
