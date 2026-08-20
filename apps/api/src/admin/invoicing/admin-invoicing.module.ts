import { Module } from "@nestjs/common";
import { AdminInvoicingController } from "./admin-invoicing.controller";
import { InvoicingModule } from "../../invoicing/invoicing.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [InvoicingModule, AdminSessionModule],
  controllers: [AdminInvoicingController],
})
export class AdminInvoicingModule {}
