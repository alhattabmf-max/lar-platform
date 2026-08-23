import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AdminBankAccountItem,
  AdminCompanyItem,
  AdminProductItem,
  Paginated,
} from "@platform/types";
import { PrismaService } from "../../database/prisma.service";

/**
 * The admin read surfaces that had no endpoint at all.
 *
 * Companies, products and bank-account history. Each existed only as a
 * pending-review slice or not at all, which left several write actions
 * reachable only by already knowing an id.
 *
 * Every one is a CLOSED projection. Not one selects a password hash, an
 * IBAN ciphertext or blind index, a storage object key, or a session
 * value — not selecting is stronger than not mapping, and a later
 * refactor that spreads a row cannot leak a column the query never
 * asked for.
 */

interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}

function paging(query: ListQuery) {
  const page = Math.max(1, query.page ?? 1);
  // Capped. An admin list is unbounded where a supplier's is not, and an
  // uncapped page size is a way to ask for the whole table.
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

const COMPANY_SELECT = {
  id: true,
  legalName: true,
  crNumber: true,
  accountType: true,
  verificationStatus: true,
  createdAt: true,
  // The owner's address — who an operator would contact. One user, not
  // the whole roster: a company's user list is its own surface if it is
  // ever needed, and embedding it here would put every member's email
  // into a directory page.
  users: {
    select: { email: true },
    where: { role: "OWNER" as const },
    take: 1,
    orderBy: { createdAt: "asc" as const },
  },
  _count: { select: { users: true } },
} satisfies Prisma.CompanySelect;

const PRODUCT_SELECT = {
  id: true,
  companyId: true,
  nameAr: true,
  nameEn: true,
  approvalStatus: true,
  rejectionReason: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  company: { select: { legalName: true } },
  // A COUNT, never the media rows: those carry `objectKey` and
  // `thumbnailObjectKey`.
  _count: { select: { media: true } },
} satisfies Prisma.ProductSelect;

const BANK_ACCOUNT_SELECT = {
  id: true,
  companyId: true,
  accountHolderName: true,
  bankName: true,
  // The LAST FOUR and nothing else. The stored IBAN is encrypted; its
  // ciphertext and blind-index fingerprint are not selected, and
  // `BankDataCryptoService.decrypt` is reachable from no HTTP path.
  ibanLast4: true,
  verificationStatus: true,
  rejectionReason: true,
  verifiedAt: true,
  createdAt: true,
  company: { select: { legalName: true } },
} satisfies Prisma.SupplierBankAccountSelect;

@Injectable()
export class AdminDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listCompanies(
    query: ListQuery & { accountType?: string; verificationStatus?: string }
  ): Promise<Paginated<AdminCompanyItem>> {
    const { page, pageSize, skip, take } = paging(query);

    const search = query.search?.trim();
    const where: Prisma.CompanyWhereInput = {
      ...(search
        ? {
            OR: [
              { legalName: { contains: search, mode: "insensitive" as const } },
              { crNumber: { contains: search } },
            ],
          }
        : {}),
      ...(query.accountType ? { accountType: query.accountType as never } : {}),
      ...(query.verificationStatus
        ? { verificationStatus: query.verificationStatus as never }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        select: COMPANY_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip,
        take,
      }),
      this.prisma.company.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        legalName: row.legalName,
        crNumber: row.crNumber,
        accountType: row.accountType as AdminCompanyItem["accountType"],
        verificationStatus:
          row.verificationStatus as AdminCompanyItem["verificationStatus"],
        ownerEmail: row.users[0]?.email ?? null,
        userCount: row._count.users,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  async listProducts(
    query: ListQuery & { approvalStatus?: string; companyId?: string; archived?: boolean }
  ): Promise<Paginated<AdminProductItem>> {
    const { page, pageSize, skip, take } = paging(query);

    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = {
      ...(search
        ? {
            OR: [
              { nameAr: { contains: search, mode: "insensitive" as const } },
              { nameEn: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(query.approvalStatus ? { approvalStatus: query.approvalStatus as never } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      // Explicit tri-state: undefined means "either", which is not the
      // same as false.
      ...(query.archived === undefined
        ? {}
        : query.archived
          ? { archivedAt: { not: null } }
          : { archivedAt: null }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: PRODUCT_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        companyId: row.companyId,
        companyLegalName: row.company.legalName,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        approvalStatus: row.approvalStatus,
        rejectionReason: row.rejectionReason,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        mediaCount: row._count.media,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  /**
   * Every submitted bank account, not just the pending ones.
   *
   * The table is append-only history — a superseded row is kept — so an
   * operator investigating "where did this payout go" needs the whole
   * sequence, not the current row.
   */
  async listBankAccounts(
    query: ListQuery & { verificationStatus?: string; companyId?: string }
  ): Promise<Paginated<AdminBankAccountItem>> {
    const { page, pageSize, skip, take } = paging(query);

    const search = query.search?.trim();
    const where: Prisma.SupplierBankAccountWhereInput = {
      ...(search
        ? {
            OR: [
              { accountHolderName: { contains: search, mode: "insensitive" as const } },
              { bankName: { contains: search, mode: "insensitive" as const } },
              { company: { legalName: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
      ...(query.verificationStatus
        ? { verificationStatus: query.verificationStatus as never }
        : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.supplierBankAccount.findMany({
        where,
        select: BANK_ACCOUNT_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip,
        take,
      }),
      this.prisma.supplierBankAccount.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        companyId: row.companyId,
        companyLegalName: row.company.legalName,
        accountHolderName: row.accountHolderName,
        bankName: row.bankName,
        ibanLast4: row.ibanLast4,
        verificationStatus:
          row.verificationStatus as AdminBankAccountItem["verificationStatus"],
        rejectionReason: row.rejectionReason,
        verifiedAt: row.verifiedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }
}
