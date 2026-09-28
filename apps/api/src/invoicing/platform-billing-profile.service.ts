import { Injectable } from "@nestjs/common";
import { AuditActorType, Prisma } from "@prisma/client";
import type { PlatformBillingProfileVersion } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type {
  AdminPlatformBillingProfile,
  PlatformBillingAddress,
} from "@platform/types";
import { SHORT_ADDRESS_MAX } from "@platform/types";
import { normalizeDigitsAndWhitespace } from "../common/text/normalize-digits.util";

interface AdminActorContext {
  userId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

const SAUDI_VAT_NUMBER_PATTERN = /^\d{15}$/;

/**
 * A stored address blob, read as the declared shape.
 *
 * Prisma types a Json column as `JsonValue`: a string, a number and an
 * array are all legal values there, and versions written before the
 * shape was declared carry whatever they carried. Anything missing comes
 * back as an empty string so the form can ask for it, rather than the
 * screen breaking on a row a document still references.
 */
function readAddress(value: unknown): PlatformBillingAddress {
  const blob =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const text = (key: string) =>
    typeof blob[key] === "string" ? (blob[key] as string) : "";
  return {
    cityId: text("cityId"),
    cityNameAr: text("cityNameAr"),
    cityNameEn: text("cityNameEn"),
    shortAddress: text("shortAddress"),
  };
}
const MAX_LEGAL_NAME_LENGTH = 300;

export interface CreatePlatformBillingProfileInput {
  legalName: string;
  crNumber: string;
  isVatRegistered: boolean;
  vatNumber?: string;
  /**
   * A CITY ID AND A SHORT ADDRESS, not an arbitrary object.
   *
   * The city NAMES are absent on purpose: the service reads them from
   * the city row and snapshots them itself, so the name on a document
   * can never disagree with the city it claims to be.
   */
  addressSnapshot: { cityId: string; shortAddress: string };
}

/** How long a repeated create may be replayed rather than re-run. */
const IDEMPOTENCY_TTL_HOURS = 24;
const IDEMPOTENCY_SCOPE = "PLATFORM_BILLING_PROFILE";
const MAX_IDEMPOTENCY_RETRY = 3;

@Injectable()
export class PlatformBillingProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** The CURRENT (highest-version) profile, or null if none has ever been created. */
  /**
   * The platform's current billing identity.
   *
   * A CLOSED projection. `createdByAdminUserId` is not selected: who
   * created a version is an audit-log question rather than a field to
   * mirror onto every read.
   *
   * `addressSnapshot` IS selected, and returned exactly as stored. It
   * has no validated shape — the DTO takes any object — so nothing here
   * reshapes it. The screen that writes the next version needs to show
   * what the current one holds; without it, re-issuing the profile
   * would quietly drop the address, and versions are never edited.
   *
   * Returns null when no version has been created yet — a real state on
   * a fresh installation, and the screen says so rather than inventing
   * an empty profile.
   */
  async getCurrent(): Promise<AdminPlatformBillingProfile | null> {
    const row = await this.prisma.platformBillingProfileVersion.findFirst({
      select: {
        id: true,
        version: true,
        legalName: true,
        crNumber: true,
        isVatRegistered: true,
        vatNumber: true,
        addressSnapshot: true,
        createdAt: true,
      },
      orderBy: { version: "desc" },
    });
    if (!row) return null;

    return {
      id: row.id,
      version: row.version,
      legalName: row.legalName,
      crNumber: row.crNumber,
      isVatRegistered: row.isVatRegistered,
      vatNumber: row.vatNumber,
      // TOLERANT ON READ, STRICT ON WRITE. Versions written before the
      // address had a declared shape are still in the table and still
      // referenced by documents; refusing to read them would break the
      // screen rather than fix the data. Missing pieces come back as
      // empty strings, and the form then asks for a real address.
      addressSnapshot: readAddress(row.addressSnapshot),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listAll() {
    return this.prisma.platformBillingProfileVersion.findMany({ orderBy: { version: "desc" } });
  }

  /**
   * Creates a NEW version — never updates an existing one.
   *
   * IDEMPOTENT, and not by hiding a button. A double press, a retried
   * request after a timeout, or two operators saving at once would each
   * otherwise append a version, and versions are permanent. The key is
   * claimed with the same `INSERT … ON CONFLICT DO NOTHING` the other
   * ten services on this platform use; a repeat of the SAME request
   * replays the first result, and the same key carrying a DIFFERENT
   * request is a conflict rather than a silent second write.
   */
  async createNewVersion(
    input: CreatePlatformBillingProfileInput,
    ctx: AdminActorContext,
    idempotencyKey: string,
  ): Promise<PlatformBillingProfileVersion> {
    const clean = await this.validate(input);
    // The whole request, not just its name: the same key used for a
    // different profile must not quietly return the first one.
    const requestHash = JSON.stringify(clean);

    for (let attempt = 0; attempt < MAX_IDEMPOTENCY_RETRY; attempt += 1) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at, updated_at)
          VALUES (${IDEMPOTENCY_SCOPE}, ${idempotencyKey}, ${requestHash}, 'IN_PROGRESS', now() + interval '${Prisma.raw(String(IDEMPOTENCY_TTL_HOURS))} hours', now())
          ON CONFLICT (scope, key) DO NOTHING
          RETURNING id
        `;

        if (claimed.length > 0) {
          const created = await this.writeVersion(tx, clean, ctx);
          await tx.$executeRaw`
            UPDATE idempotency_keys
            SET status = 'COMPLETED', response_snapshot = ${JSON.stringify(created)}::jsonb, updated_at = now()
            WHERE scope = ${IDEMPOTENCY_SCOPE} AND key = ${idempotencyKey}
          `;
          return { kind: "created" as const, result: created };
        }

        const existing = await tx.$queryRaw<
          { status: string; request_hash: string; response_snapshot: unknown }[]
        >`SELECT status, request_hash, response_snapshot FROM idempotency_keys WHERE scope = ${IDEMPOTENCY_SCOPE} AND key = ${idempotencyKey} FOR UPDATE`;

        if (existing.length === 0) return { kind: "retry" as const };
        const row = existing[0];
        // Still running: another request holds the claim. Retrying is
        // right — the first one is about to finish or fail.
        if (row.status !== "COMPLETED") return { kind: "retry" as const };
        if (row.request_hash !== requestHash) {
          throw new BusinessException(
            409,
            ERROR_CODES.CONFLICT,
            "This idempotency key was already used with a different billing profile",
          );
        }
        // THE REPLAY CARRIES JSON, so its dates arrive as ISO strings
        // rather than Date objects — the same trade-off every other
        // idempotent write on this platform makes. Callers use the id
        // and the version, both of which survive the round trip intact.
        return {
          kind: "existing" as const,
          result: row.response_snapshot as PlatformBillingProfileVersion,
        };
      });

      if (outcome.kind !== "retry") return outcome.result;
    }

    throw new BusinessException(
      409,
      ERROR_CODES.CONFLICT,
      "Could not write the billing profile under concurrent load",
    );
  }

  /** The write itself, inside whatever transaction claimed the key. */
  private async writeVersion(
    tx: Prisma.TransactionClient,
    clean: {
      legalName: string;
      crNumber: string;
      isVatRegistered: boolean;
      vatNumber: string | null;
      address: PlatformBillingAddress;
    },
    ctx: AdminActorContext,
  ) {
    const latest = await tx.platformBillingProfileVersion.findFirst({
      orderBy: { version: "desc" },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const profile = await tx.platformBillingProfileVersion.create({
      data: {
        version: nextVersion,
        legalName: clean.legalName,
        crNumber: clean.crNumber,
        isVatRegistered: clean.isVatRegistered,
        vatNumber: clean.vatNumber,
        addressSnapshot: clean.address as unknown as Prisma.InputJsonValue,
        createdByAdminUserId: ctx.userId,
      },
    });

    await tx.auditLog.create({
      data: {
        // ADMIN, not USER. The platform's own billing identity is
        // written only from the admin console.
        actorType: AuditActorType.ADMIN,
        actorId: ctx.userId,
        action: "PLATFORM_BILLING_PROFILE_VERSION_CREATED",
        entityType: "platform_billing_profile_version",
        entityId: profile.id,
        afterData: {
          version: profile.version,
          isVatRegistered: profile.isVatRegistered,
          cityId: clean.address.cityId,
        },
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    await tx.outboxEvent.create({
      data: {
        eventType: "PLATFORM_BILLING_PROFILE_VERSION_CREATED",
        payload: { version: profile.version },
      },
    });

    return profile;
  }

  /**
   * Every bound, applied here as well as on the DTO.
   *
   * The DTO stops a malformed request at the edge; this is what decides,
   * because a rule enforced only at the edge is a rule the next caller
   * skips.
   */
  private async validate(input: CreatePlatformBillingProfileInput) {
    const legalName = input.legalName.trim();
    if (legalName.length === 0 || legalName.length > MAX_LEGAL_NAME_LENGTH) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, `legalName must be non-empty and at most ${MAX_LEGAL_NAME_LENGTH} characters`);
    }
    const crNumber = input.crNumber.trim();
    if (crNumber.length === 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "crNumber must not be empty");
    }

    let vatNumber: string | null = null;
    if (input.isVatRegistered) {
      const normalized = normalizeDigitsAndWhitespace(input.vatNumber ?? "");
      if (!SAUDI_VAT_NUMBER_PATTERN.test(normalized)) {
        throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "vatNumber is required and must be exactly 15 digits when isVatRegistered is true");
      }
      vatNumber = normalized;
    } else if (input.vatNumber && normalizeDigitsAndWhitespace(input.vatNumber).length > 0) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "vatNumber must not be provided when isVatRegistered is false");
    }

    /**
     * THE ADDRESS. `{}` used to satisfy `@IsObject()` outright, which
     * put an empty seller address one request away from a commission
     * document.
     */
    const shortAddress = input.addressSnapshot?.shortAddress?.trim() ?? "";
    if (shortAddress.length === 0 || shortAddress.length > SHORT_ADDRESS_MAX) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `shortAddress must be 1 to ${SHORT_ADDRESS_MAX} characters`,
      );
    }

    // THE CITY IS RESOLVED, NOT TRUSTED. An id that names no city, or
    // names a deactivated one, is refused — and the NAMES are read from
    // the row rather than taken from the request, so what a document
    // says a city is called can never disagree with the city it is.
    const cityId = input.addressSnapshot?.cityId ?? "";
    const city = await this.prisma.city.findUnique({
      where: { id: cityId },
      select: { id: true, nameAr: true, nameEn: true, isActive: true },
    });
    if (!city) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "cityId does not match any city",
      );
    }
    if (!city.isActive) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "cityId names a city that is no longer active",
      );
    }

    return {
      legalName,
      crNumber,
      isVatRegistered: input.isVatRegistered,
      vatNumber,
      address: {
        cityId: city.id,
        cityNameAr: city.nameAr,
        cityNameEn: city.nameEn,
        shortAddress,
      } satisfies PlatformBillingAddress,
    };
  }
}
