import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import type { Env } from "@platform/config";
import { IntegrationCenterService } from "./integration-center.service";
import { APP_ENV } from "../../config/app-config.module";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";

@Controller("admin/integrations")
@UseGuards(AdminSessionAuthGuard)
export class IntegrationCenterController {
  constructor(
    private readonly integrations: IntegrationCenterService,
    @Inject(APP_ENV) private readonly env: Env
  ) {}

  @Get()
  list() {
    return this.integrations.list(this.env);
  }
}
