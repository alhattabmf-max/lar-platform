import { Module } from "@nestjs/common";
import { ProductReportsService } from "./product-reports.service";
import { ProductReportsController } from "./product-reports.controller";

@Module({
  controllers: [ProductReportsController],
  providers: [ProductReportsService],
  exports: [ProductReportsService],
})
export class ProductReportsModule {}
