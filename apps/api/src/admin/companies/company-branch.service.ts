import { Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { ERROR_CODES } from "@platform/types";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { BusinessException } from "../../common/errors/business-exception";
import { resolveShareLink, type MapLinkFetcher } from "./map-link-resolver";
import { coordinatesFromMapUrl } from "../../common/geo/map-link";
import {
  SENTINEL_CITY_ID,
  SENTINEL_REGION_ID,
} from "../../geography/sentinel.constants";

/**
 * A company's branches, edited from the console.
 *
 * NO SECOND FACTOR. A branch is an address and a telephone number:
 * getting one wrong is a correctable mistake, not a change of identity,
 * and asking for a code every time an operator fixes a typo teaches
 * people to keep the authenticator open — which is the habit that makes
 * the code worthless where it matters.
 *
 * EVERY CHANGE IS RECORDED with its before and after, so a wrong address
 * can be traced to who typed it and when.
 *
 * NO DELETE. A branch that has taken deliveries is referenced by orders
 * and allocations, and removing it would orphan them. Deactivating is
 * the operation this console offers, and the requirement asked for
 * adding and editing — so nothing here removes a row.
 */

/**
 * The parser moved to `common/geo/map-link.ts` when the company gained
 * its own branch form. Re-exported here so this module keeps its name
 * for it, and so the spec that tests it against this file still does.
 */
export { coordinatesFromMapUrl } from "../../common/geo/map-link";

interface Ctx {
  actorId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface BranchInput {
  name: string;
  /** Required: the region is where a branch is. */
  regionId: string;
  /** Optional; null clears it. Must be active and under `regionId`. */
  cityId?: string | null;
  shortAddress: string;
  contactName: string;
  contactPhone: string;
  /** A pasted Google Maps link, or a bare `lat,lng`. */
  mapUrl?: string;
}

@Injectable()
export class CompanyBranchService {
  /**
   * How the share link is followed.
   *
   * A property rather than a constructor parameter so Nest keeps
   * injecting the two services it knows about, while a test can put a
   * stub here and never open a socket.
   */
  fetcher: MapLinkFetcher | undefined = undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(companyId: string, input: BranchInput, ctx: Ctx) {
    const coordinates = await this.requireCoordinates(input.mapUrl, true);

    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { id: true },
      });
      if (!company) throw new NotFoundException("Company not found");

      await this.requirePlace(tx, input.regionId, input.cityId);

      const branch = await tx.companyLocation.create({
        data: {
          companyId,
          name: input.name.trim(),
          regionId: input.regionId,
          cityId: input.cityId ?? null,
          shortAddress: input.shortAddress.trim(),
          contactName: input.contactName.trim(),
          contactPhone: input.contactPhone.trim(),
          latitude: coordinates!.latitude,
          longitude: coordinates!.longitude,
        },
        select: { id: true, name: true },
      });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "COMPANY_BRANCH_ADDED",
          entityType: "company_location",
          entityId: branch.id,
          companyId,
          after: { name: branch.name, shortAddress: input.shortAddress.trim() },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return { id: branch.id };
    });
  }

  async update(
    companyId: string,
    branchId: string,
    input: Partial<BranchInput>,
    ctx: Ctx,
  ) {
    const coordinates = await this.requireCoordinates(input.mapUrl, false);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.companyLocation.findFirst({
        // SCOPED TO THE COMPANY, not just to the id: a branch id from
        // one company must not be editable from another's page.
        where: { id: branchId, companyId },
        select: {
          id: true,
          name: true,
          shortAddress: true,
          contactName: true,
          contactPhone: true,
          regionId: true,
          cityId: true,
        },
      });
      if (!existing) throw new NotFoundException("Branch not found");

      /**
       * THE PAIR IS RESOLVED FIRST, then validated as a pair.
       *
       * Moving a branch to another region while saying nothing about
       * its city would otherwise leave a Riyadh city under a Tabuk
       * region — and the database's trigger would refuse the write with
       * a message about a constraint rather than a sentence an operator
       * can act on.
       *
       * ONLY WHEN THE PLACE ACTUALLY CHANGES. A region or a city
       * switched off after this branch was opened must not lock an
       * operator out of correcting its telephone number.
       */
      const nextRegionId = input.regionId ?? existing.regionId;
      const nextCityId =
        input.cityId === undefined ? existing.cityId : input.cityId;
      const placeChanged =
        nextRegionId !== existing.regionId || nextCityId !== existing.cityId;
      if (placeChanged) {
        await this.requirePlace(tx, nextRegionId, nextCityId);
      }

      const data = {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(placeChanged ? { regionId: nextRegionId, cityId: nextCityId } : {}),
        ...(input.shortAddress !== undefined
          ? { shortAddress: input.shortAddress.trim() }
          : {}),
        ...(input.contactName !== undefined
          ? { contactName: input.contactName.trim() }
          : {}),
        ...(input.contactPhone !== undefined
          ? { contactPhone: input.contactPhone.trim() }
          : {}),
        ...(coordinates
          ? { latitude: coordinates.latitude, longitude: coordinates.longitude }
          : {}),
      };

      if (Object.keys(data).length === 0) {
        throw new BusinessException(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          "Nothing to change",
        );
      }

      await tx.companyLocation.update({ where: { id: branchId }, data });

      await this.audit.log(
        {
          actorType: AuditActorType.ADMIN,
          actorId: ctx.actorId,
          action: "COMPANY_BRANCH_UPDATED",
          entityType: "company_location",
          entityId: branchId,
          companyId,
          // BEFORE AND AFTER, so a wrong address can be traced.
          before: {
            name: existing.name,
            shortAddress: existing.shortAddress,
            contactName: existing.contactName,
            contactPhone: existing.contactPhone,
          },
          after: {
            name: data.name ?? existing.name,
            shortAddress: data.shortAddress ?? existing.shortAddress,
            contactName: data.contactName ?? existing.contactName,
            contactPhone: data.contactPhone ?? existing.contactPhone,
          },
          requestId: ctx.requestId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return { id: branchId };
    });
  }

  /**
   * A link is required to CREATE and optional to EDIT.
   *
   * A branch cannot exist without a position — the columns are not
   * nullable — but an operator fixing a telephone number should not
   * have to re-paste a map link that is already correct.
   */
  private async requireCoordinates(
    mapUrl: string | undefined,
    mandatory: boolean,
  ) {
    if (mapUrl === undefined || mapUrl.trim() === "") {
      if (!mandatory) return null;
      throw new BusinessException(
        400,
        ERROR_CODES.BRANCH_LOCATION_UNREADABLE,
        "A Google Maps link is required",
      );
    }

    // The straightforward case first: a link that already carries the
    // numbers costs no request at all.
    const direct = coordinatesFromMapUrl(mapUrl);
    if (direct) return direct;

    // A SHARE LINK. This is what the "share" button produces, and an
    // operator has no reason to know it is different from the one in
    // the address bar. The redirect is followed here so they do not
    // have to do it by hand.
    const resolved = await resolveShareLink(mapUrl, this.fetcher);
    const followed = resolved ? coordinatesFromMapUrl(resolved) : null;
    if (followed) return followed;

    throw new BusinessException(
      400,
      ERROR_CODES.BRANCH_LOCATION_UNREADABLE,
      "That link could not be read as a place",
    );
  }

  /**
   * Where a branch is — the region, required, and the city beneath it,
   * optional. The same guard the self-serve path applies in
   * `companies.service.ts`.
   *
   * ONE GUARD FOR BOTH, because the two are not independent: a city is
   * only valid if it sits under the region the branch claims. Checking
   * them separately is how a branch ends up in Tabuk with a Jeddah
   * address.
   *
   * WHAT THIS USED TO GET WRONG. It checked only that a city ROW
   * EXISTED, so a console call could attach a branch to a city the
   * platform had switched off, and to the Sentinel city itself — a
   * live branch reporting its address as «غير محدد», offered to a
   * buyer choosing where to take delivery.
   *
   * ONLY ON A CHANGE. The caller runs this when a branch is created
   * and when its place actually changes — never on an unrelated edit —
   * so correcting the telephone number of a branch whose region was
   * deactivated years ago still works.
   *
   * The database enforces the pairing too, with a trigger. This exists
   * so an operator gets a sentence rather than a constraint violation.
   */
  private async requirePlace(
    tx: {
      region: { findUnique: (args: never) => Promise<{ isActive: boolean } | null> };
      city: {
        findUnique: (
          args: never,
        ) => Promise<{ isActive: boolean; regionId: string } | null>;
      };
    },
    regionId: string,
    cityId: string | null | undefined,
  ) {
    if (regionId === SENTINEL_REGION_ID) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "This region cannot be selected — please choose a valid region",
      );
    }
    const region = await tx.region.findUnique({
      where: { id: regionId },
      select: { id: true, isActive: true },
    } as never);
    if (!region) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Unknown region",
      );
    }
    if (!region.isActive) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Invalid or inactive region",
      );
    }

    // NO CITY IS A COMPLETE ANSWER — never defaulted to the Sentinel
    // and never to the region's first city.
    if (cityId === undefined || cityId === null) return;

    if (cityId === SENTINEL_CITY_ID) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "This city cannot be selected — please choose a valid city",
      );
    }
    const city = await tx.city.findUnique({
      where: { id: cityId },
      select: { id: true, isActive: true, regionId: true },
    } as never);
    if (!city) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Unknown city",
      );
    }
    if (!city.isActive) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Invalid or inactive city",
      );
    }
    if (city.regionId !== regionId) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "That city is not in the selected region",
      );
    }
  }
}
