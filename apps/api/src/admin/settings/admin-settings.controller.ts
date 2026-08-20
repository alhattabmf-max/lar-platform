import { Body, Controller, Get, Param, Put, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AdminSettingsService } from "./admin-settings.service";
import { SecuritySettingsService } from "../../settings/security-settings.service";
import { MediaPolicyService } from "../../settings/media-policy.service";
import { FinancialSettingsService } from "../../settings/financial-settings.service";
import { TaxRateSettingsService } from "../../settings/tax-rate-settings.service";
import { OpportunitySettingsService } from "../../settings/opportunity-settings.service";
import { ShareTierSettingsService } from "../../settings/share-tier-settings.service";
import { CommissionPolicyService } from "../../settings/commission-policy.service";
import { CheckoutSettingsService } from "../../settings/checkout-settings.service";
import { ShippingTariffPolicyService } from "../../settings/shipping-tariff-policy.service";
import { CommissionTaxPolicyService } from "../../settings/commission-tax-policy.service";
import { PaymentSettingsService } from "../../settings/payment-settings.service";
import { FulfillmentSettingsService } from "../../settings/fulfillment-settings.service";
import { SetSystemSettingDto } from "./dto/set-system-setting.dto";
import { SetRateLimitDto } from "./dto/set-rate-limit.dto";
import { SetSessionDurationDto } from "./dto/set-session-duration.dto";
import { SetMediaPolicyDto } from "./dto/set-media-policy.dto";
import { SetPayoutHoldDaysDto } from "./dto/set-payout-hold-days.dto";
import { SetDefaultTaxRateDto } from "./dto/set-default-tax-rate.dto";
import { SetOpportunitySettingsDto } from "./dto/set-opportunity-settings.dto";
import { SetShareTierPolicyDto } from "./dto/set-share-tier-policy.dto";
import { SetCommissionPolicyDto } from "./dto/set-commission-policy.dto";
import { SetCheckoutSettingsDto } from "./dto/set-checkout-settings.dto";
import { SetShippingTariffDto } from "./dto/set-shipping-tariff.dto";
import { SetCommissionTaxDto } from "./dto/set-commission-tax.dto";
import { SetPaymentSettingsDto } from "./dto/set-payment-settings.dto";
import { SetFulfillmentSettingsDto } from "./dto/set-fulfillment-settings.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";
import { CsrfGuard } from "../../common/security/csrf.guard";
import { CurrentAdminSession } from "../admin-auth/current-admin-session.decorator";
import type { AdminSessionData } from "../admin-auth/admin-session.service";
import { getRequestId } from "../../common/logger/request-id.util";

function ctxFrom(req: Request, session: AdminSessionData) {
  return {
    actorId: session.adminUserId,
    requestId: getRequestId(req),
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };
}

@Controller("admin/settings")
@UseGuards(AdminSessionAuthGuard, CsrfGuard)
export class AdminSettingsController {
  constructor(
    private readonly settings: AdminSettingsService,
    private readonly securitySettings: SecuritySettingsService,
    private readonly mediaPolicy: MediaPolicyService,
    private readonly financialSettings: FinancialSettingsService,
    private readonly taxRateSettings: TaxRateSettingsService,
    private readonly opportunitySettings: OpportunitySettingsService,
    private readonly shareTierSettings: ShareTierSettingsService,
    private readonly commissionPolicy: CommissionPolicyService,
    private readonly checkoutSettings: CheckoutSettingsService,
    private readonly shippingTariff: ShippingTariffPolicyService,
    private readonly commissionTaxPolicy: CommissionTaxPolicyService,
    private readonly paymentSettings: PaymentSettingsService,
    private readonly fulfillmentSettings: FulfillmentSettingsService
  ) {}

  @Get()
  list() {
    return this.settings.list();
  }

  @Get("security")
  async security() {
    const [loginRateLimit, twoFaRateLimit, sessionDurationSeconds] = await Promise.all([
      this.securitySettings.getAdminLoginRateLimit(),
      this.securitySettings.getAdmin2faRateLimit(),
      this.securitySettings.getAdminSessionDurationSeconds(),
    ]);
    return { loginRateLimit, twoFaRateLimit, sessionDurationSeconds };
  }

  @Put("security/login-rate-limit")
  async setLoginRateLimit(
    @Body() dto: SetRateLimitDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.securitySettings.setAdminLoginRateLimit(dto, ctxFrom(req, session));
    return { status: "ok" };
  }

  @Put("security/2fa-rate-limit")
  async set2faRateLimit(
    @Body() dto: SetRateLimitDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.securitySettings.setAdmin2faRateLimit(dto, ctxFrom(req, session));
    return { status: "ok" };
  }

