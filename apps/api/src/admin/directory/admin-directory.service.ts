import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  COMPANY_OPERATIONAL_STATUSES,
  verificationStatusesFor,
  type CompanyOperationalStatus,
} from "@platform/types";
import type {
  AdminBankAccountItem,
  AdminCompanyItem,
  AdminCompanyName,
  AdminCompanyTabCounts,
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

/**
 * The companies predicate, in ONE place.
 *
 * The list, the tab counts and the export all narrow by the same
 * things, and three copies of this is three chances for the number on a
 * tab to disagree with the rows under it — or for an export to carry
 * rows the table on screen was not showing.
 */
export function companyWhere(query: {
  search?: string;
  accountType?: string;
  verificationStatus?: string;
  operationalStatus?: string;
  registeredFrom?: string;
  registeredTo?: string;
}): Prisma.CompanyWhereInput {
  const search = query.search?.trim();

  // Built first so an unrecognised value contributes nothing at all,
  // rather than an empty `AND` that reads as a condition and is not one.
  const status: Prisma.CompanyWhereInput[] = [];
  if (query.verificationStatus) {
    status.push({ verificationStatus: query.verificationStatus as never });
  }
  // FROM THE SAME FUNCTION THE BADGE USES. This filter used to read
  // ACTIVE as "anything but suspended", which returned every
  // supplier still waiting to be reviewed — rows the list then drew
  // a «نشطة» badge on. One definition now, so a filtered list and
  // the badges in it cannot contradict each other.
  if (
    query.operationalStatus &&
    (COMPANY_OPERATIONAL_STATUSES as readonly string[]).includes(
      query.operationalStatus
    )
  ) {
    status.push({
      verificationStatus: {
        in: verificationStatusesFor(
          query.operationalStatus as CompanyOperationalStatus
        ) as never,
      },
    });
  }

  return {
    ...(search
      ? {
          OR: [
            { legalName: { contains: search, mode: "insensitive" as const } },
            { crNumber: { contains: search } },
          ],
        }
      : {}),
    ...(query.accountType ? { accountType: query.accountType as never } : {}),
    // BOTH STATUS FILTERS READ THE SAME COLUMN, so they are combined
    // with AND rather than written as two keys of one object — the
    // second key would silently replace the first, and an operator
    // asking for "pending AND running" would get every company that is
    // not suspended, including the verified and the rejected.
    //
    // RUNNING IS "NOT SUSPENDED": the column holds one value at a time,
    // a verified company and a pending one are both operating, and only
    // `SUSPENDED` says otherwise.
    //
    // A CONTRADICTION RETURNS NOTHING, which is the truthful answer:
    // "suspended AND pending verification" describes no company,
    // because the one column cannot hold both.
    ...(status.length > 0 ? { AND: status } : {}),
    ...(query.registeredFrom || query.registeredTo
      ? {
          createdAt: {
            ...(query.registeredFrom
              ? { gte: new Date(`${query.registeredFrom}T00:00:00.000Z`) }
              : {}),
            // INCLUSIVE of the day named: a reader who picks the 25th
            // means everything registered that day, and `lte` on
            // midnight would return only the first instant of it.
            ...(query.registeredTo
              ? { lte: new Date(`${query.registeredTo}T23:59:59.999Z`) }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * WHAT A CHOOSER MAY EVER RECEIVE.
 *
 * Fifty is the ceiling and twenty the default: a typeahead shows a
 * handful, and a list longer than a screen is not being read, it is
 * being scrolled past. The point of the cap is that this answer stays
 * the same size whether the platform holds seventy companies or seventy
 * thousand.
 */
const MAX_COMPANY_NAME_RESULTS = 50;
const DEFAULT_COMPANY_NAME_RESULTS = 20;

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
  // NO `_count` HERE. See `countsForPage` — Prisma compiles a relation
  // count into a LEFT JOIN against a subquery that aggregates the WHOLE
  // table, and it does that BEFORE the LIMIT applies.
} satisfies Prisma.CompanySelect;

/**
 * THE THREE NUMBERS BESIDE EACH COMPANY, COUNTED FOR THE PAGE ONLY.
 *
 * THE DEFECT THIS REPLACES, measured at 70,000 companies. The select
 * above carried `_count: { users, products, opportunities }`, and
 * Prisma compiles each of those into
 *
 *     LEFT JOIN (SELECT company_id, COUNT(*) FROM users
 *                GROUP BY company_id) …
 *
 * — three subqueries that read and group EVERY user, EVERY product and
 * EVERY opportunity on the platform, joined before `LIMIT 20` is
 * reached. So drawing twenty rows aggregated 238,000, and the ordering
 * index could not be used at all: the plan was three sequential scans
 * and three hash aggregates, 271 ms of database time, growing with the
 * platform for ever.
 *
 * COUNTED FOR THE PAGE'S IDS INSTEAD — three grouped counts over the
 * twenty ids the page actually shows. This is the SAME shape the order
 * count below already used, and its comment already said why: one query
 * for the page rather than one per row.
 *
 * Absent from the map means none: `groupBy` returns no row for a
 * company with nothing to count, and the callers read it as zero.
 */
async function countsForPage(
  prisma: PrismaService,
  companyIds: string[],
): Promise<{
  users: Map<string, number>;
  products: Map<string, number>;
  opportunities: Map<string, number>;
}> {
  const empty = { users: new Map(), products: new Map(), opportunities: new Map() };
  if (companyIds.length === 0) return empty;

  const where = { companyId: { in: companyIds } };
  const [users, products, opportunities] = await Promise.all([
    prisma.user.groupBy({ by: ["companyId"], where, _count: { _all: true } }),
    prisma.product.groupBy({ by: ["companyId"], where, _count: { _all: true } }),
    prisma.opportunity.groupBy({ by: ["companyId"], where, _count: { _all: true } }),
  ]);

  const toMap = (rows: { companyId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((row) => [row.companyId, row._count._all]));

  return {
    users: toMap(users),
    products: toMap(products),
    opportunities: toMap(opportunities),
  };
}

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
  // `thumbnailObjectKey` — and it is counted for the page, not
  // selected here. See `mediaCountsForPage`.
} satisfies Prisma.ProductSelect;

/**
 * HOW MANY IMAGES EACH PRODUCT ON THIS PAGE HAS.
 *
 * The same defect as `countsForPage`, in the same file, for the same
 * reason: `_count: { media: true }` compiles to a LEFT JOIN against
 * `SELECT product_id, COUNT(*) FROM product_media GROUP BY product_id`,
 * which is evaluated before `LIMIT 20`.
 *
 * MEASURED WITH AN EMPTY MEDIA TABLE, at 126,000 products: 38 ms and a
 * parallel sequential scan, because the join makes the ordering index
 * unusable. With real images behind it the aggregate grows too.
 */
async function mediaCountsForPage(
  prisma: PrismaService,
  productIds: string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await prisma.productMedia.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.productId, row._count._all]));
}

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

  /**
   * NAMES FOR A CHOOSER — the ones that MATCH, never all of them.
   *
   * For a chooser — «خيار اختيار اسم المنشأة» — and for nothing else.
   * The register's own row carries the registration, the state, four
   * counts and two totals; a dropdown needs two columns, and building
   * it from the register would make filling a list the most expensive
   * read on the console.
   *
   * IT USED TO BE UNPAGED, and the reasoning was that a chooser which
   * stops at a page silently cannot find half the platform. The reasoning
   * was right about the SYMPTOM and wrong about the cure: measured at
   * 70,000 companies the whole list was 5.8 MB and 994 ms, fetched with
   * `no-store` by three separate console pages, so merely opening the
   * products screen cost six megabytes before anyone typed anything.
   *
   * THE CHOOSER ASKS THE SERVER INSTEAD. A search term comes in, at most
   * fifty names go out, and nothing the operator is looking for is out
   * of reach — because the filter runs across the whole table rather
   * than across a page of it. What is bounded is the ANSWER, not the
   * search.
   *
   * THE CAP IS THE SERVICE'S, not the caller's. A request asking for
   * five thousand gets fifty; the ceiling cannot be lifted from outside,
   * which is what stops this becoming the old behaviour again by way of
   * a query string.
   *
   * ORDERED BY NAME, terminating in the primary key so two companies
   * sharing a legal name cannot swap places between requests.
   */
  async listCompanyNames(
    accountType?: string,
    search?: string,
    limit?: number,
  ): Promise<AdminCompanyName[]> {
    const take = Math.min(MAX_COMPANY_NAME_RESULTS, Math.max(1, limit ?? DEFAULT_COMPANY_NAME_RESULTS));
    const term = search?.trim();

    const rows = await this.prisma.company.findMany({
      where: {
        ...(accountType ? { accountType: accountType as never } : {}),
        // THE REGISTRATION NUMBER TOO, because an operator holding a CR
        // number in a spreadsheet has no name to type.
        ...(term
          ? {
              OR: [
                { legalName: { contains: term, mode: "insensitive" as const } },
                { crNumber: { contains: term, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: { id: true, legalName: true },
      orderBy: [{ legalName: "asc" }, { id: "asc" }],
      take,
    });
    return rows;
  }

  async listCompanies(
    query: ListQuery & {
      accountType?: string;
      verificationStatus?: string;
      operationalStatus?: string;
      registeredFrom?: string;
      registeredTo?: string;
    },
  ): Promise<Paginated<AdminCompanyItem>> {
    const { page, pageSize, skip, take } = paging(query);

    const where = companyWhere(query);

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

    // ORDERS ARE COUNTED SEPARATELY, and only for the buyers' table.
    // `master_orders.trader_company_id` carries no foreign key to
    // `companies`, so Prisma has no relation to `_count` — a grouped
    // count over the page's ids is the honest way to get the number,
    // and it is one query for the page rather than one per row.
    const pageIds = rows.map((row) => row.id);
    const counts = await countsForPage(this.prisma, pageIds);

    const wantsOrders = query.accountType !== "SUPPLIER";
    const orderCounts = wantsOrders
      ? await this.prisma.masterOrder.groupBy({
          by: ["traderCompanyId"],
          where: { traderCompanyId: { in: pageIds } },
          _count: { _all: true },
        })
      : [];
    const ordersById = new Map(
      orderCounts.map((entry) => [entry.traderCompanyId, entry._count._all]),
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        legalName: row.legalName,
        crNumber: row.crNumber,
        accountType: row.accountType as AdminCompanyItem["accountType"],
        verificationStatus:
          row.verificationStatus as AdminCompanyItem["verificationStatus"],
        ownerEmail: row.users[0]?.email ?? null,
        userCount: counts.users.get(row.id) ?? 0,
        createdAt: row.createdAt.toISOString(),
        // NULL WHERE NOT ASKED FOR. A supplier row shows products and
        // opportunities; a buyer row shows orders. Sending a zero for a
        // column that was never counted would read as "none".
        orderCount: wantsOrders ? (ordersById.get(row.id) ?? 0) : null,
        productCount:
          query.accountType === "SUPPLIER"
            ? (counts.products.get(row.id) ?? 0)
            : null,
        opportunityCount:
          query.accountType === "SUPPLIER"
            ? (counts.opportunities.get(row.id) ?? 0)
            : null,
      })),
      page,
      pageSize,
      total,
    };
  }

  /**
   * How many companies each tab holds under the CURRENT search.
   *
   * The account type is deliberately excluded from the predicate: the
   * number on a tab has to describe what switching to it would show,
   * not what the tab you are already on holds.
   */
  async countCompanyTabs(query: {
    search?: string;
    verificationStatus?: string;
    operationalStatus?: string;
    registeredFrom?: string;
    registeredTo?: string;
  }): Promise<AdminCompanyTabCounts> {
    // The account type is deliberately left OUT of the shared part: a
    // tab's badge has to say what switching to it would show.
    const shared = companyWhere({
      ...query,
      accountType: undefined,
      verificationStatus: undefined,
    });

    const [traders, suppliers] = await Promise.all([
      this.prisma.company.count({
        where: { ...shared, accountType: "TRADER" },
      }),
      this.prisma.company.count({
        where: {
          ...shared,
          accountType: "SUPPLIER",
          // Verification belongs to the suppliers' tab alone, so it
          // narrows that count and never the buyers'.
          ...(query.verificationStatus
            ? { verificationStatus: query.verificationStatus as never }
            : {}),
        },
      }),
    ]);

    return { traders, suppliers };
  }

  async listProducts(
    query: ListQuery & {
      approvalStatus?: string;
      companyId?: string;
      archived?: boolean;
    },
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
      ...(query.approvalStatus
        ? { approvalStatus: query.approvalStatus as never }
        : {}),
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

    const mediaCounts = await mediaCountsForPage(
      this.prisma,
      rows.map((row) => row.id),
    );

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
        mediaCount: mediaCounts.get(row.id) ?? 0,
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
    query: ListQuery & { verificationStatus?: string; companyId?: string },
  ): Promise<Paginated<AdminBankAccountItem>> {
    const { page, pageSize, skip, take } = paging(query);

    const search = query.search?.trim();
    const where: Prisma.SupplierBankAccountWhereInput = {
      ...(search
        ? {
            OR: [
              {
                accountHolderName: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              { bankName: { contains: search, mode: "insensitive" as const } },
              {
                company: {
                  legalName: { contains: search, mode: "insensitive" as const },
                },
              },
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
