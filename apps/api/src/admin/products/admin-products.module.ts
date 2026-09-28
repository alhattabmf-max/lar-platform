import { Module } from "@nestjs/common";
import { AdminProductsService } from "./admin-products.service";
import { AdminProductsController } from "./admin-products.controller";
import { AdminProductImageController } from "./admin-product-image.controller";
import { AdminProductMediaController } from "./admin-product-media.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";
import { ProductReportsModule } from "../../product-reports/product-reports.module";
import { ProductsModule } from "../../products/products.module";

/**
 * Controllers and one service. ProductsModule supplies everything the
 * console must not own a second copy of: the supplier write rules the
 * admin edit calls (branch, sales unit, package group, re-approval), the
 * media resolver behind the admin image route, and the delivery service
 * that serves the bytes.
 */
@Module({
  imports: [AdminSessionModule, ProductReportsModule, ProductsModule],
  controllers: [
    AdminProductsController,
    AdminProductImageController,
    AdminProductMediaController,
  ],
  providers: [AdminProductsService],
})
export class AdminProductsModule {}