  @Put("security/session-duration")
  async setSessionDuration(
    @Body() dto: SetSessionDurationDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.securitySettings.setAdminSessionDurationSeconds(dto.seconds, ctxFrom(req, session));
    return { status: "ok" };
  }

  @Get("security/payout-hold-days")
  async getPayoutHoldDays() {
    return { days: await this.financialSettings.getPayoutHoldDays() };
  }

  @Put("security/payout-hold-days")
  async setPayoutHoldDays(
    @Body() dto: SetPayoutHoldDaysDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.financialSettings.setPayoutHoldDays(dto.days, ctxFrom(req, session));
    return { status: "ok" };
  }

  @Get("tax")
  async getTaxRate() {
    return (await this.taxRateSettings.getDefaultRate()) ?? { ratePercent: null, version: null };
  }

  @Put("tax")
  async setTaxRate(
    @Body() dto: SetDefaultTaxRateDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.taxRateSettings.setDefaultRate(dto.ratePercent, ctxFrom(req, session));
  }

  @Get("media-policy")
  getMediaPolicy() {
    return this.mediaPolicy.getPolicy();
  }

  @Put("media-policy")
  async setMediaPolicy(
    @Body() dto: SetMediaPolicyDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.mediaPolicy.setPolicy(dto, ctxFrom(req, session));
    return { status: "ok" };
  }

  @Get("opportunity")
  getOpportunitySettings() {
    return this.opportunitySettings.getConfig();
  }

  @Put("opportunity")
  async setOpportunitySettings(
    @Body() dto: SetOpportunitySettingsDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.opportunitySettings.setConfig(dto, ctxFrom(req, session));
    return { status: "ok" };
  }

  @Get("share-tiers")
  getShareTierPolicy() {
    return this.shareTierSettings.getCurrentPolicy();
  }

  @Put("share-tiers")
  setShareTierPolicy(
    @Body() dto: SetShareTierPolicyDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    const tiers = dto.tiers.map((t) => ({
      maxTotalValueInclTax: t.maxTotalValueInclTax ?? null,
      shareBasisPoints: t.shareBasisPoints,
    }));
    return this.shareTierSettings.setPolicy(tiers, ctxFrom(req, session));
  }

  @Get("commission")
  getCommissionPolicy() {
    return this.commissionPolicy.getCurrentPolicy();
  }

  @Put("commission")
  setCommissionPolicy(
    @Body() dto: SetCommissionPolicyDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.commissionPolicy.setPolicy(dto.rateBasisPoints, ctxFrom(req, session));
  }

  @Get("checkout")
  getCheckoutSettings() {
    return this.checkoutSettings.getConfig();
  }

  @Put("checkout")
  async setCheckoutSettings(
    @Body() dto: SetCheckoutSettingsDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.checkoutSettings.setConfig(dto, ctxFrom(req, session));
    return { status: "ok" };
  }

  @Get("shipping-tariff")
  getShippingTariff() {
    return this.shippingTariff.getCurrentPolicy();
  }

  @Put("shipping-tariff")
  setShippingTariff(
    @Body() dto: SetShippingTariffDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.shippingTariff.setPolicy(dto, ctxFrom(req, session));
  }

  @Get("commission-tax")
  getCommissionTax() {
    return this.commissionTaxPolicy.getCurrentPolicy();
  }

  @Put("commission-tax")
  setCommissionTax(
    @Body() dto: SetCommissionTaxDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    return this.commissionTaxPolicy.setPolicy(dto, ctxFrom(req, session));
  }

  @Get("payment")
  getPaymentSettings() {
    return this.paymentSettings.getConfig();
  }

  @Put("payment")
  async setPaymentSettings(
    @Body() dto: SetPaymentSettingsDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.paymentSettings.setConfig(dto, ctxFrom(req, session));
    return { status: "ok" };
  }

  @Get("fulfillment")
  getFulfillmentSettings() {
    return this.fulfillmentSettings.getConfig();
  }

  @Put("fulfillment")
  async setFulfillmentSettings(
    @Body() dto: SetFulfillmentSettingsDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.fulfillmentSettings.setConfig(dto, ctxFrom(req, session));
    return { status: "ok" };
  }

  @Get(":key")
  get(@Param("key") key: string) {
    return this.settings.get(key);
  }

  @Put(":key")
  async set(
    @Param("key") key: string,
    @Body() dto: SetSystemSettingDto,
    @CurrentAdminSession() session: AdminSessionData,
    @Req() req: Request
  ) {
    await this.settings.setValue(key, dto.value, ctxFrom(req, session));
    return { status: "ok" };
  }
}
