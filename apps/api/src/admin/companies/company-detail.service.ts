import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AccountType,
  AuditActorType,
  BankAccountVerificationStatus,
  CompanyVerificationStatus,
  Prisma,
  UserStatus,
} from "@prisma/client";
import { ERROR_CODES, type AdminCompanyBankAccount } from "@platform/types";
import { normaliseEmail } from "../../common/security/email.util";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { SupplierVerificationRequestService } from "../../verification/supplier-verification-request.service";
import { BusinessException } from "../../common/errors/business-exception";

/**
 * One company, as the control panel needs to see it.
 *
 * WHAT IS DELIBERATELY ABSENT is the point of the `select` clauses
 * below. A supplier's IBAN is encrypted at rest and its blind index is
 * never read here; a user's password hash and every token are never
 * selected; a storage key is never returned. The rule is not "redact on
 * the way out" — it is that the query never asks.
 *
 * COUNTS RATHER THAN CONTENTS for orders, invoices and the rest. An
 * operator on this screen wants to know whether a company has fourteen
 * orders, not to read them here; the sections that own those records
 * are where they are read, with their own filters and their own
 * permissions. Pulling them in would also make this page's cost grow
 * with the biggest company on the platform.
 */
/**
 * The only keys an audit entry may show on this screen.
 *
 * An ALLOW-LIST, not a deny-list. A deny-list has to be updated every
 * time a new secret is written anywhere near an audit entry, and the
 * one time it is not is the time it leaks.
 */
const AUDIT_VISIBLE_KEYS = [
  "legalName",
  "crNumber",
  "ownerEmail",
  "primaryMobile1",
  "primaryMobile2",
  "name",
  "shortAddress",
  "contactName",
  "contactPhone",
  "verificationStatus",
  "accountType",
  "usersSuspended",
  "usersRestored",
] as const;

