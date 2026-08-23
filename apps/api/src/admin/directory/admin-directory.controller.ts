import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type {
  AdminBankAccountItem,
  AdminCompanyItem,
  AdminProductItem,
  Paginated,
} from "@platform/types";
import { AdminDirectoryService } from "./admin-directory.service";
import {
  AdminBankAccountsQueryDto,
  AdminCompaniesQueryDto,
  AdminProductsQueryDto,
} from "./dto/admin-list-query.dto";
import { AdminSessionAuthGuard } from "../admin-auth/admin-session-auth.guard";

/**
 * The admin read surfaces that had no endpoint.
 *
 * Read-only, so no `CsrfGuard` — the provider exempts safe methods and
 * adding it would suggest a write that is not here. The writes for these
 * areas already exist on their own controllers and are unchanged.
 */
@Controller("admin")
@UseGuards(AdminSessionAuthGuard)
export class AdminDirectoryController {
  constructor(private readonly directory: AdminDirectoryService) {}

  @Get("companies")
  companies(@Query() query: AdminCompaniesQueryDto): Promise<Paginated<AdminCompanyItem>> {
    return this.directory.listCompanies(query);
  }

  @Get("products")
  products(@Query() query: AdminProductsQueryDto): Promise<Paginated<AdminProductItem>> {
    return this.directory.listProducts(query);
  }

  /**
   * Every submitted bank account, not just the pending ones.
   *
   * The table is append-only history — a superseded row is kept — so an
   * operator investigating a payout needs the whole sequence, not just
   * whatever is current.
   */
  @Get("bank-accounts/history")
  bankAccounts(
    @Query() query: AdminBankAccountsQueryDto
  ): Promise<Paginated<AdminBankAccountItem>> {
    return this.directory.listBankAccounts(query);
  }
}
