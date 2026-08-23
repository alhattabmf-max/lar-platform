import { Module } from "@nestjs/common";
import { ProductsService } from "./products.service";
import { ProductsController } from "./products.controller";
import { ProductMediaService } from "./product-media.service";
import { ProductMediaController } from "./product-media.controller";
import { ProductMediaImageService } from "./product-media-image.service";
import { ProductMediaImageController } from "./product-media-image.controller";
import { ImageDeliveryService } from "../common/media/image-delivery.service";
import { StorageModule } from "../storage/storage.module";
import { MediaPolicyModule } from "../settings/media-policy.module";

@Module({
  imports: [StorageModule, MediaPolicyModule],
  controllers: [ProductsController, ProductMediaController, ProductMediaImageController],
  providers: [
    ProductsService,
    ProductMediaService,
    ProductMediaImageService,
    ImageDeliveryService,
  ],
  exports: [ProductsService],
})
export class ProductsModule {}
