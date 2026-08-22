import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AppConfigModule } from "./config/app-config.module";
import { LoggerModule } from "./common/logger/logger.module";
import { PrismaModule } from "./database/prisma.module";
import { RedisModule } from "./common/redis/redis.module";
import { StorageModule } from "./storage/storage.module";
import { EmailModule } from "./email/email.module";
import { MapsModule } from "./maps/maps.module";
import { HealthModule } from "./health/health.module";
import { ErrorEnvelopeFilter } from "./common/filters/error-envelope.filter";
import { SecurityModule } from "./common/security/security.module";
import { RateLimitModule } from "./common/security/rate-limit.module";
import { AuditModule } from "./audit/audit.module";
import { SettingsModule } from "./settings/settings.module";
import { PoliciesModule } from "./policies/policies.module";
import { VerificationModule } from "./verification/verification.module";
import { CompaniesModule } from "./companies/companies.module";
import { AuthModule } from "./auth/auth.module";
import { AdminModule } from "./admin/admin.module";
import { TaxonomyModule } from "./taxonomy/taxonomy.module";
import { SalesUnitsModule } from "./sales-units/sales-units.module";
import { ProductsModule } from "./products/products.module";
import { ProductReportsModule } from "./product-reports/product-reports.module";
import { CheckoutModule } from "./checkout/checkout.module";
import { PaymentsModule } from "./payments/payments.module";
import { OrdersModule } from "./orders/orders.module";
import { AdminOrdersModule } from "./admin/orders/admin-orders.module";
import { FulfillmentModule } from "./fulfillment/fulfillment.module";
import { AdminFulfillmentModule } from "./admin/fulfillment/admin-fulfillment.module";
import { DisputeModule } from "./disputes/dispute.module";
import { AdminDisputeModule } from "./admin/disputes/admin-dispute.module";
import { ReplacementModule } from "./replacement/replacement.module";
import { AdminReplacementModule } from "./admin/replacement/admin-replacement.module";
import { RefundModule } from "./refunds/refund.module";
import { AdminSettlementModule } from "./admin/settlement/admin-settlement.module";
import { AdminBuyerBillingOverrideModule } from "./admin/financial-override/admin-buyer-billing-override.module";
import { AdminInvoicingModule } from "./admin/invoicing/admin-invoicing.module";
import { AdminRefundModule } from "./admin/refunds/admin-refund.module";
import { AdminTaxonomyModule } from "./admin/taxonomy/admin-taxonomy.module";
import { AdminSalesUnitsModule } from "./admin/sales-units/admin-sales-units.module";
import { AdminProductsModule } from "./admin/products/admin-products.module";
import { FinancialModule } from "./financial/financial.module";
import { AdminFinancialModule } from "./admin/financial/admin-financial.module";
import { GeographyModule } from "./geography/geography.module";
import { AdminGeographyModule } from "./admin/geography/admin-geography.module";
import { TaxModule } from "./tax/tax.module";
import { OpportunitiesModule } from "./opportunities/opportunities.module";
import { AdminOpportunitiesModule } from "./admin/opportunities/admin-opportunities.module";
import { BrandingModule } from "./branding/branding.module";
import { BannerModule } from "./banners/banner.module";
import { AdminBannerModule } from "./admin/banners/admin-banner.module";
import { NotificationsModule } from "./notifications/notifications.module";

@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    EmailModule,
    MapsModule,
    HealthModule,
    SecurityModule,
    RateLimitModule,
    AuditModule,
    SettingsModule,
    PoliciesModule,
    VerificationModule,
    CompaniesModule,
    AuthModule,
    AdminModule,
    TaxonomyModule,
    SalesUnitsModule,
    ProductsModule,
    ProductReportsModule,
    CheckoutModule,
    PaymentsModule,
    OrdersModule,
    AdminOrdersModule,
    FulfillmentModule,
    AdminFulfillmentModule,
    DisputeModule,
    AdminDisputeModule,
    ReplacementModule,
    AdminReplacementModule,
    RefundModule,
    AdminSettlementModule,
    AdminBuyerBillingOverrideModule,
    AdminInvoicingModule,
    AdminRefundModule,
    AdminTaxonomyModule,
    AdminSalesUnitsModule,
    AdminProductsModule,
    FinancialModule,
    AdminFinancialModule,
    GeographyModule,
    AdminGeographyModule,
    TaxModule,
    OpportunitiesModule,
    AdminOpportunitiesModule,
    BrandingModule,
    BannerModule,
    AdminBannerModule,
    NotificationsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ErrorEnvelopeFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
