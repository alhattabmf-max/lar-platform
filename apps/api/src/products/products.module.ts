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
  // ProductMediaService leaves the module for one caller: the unified
  // listing route, where the image is part of the submission rather
  // than a second trip.
  //
  // ProductMediaImageService leaves it for the ADMIN image route, which
  // serves the same bytes to a caller who has no company — so it resolves
  // the media by its two ids instead of by ownership. One resolver, so the
  // ETag and the content-type rules cannot differ between the two doors.
  //
  // ImageDeliveryService leaves it with them. The admin route serves the
  // same bytes through the same delivery rules, and a second instance
  // provided next door would be a second place for the caching and
  // content-type behaviour to drift — the reason the banner module
  // hands its own out rather than letting the console build one.
  exports: [
    ProductsService,
    ProductMediaService,
    ProductMediaImageService,
    ImageDeliveryService,
  ],
})
export class ProductsModule {}