function narrowAuditData(value: unknown): Record<string, string> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;

  const source = value as Record<string, unknown>;
  const out: Record<string, string> = {};

  for (const key of AUDIT_VISIBLE_KEYS) {
    const entry = source[key];
    if (entry === undefined || entry === null) continue;
    if (typeof entry === "object") continue;
    out[key] = String(entry);
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * A branch's coordinates as a link, and nothing more.
 *
 * `maps?q=lat,lng` is the documented, stable form — no key, no
 * shortener, and nothing that expires. The values are formatted to six
 * decimal places because that is the column's own precision, and a
 * `Decimal` stringified raw can arrive with trailing zeros that make
 * one branch look different from an identical one.
 */
function mapUrlFor(
  latitude: Prisma.Decimal,
  longitude: Prisma.Decimal,
): string {
  const lat = Number(latitude).toFixed(6);
  const lng = Number(longitude).toFixed(6);
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/**
 * Every number recorded for a company, once each, in a useful order.
 *
 * THE OWNER'S FIRST, because that is who an operator rings when
 * something is wrong with the account itself; the named contacts
 * follow. Duplicates are dropped on the DIGITS rather than the text, so
 * `+966 55 123 4567` and `0551234567` do not both appear — the same
 * telephone written twice is not two ways to reach anyone.
 */
function gatherPhones(
  users: { role: string; primaryMobile1: string; primaryMobile2: string }[],
  contacts: { id: string; name: string; phone: string; isActive: boolean }[],
): {
  value: string;
  source: "OWNER_PRIMARY" | "OWNER_SECONDARY" | "CONTACT";
  contactId: string | null;
  label: string | null;
}[] {
  const owner = users.find((user) => user.role === "OWNER") ?? users[0];
  const out: {
    value: string;
    source: "OWNER_PRIMARY" | "OWNER_SECONDARY" | "CONTACT";
    contactId: string | null;
    label: string | null;
  }[] = [];
  const seen = new Set<string>();

  const add = (
    value: string,
    source: "OWNER_PRIMARY" | "OWNER_SECONDARY" | "CONTACT",
    contactId: string | null,
    label: string | null,
  ) => {
    const trimmed = value?.trim() ?? "";
    if (trimmed === "") return;
    const digits = trimmed.replace(/\D/g, "");
    if (digits === "" || seen.has(digits)) return;
    seen.add(digits);
    out.push({ value: trimmed, source, contactId, label });
  };

  if (owner) {
    add(owner.primaryMobile1, "OWNER_PRIMARY", null, null);
    add(owner.primaryMobile2, "OWNER_SECONDARY", null, null);
  }
  for (const contact of contacts) {
    // A deactivated contact is not a way to reach anybody.
    if (!contact.isActive) continue;
    add(contact.phone, "CONTACT", contact.id, contact.name);
  }

  return out;
}

@Injectable()
export class CompanyDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly verificationRequests: SupplierVerificationRequestService,
  ) {}

  async findOne(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        crNumber: true,
        legalName: true,
        accountType: true,
        verificationStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!company) throw new NotFoundException("Company not found");

    const [
      users,
      contacts,
      locations,
      footprint,
      recentActivity,
      verification,
      bankRows,
    ] = await Promise.all([
      this.prisma.user.findMany({
        where: { companyId },
        // No `passwordHash`, no token relation. `passwordHash` is read
        // only as a BOOLEAN below, because whether an invited person has
        // claimed their account is something the screen must show and
        // the hash itself is something it must never receive.
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          emailVerificationStatus: true,
          passwordHash: true,
          statusBeforeCompanySuspension: true,
          // Registration records two, and both are ways to reach the
          // company — so both belong in the one contact field the
          // screen shows.
          primaryMobile1: true,
          primaryMobile2: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),

      this.prisma.companyContact.findMany({
        where: { companyId },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          isActive: true,
        },
      }),

      // THE COORDINATES ARE READ NOW, because the screen shows a
      // branch's location as a link a reader can open. They are not
      // rendered as numbers — they become one `maps?q=` URL and
      // nothing else — and they are the company's own address, which
      // an administrator looking at that company may see.
      this.prisma.companyLocation.findMany({
        where: { companyId },
        select: {
          id: true,
          name: true,
          shortAddress: true,
          regionId: true,
          cityId: true,
          contactName: true,
          contactPhone: true,
          isDefault: true,
          latitude: true,
          longitude: true,
          // Their own names, so the table does not print a UUID. The
          // region is always there; the city may not be.
          region: { select: { nameAr: true, nameEn: true } },
          city: { select: { nameAr: true, nameEn: true } },
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      }),

      this.countsAndTotals(companyId),
      this.recentActivity(companyId),
      // A buyer is never verified, and asking would only produce a
      // state that means nothing on its screen.
      company.accountType === AccountType.SUPPLIER
        ? this.verificationRequests.viewFor(companyId)
        : Promise.resolve(null),

      // THE PAYOUT ACCOUNT, on the page where the verification is
      // decided. The console could approve a supplier without ever
      // seeing the account that approval makes the payout account.
      //
      // TWO ROWS AT MOST: the one in force and the one waiting.
      // Neither carries the IBAN — `ibanCiphertext` and
      // `ibanFingerprint` are not selected, and the last four are
      // what an operator checks against the evidence.
      company.accountType === AccountType.SUPPLIER
        ? this.prisma.supplierBankAccount.findMany({
            where: {
              companyId,
              verificationStatus: {
                in: [
                  BankAccountVerificationStatus.VERIFIED,
                  BankAccountVerificationStatus.PENDING_VERIFICATION,
                ],
              },
            },
            select: {
              id: true,
              accountHolderName: true,
              bankName: true,
              ibanLast4: true,
              verificationStatus: true,
              rejectionReason: true,
              verifiedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
    ]);

    return {
      ...company,
      createdAt: company.createdAt.toISOString(),
      updatedAt: company.updatedAt.toISOString(),
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerificationStatus: user.emailVerificationStatus,
        primaryMobile1: user.primaryMobile1,
        primaryMobile2: user.primaryMobile2,
        // The ONE thing derived from the hash: has this person set a
        // password yet. NULL means an invited account nobody has
        // claimed, which login refuses.
        hasPassword: user.passwordHash !== null,
        suspendedByCompany: user.statusBeforeCompanySuspension !== null,
        createdAt: user.createdAt.toISOString(),
      })),
      contacts,
      locations: locations.map((location) => ({
        id: location.id,
        name: location.name,
        shortAddress: location.shortAddress,
        regionId: location.regionId,
        // Arabic when there is one; the English name is the fallback
        // rather than a blank cell.
        regionName: location.region.nameAr || location.region.nameEn,
        cityId: location.cityId,
        // NULL, NOT AN EMPTY STRING, when the branch names no city.
        // "" reads as a name nobody entered; null says there is none,
        // and the screen renders the region instead.
        cityName: location.city
          ? location.city.nameAr || location.city.nameEn
          : null,
        contactName: location.contactName,
        contactPhone: location.contactPhone,
        isDefault: location.isDefault,
        mapUrl: mapUrlFor(location.latitude, location.longitude),
      })),
      phones: gatherPhones(users, contacts),
      ownerEmail:
        users.find((user) => user.role === "OWNER")?.email ??
        users[0]?.email ??
        null,
      counts: footprint.counts,
      totals: footprint.totals,
      recentActivity,
      verification,
      bankAccounts: {
        active: toBankAccount(
          bankRows.find(
            (row) =>
              row.verificationStatus ===
              BankAccountVerificationStatus.VERIFIED,
          ),
        ),
        pending: toBankAccount(
          bankRows.find(
            (row) =>
              row.verificationStatus ===
              BankAccountVerificationStatus.PENDING_VERIFICATION,
          ),
        ),
      },
    };
  }

  /**
   * How much of the platform this company is entangled with.
   *
   * The same shapes the deletion check counts, plus the ones an
   * operator asks about. Read in one round trip.
   */
  private async countsAndTotals(companyId: string) {
    const [
      products,
      opportunities,
      ordersAsTrader,
      ordersAsSupplier,
      bankAccounts,
      productReports,
      checkoutSessions,
      policyAcceptances,
      disputes,
      purchases,
      payable,
    ] = await this.prisma.$transaction([
      this.prisma.product.count({ where: { companyId } }),
      this.prisma.opportunity.count({ where: { companyId } }),
      this.prisma.masterOrder.count({ where: { traderCompanyId: companyId } }),
      this.prisma.masterOrder.count({
        where: { supplierCompanyId: companyId },
      }),
      this.prisma.supplierBankAccount.count({ where: { companyId } }),
      this.prisma.productReport.count({
        where: { reporterCompanyId: companyId },
      }),
      this.prisma.checkoutSession.count({
        where: { traderCompanyId: companyId },
      }),
      this.prisma.policyAcceptance.count({ where: { companyId } }),
      // A dispute hangs off an ALLOCATION, not a company — reached
      // through the order it belongs to. Counting `companyId` directly
      // would be counting a column that does not exist.
      this.prisma.dispute.count({
        where: {
          orderAllocation: { masterOrder: { traderCompanyId: companyId } },
        },
      }),
      // MONEY IS SUMMED, NEVER RECOMPUTED. Both columns are written
      // once by the payment flow that owns the commission and tax
      // rules; this adds up what is already stored and derives nothing.
      this.prisma.masterOrder.aggregate({
        where: { traderCompanyId: companyId },
        _sum: { totalAmount: true },
      }),
      this.prisma.masterOrder.aggregate({
        where: { supplierCompanyId: companyId },
        _sum: { supplierPayableAmount: true },
      }),
    ]);

    return {
      counts: {
        products,
        opportunities,
        ordersAsTrader,
        ordersAsSupplier,
        bankAccounts,
        productReports,
        checkoutSessions,
        policyAcceptances,
        disputes,
      },
      totals: {
        // As a STRING. A 14,2 decimal does not survive a JavaScript
        // number, and a money figure that rounds on the way to a screen
        // is a money figure nobody can reconcile.
        purchases: (purchases._sum.totalAmount ?? 0).toString(),
        supplierPayable: (payable._sum.supplierPayableAmount ?? 0).toString(),
      },
    };
  }

  /**
   * What administrators have done to this company, most recent first.
   *
   * `beforeData` and `afterData` ARE returned, but narrowed to the
   * fields an administrator may edit — the same list the edit route
   * enforces. An operator reviewing a change needs to see what it
   * changed; what they must never see is a password hash, a token, a
   * two-factor secret or a storage key, and the allow-list below is
   * why none of those can appear rather than a filter that could be
   * forgotten.
   */
  async auditTrail(companyId: string, take: number) {
    return this.recentActivity(companyId, take);
  }

  private async recentActivity(companyId: string, take = 20) {
    const entries = await this.prisma.auditLog.findMany({
      where: {
        OR: [{ companyId }, { entityType: "company", entityId: companyId }],
      },
      select: {
        id: true,
        action: true,
        actorType: true,
        reason: true,
        createdAt: true,
        beforeData: true,
        afterData: true,
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    return entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actorType: entry.actorType,
      reason: entry.reason,
      createdAt: entry.createdAt.toISOString(),
      before: narrowAuditData(entry.beforeData),
      after: narrowAuditData(entry.afterData),
    }));
  }

  // ----- the ordinary edit -------------------------------------------

  /**
   * The one field an ordinary edit may change.
   *
   * Before and after are both written to the audit trail. `legalName`
   * carries nothing sensitive, so neither value is redacted — the rule
   * is that a sensitive field would not be editable here in the first
   * place.
   */
  /**
   * The ordinary edit: the name, the owner's address, the two mobiles.
   *
   * NO SECOND FACTOR. These are the corrections an operator makes on a
   * telephone call — a misspelt name, a new address — and demanding a
   * code for each one teaches people to keep an authenticator open all
   * day, which is exactly the habit that makes the code worthless on
   * the two operations that genuinely need it.
   *
   * THE REGISTRATION IS NOT REACHABLE FROM HERE. It is not a field of
   * this shape, so no request can set it however it is spelled.
   *
   * BEFORE AND AFTER ARE RECORDED for every field that moved, and only
   * for those: an entry claiming a change that did not happen is worse
   * than no entry.
   */
  async update(
    companyId: string,
    patch: {
      legalName?: string;
      crNumber?: string;
      ownerEmail?: string;
      primaryMobile1?: string;
      primaryMobile2?: string;
    },
    reason: string | undefined,
    ctx: {
      actorId: string;
      requestId: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          legalName: true,
          crNumber: true,
          verificationStatus: true,
        },
      });
      if (!company) throw new NotFoundException("Company not found");

      const owner = await tx.user.findFirst({
        where: { companyId, role: "OWNER" },
        select: {
          id: true,
          email: true,
          primaryMobile1: true,
          primaryMobile2: true,
        },
        orderBy: { createdAt: "asc" },
      });

      const before: Record<string, string> = {};
      const after: Record<string, string> = {};

      const legalName = patch.legalName?.trim();
      if (legalName && legalName !== company.legalName) {
        before.legalName = company.legalName;
        after.legalName = legalName;
        await tx.company.update({
          where: { id: companyId },
          data: { legalName },
        });
      }

      const crNumber = patch.crNumber?.trim();
      if (crNumber && crNumber !== company.crNumber) {
        // A VERIFIED COMPANY'S NUMBER IS WHAT WAS VERIFIED. Rewriting it
        // would leave a verification badge attached to a different
        // registered entity — which is a claim the platform would be
        // making on somebody else's behalf.
        if (company.verificationStatus === CompanyVerificationStatus.VERIFIED) {
          throw new BusinessException(
            409,
            ERROR_CODES.CONFLICT,
            "A verified company's commercial registration cannot be changed",
          );
        }

        // ONE REGISTRATION, ONE COMPANY. The column is unique, so a
        // clash would otherwise surface as a database error carrying no
        // explanation an operator could act on.
        const taken = await tx.company.findUnique({
          where: { crNumber },
          select: { id: true },
        });
        if (taken && taken.id !== companyId) {
          throw new BusinessException(
            409,
            ERROR_CODES.CONFLICT,
            "That commercial registration already belongs to another company",
          );
        }

        before.crNumber = company.crNumber;
        after.crNumber = crNumber;
        await tx.company.update({
          where: { id: companyId },
          data: { crNumber },
        });
      }

      // The SHARED normaliser, not a second `.trim().toLowerCase()`
      // that happens to look the same. One definition, so the console
      // and registration cannot come to disagree about what one address
      // is.
      const ownerEmail = patch.ownerEmail
        ? normaliseEmail(patch.ownerEmail)
        : undefined;
      const mobile1 = patch.primaryMobile1?.trim();
      const mobile2 = patch.primaryMobile2?.trim();

      if (owner && (ownerEmail || mobile1 || mobile2)) {
        const data: Record<string, string> = {};

        if (ownerEmail && ownerEmail !== normaliseEmail(owner.email)) {
          // ONE ADDRESS, ONE ACCOUNT. The column is unique, so a clash
          // would surface as a database error with no explanation an
          // operator could act on — this answers before that happens.
          const taken = await tx.user.findUnique({
            where: { email: ownerEmail },
            select: { id: true },
          });
          if (taken && taken.id !== owner.id) {
            throw new BusinessException(
              409,
              ERROR_CODES.CONFLICT,
              "That email address already belongs to another account",
            );
          }
          before.ownerEmail = owner.email;
          after.ownerEmail = ownerEmail;
          data.email = ownerEmail;
        }

        if (mobile1 && mobile1 !== owner.primaryMobile1) {
          before.primaryMobile1 = owner.primaryMobile1;
          after.primaryMobile1 = mobile1;
          data.primaryMobile1 = mobile1;
        }
        if (mobile2 && mobile2 !== owner.primaryMobile2) {
          before.primaryMobile2 = owner.primaryMobile2;
          after.primaryMobile2 = mobile2;
          data.primaryMobile2 = mobile2;
        }

        if (Object.keys(data).length > 0) {
          await tx.user.update({ where: { id: owner.id }, data });
        }
      }

      if (Object.keys(after).length === 0) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          "Nothing to change",
        );
      }

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "COMPANY_UPDATED",
          entityType: "company",
          entityId: companyId,
          companyId,
          reason,
          before,
          after,
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return { changed: Object.keys(after) };
    });
  }

  /** True when the ordinary edit must refuse a CR change outright. */
  static crNumberIsLocked(status: CompanyVerificationStatus): boolean {
    return status === CompanyVerificationStatus.VERIFIED;
  }

  /** True when a user may be moved by a company suspension. */
  static suspendable(status: UserStatus): boolean {
    return status === UserStatus.ACTIVE;
  }
}

/**
 * One bank account row, as the console reads it.
 *
 * DATES AS ISO STRINGS, like every other date in this shape. JSON would
 * serialise a `Date` the same way, but the contract says `string` and a
 * projection that only accidentally agrees with its contract is one
 * that stops agreeing the first time something reads it in process.
 *
 * NOTHING IS ADDED HERE. The select above already withholds the
 * ciphertext and the fingerprint; this maps what came back and no more.
 */
function toBankAccount(
  row:
    | {
        id: string;
        accountHolderName: string;
        bankName: string;
        ibanLast4: string;
        verificationStatus: string;
        rejectionReason: string | null;
        verifiedAt: Date | null;
        createdAt: Date;
      }
    | undefined,
): AdminCompanyBankAccount | null {
  if (!row) return null;
  return {
    id: row.id,
    accountHolderName: row.accountHolderName,
    bankName: row.bankName,
    ibanLast4: row.ibanLast4,
    verificationStatus: row.verificationStatus,
    rejectionReason: row.rejectionReason,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
