import { Module } from "@nestjs/common";
import { ProductsService } from "./products.service";
import { ProductsController } from "./products.controller";
import { ProductMediaService } from "./product-media.service";
import { ProductMediaController } from "./product-media.controller";
import { StorageModule } from "../storage/storage.module";
import { MediaPolicyModule } from "../settings/media-policy.module";

@Module({
  imports: [StorageModule, MediaPolicyModule],
  controllers: [ProductsController, ProductMediaController],
  providers: [ProductsService, ProductMediaService],
  exports: [ProductsService],
})
export class ProductsModule {}
