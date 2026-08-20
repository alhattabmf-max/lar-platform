import { Module } from "@nestjs/common";
import { AdminProductsService } from "./admin-products.service";
import { AdminProductsController } from "./admin-products.controller";
import { AdminSessionModule } from "../admin-auth/admin-session.module";
import { ProductReportsModule } from "../../product-reports/product-reports.module";

@Module({
  imports: [AdminSessionModule, ProductReportsModule],
  controllers: [AdminProductsController],
  providers: [AdminProductsService],
})
export class AdminProductsModule {}
