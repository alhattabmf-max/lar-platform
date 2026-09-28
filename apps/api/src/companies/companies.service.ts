import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { SupplierVerificationRequestService } from "../verification/supplier-verification-request.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { SENTINEL_CITY_ID, SENTINEL_REGION_ID } from "../geography/sentinel.constants";
import {
  coordinatesFromMapUrl,
  resolveShareLink,
  type MapLinkFetcher,
} from "../common/geo/map-link";
import type { CreateContactDto } from "./dto/create-contact.dto";
import type { UpdateContactDto } from "./dto/update-contact.dto";
import type { CreateLocationDto } from "./dto/create-location.dto";
import type { UpdateLocationDto } from "./dto/update-location.dto";

interface ActorContext {
  userId: string;
  companyId: string;
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * WHAT ONE COMPANY MAY DRAW OF ITS OWN, WITHOUT PAGING.
 *
 * These lists grow with a single company, never with the platform, and
 * both screens draw them whole because that is what they are for — a
 * branch picker with a pager is a worse branch picker.
 *
 * THE NUMBERS ARE CEILINGS, NOT PAGES. They exist so that no single
 * account can make the server build an unbounded response, and they sit
 * far above what a real company reaches: a company with two hundred
 * branches is a company nobody has, and if one ever appears these
 * screens need a pager rather than a larger number.
 */
const MAX_OWN_ROWS = {
  branches: 200,
  contacts: 100,
} as const;

@Injectable()
export class CompaniesService {
  /**
   * The record is closed while its review is open.
   *
   * ONE HELPER FOR EVERY EDITABLE PART, so a section added later
   * cannot quietly stay editable through a review. Editing a branch
   * halfway through would mean an administrator approving a record
   * that has since changed under them.
   *
   * READS are untouched: a supplier may look at everything it sent.
   */
  private async assertEditable(companyId: string): Promise<void> {
    await this.verificationRequests.assertNotUnderReview(companyId);
  }

  /**
   * How a share link is followed.
   *
   * A property rather than a constructor parameter so Nest keeps
   * injecting the two services it knows about, while a test can put a
   * stub here and never open a socket.
   */
  mapLinkFetcher: MapLinkFetcher | undefined = undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly verificationRequests: SupplierVerificationRequestService,
  ) {}

  // ---------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------

  async listContacts(companyId: string) {
    return this.prisma.companyContact.findMany({
      where: { companyId, isActive: true },
      orderBy: { createdAt: "asc" },
      // A CEILING, NOT A PAGE. A company records a handful of contacts;
      // this bounds what one runaway account can make the server
      // serialise, and is far above anything a real company reaches.
      take: MAX_OWN_ROWS.contacts,
    });
  }

  async createContact(dto: CreateContactDto, ctx: ActorContext) {
    await this.assertEditable(ctx.companyId);

    const contact = await this.prisma.companyContact.create({
      data: {
        companyId: ctx.companyId,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
      },
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "COMPANY_CONTACT_CREATED",
      entityType: "company_contact",
      entityId: contact.id,
      after: { name: contact.name, phone: contact.phone, email: contact.email },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return contact;
  }

  async updateContact(id: string, dto: UpdateContactDto, ctx: ActorContext) {
    const existing = await this.getOwnedContact(id, ctx.companyId);

    const updated = await this.prisma.companyContact.update({
      where: { id },
      data: { name: dto.name, phone: dto.phone, email: dto.email },
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "COMPANY_CONTACT_UPDATED",
      entityType: "company_contact",
      entityId: id,
      before: {
        name: existing.name,
        phone: existing.phone,
        email: existing.email,
      },
      after: { name: updated.name, phone: updated.phone, email: updated.email },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return updated;
  }

  async removeContact(id: string, ctx: ActorContext): Promise<void> {
    await this.getOwnedContact(id, ctx.companyId);

    await this.prisma.companyContact.update({
      where: { id },
      data: { isActive: false },
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "COMPANY_CONTACT_REMOVED",
      entityType: "company_contact",
      entityId: id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private async getOwnedContact(id: string, companyId: string) {
    const contact = await this.prisma.companyContact.findFirst({
      where: { id, companyId, isActive: true },
    });
    if (!contact) throw new NotFoundException("Contact not found");
    return contact;
  }

  // ---------------------------------------------------------------
  // Locations
  // ---------------------------------------------------------------

  async listLocations(companyId: string) {
    return this.prisma.companyLocation.findMany({
      where: { companyId, isActive: true },
      orderBy: { createdAt: "asc" },
      take: MAX_OWN_ROWS.branches,
    });
  }

  async createLocation(dto: CreateLocationDto, ctx: ActorContext) {
    await this.assertEditable(ctx.companyId);
    await this.requireSelectablePlace(dto.regionId, dto.cityId);
    const coordinates = await this.requireCoordinates(dto);

    const existingCount = await this.prisma.companyLocation.count({
      where: { companyId: ctx.companyId, isActive: true },
    });
    // The very first location for a company is always the default,
    // regardless of what the caller passed.
    const makeDefault = existingCount === 0 ? true : Boolean(dto.isDefault);

    const location = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.companyLocation.updateMany({
          where: { companyId: ctx.companyId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.companyLocation.create({
        data: {
          companyId: ctx.companyId,
          regionId: dto.regionId,
          cityId: dto.cityId ?? null,
          name: dto.name,
          shortAddress: dto.shortAddress,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          isDefault: makeDefault,
        },
      });
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "COMPANY_LOCATION_CREATED",
      entityType: "company_location",
      entityId: location.id,
      after: { name: location.name, isDefault: location.isDefault },
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    // A NEW BRANCH IS A NEW PLACE TO SELL AND SHIP FROM, and nobody
    // reviewed it. A verified supplier goes back under review — the
    // record stays editable, and the branches already approved keep
    // working; what stops is publishing anything NEW until somebody
    // has looked.
    await this.verificationRequests.markChangedSinceApproval(
      ctx.companyId,
      "BRANCH_ADDED",
      ctx,
    );

    return location;
  }

  async updateLocation(id: string, dto: UpdateLocationDto, ctx: ActorContext) {
    await this.assertEditable(ctx.companyId);
    const existing = await this.getOwnedLocation(id, ctx.companyId);

    /**
     * THE PAIR IS VALIDATED AS A PAIR, against what the branch will
     * actually be after the edit — not against what arrived.
     *
     * The case that makes this necessary: moving a branch to another
     * region while saying nothing about its city. Validating only the
     * field that was sent would leave a Riyadh city under a Tabuk
     * region, and the database's trigger would then refuse the write
     * with a message about a constraint. Resolving both first is what
     * turns that into a sentence naming the city and the region.
     *
     * `null` CLEARS the city; an omitted field keeps it.
     */
    const nextRegionId = dto.regionId ?? existing.regionId;
    const nextCityId =
      dto.cityId === undefined ? existing.cityId : dto.cityId;

    // Re-checked even when neither field was sent: a region or city
    // switched off since the branch was created must not be carried
    // forward by an unrelated edit... except that it must, because
    // fixing a telephone number cannot be blocked by a place somebody
    // else deactivated. So it is checked only when the place ACTUALLY
    // CHANGES — the same rule the console's branch service follows.
    const placeChanged =
      nextRegionId !== existing.regionId || nextCityId !== existing.cityId;
    if (placeChanged) {
      await this.requireSelectablePlace(nextRegionId, nextCityId);
    }

    // A POSITION IS OPTIONAL ON AN EDIT and required on a create: a
    // branch cannot exist without one, but somebody fixing a telephone
    // number should not have to place the pin again. When one IS given
    // it goes through the same reading as the create.
    //
    // HALF A COORDINATE IS NOT AN EDIT. One number without the other
    // would move a branch onto a meridian somewhere else entirely, so
    // it is refused rather than half-applied — and refused with the
    // same code the unreadable-link case uses, which the UI already
    // turns into a sentence about the position.
    const hasLatitude = dto.latitude !== undefined;
    const hasLongitude = dto.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      throw new BusinessException(
        400,
        ERROR_CODES.BRANCH_LOCATION_UNREADABLE,
        "A position needs both a latitude and a longitude",
      );
    }

    const positionGiven =
      (hasLatitude && hasLongitude) ||
      Boolean(dto.mapUrl && dto.mapUrl.trim() !== "");
    const coordinates = positionGiven
      ? await this.requireCoordinates(dto)
      : null;

    const updated = await this.prisma.companyLocation.update({
      where: { id },
      data: {
        // Written from the resolved pair, so the row is never left
        // holding a region and a city that disagree.
        ...(placeChanged ? { regionId: nextRegionId, cityId: nextCityId } : {}),
        name: dto.name,
        shortAddress: dto.shortAddress,
        ...(coordinates
          ? { latitude: coordinates.latitude, longitude: coordinates.longitude }
          : {}),
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
      },
    });

    // ONLY WHEN THE PLACE MOVED. The region decides where a listing
    // may be published and shipped from, so a branch that changes
    // region or city is a place nobody reviewed. Correcting the
    // telephone, the responsible name, the short address or the map
    // pin changes nothing a buyer, an invoice or a payout relies on —
    // and unverifying a trading supplier over a telephone number is
    // how a record stops being corrected at all.
    if (placeChanged) {
      await this.verificationRequests.markChangedSinceApproval(
        ctx.companyId,
        "BRANCH_MOVED",
        ctx,
      );
    }

    return updated;
  }

  async setDefaultLocation(id: string, ctx: ActorContext): Promise<void> {
    await this.getOwnedLocation(id, ctx.companyId);

    await this.prisma.$transaction(async (tx) => {
      await tx.companyLocation.updateMany({
        where: { companyId: ctx.companyId, isDefault: true },
        data: { isDefault: false },
      });
      await tx.companyLocation.update({
        where: { id },
        data: { isDefault: true },
      });
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "COMPANY_LOCATION_DEFAULT_CHANGED",
      entityType: "company_location",
      entityId: id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async removeLocation(id: string, ctx: ActorContext): Promise<void> {
    const location = await this.getOwnedLocation(id, ctx.companyId);
    if (location.isDefault) {
      throw new BadRequestException(
        "Cannot remove the default location — set another location as default first",
      );
    }

    await this.prisma.companyLocation.update({
      where: { id },
      data: { isActive: false },
    });

    await this.audit.log({
      actorType: AuditActorType.USER,
      actorId: ctx.userId,
      companyId: ctx.companyId,
      action: "COMPANY_LOCATION_REMOVED",
      entityType: "company_location",
      entityId: id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  private async getOwnedLocation(id: string, companyId: string) {
    const location = await this.prisma.companyLocation.findFirst({
      where: { id, companyId, isActive: true },
    });
    if (!location) throw new NotFoundException("Location not found");
    return location;
  }

  /**
   * Where the branch actually is.
   *
   * THE SAME READING THE CONSOLE DOES, from the same module. An
   * operator adding a branch from the admin console and a company
   * adding its own first branch are the same act on the same table,
   * and a second parser here would be free to accept a link the other
   * refused.
   *
   * A LINK IS ENOUGH, and it is what people have. The `?q=`, `@` and
   * `!3d!4d` forms carry the numbers outright; the shortened
   * `maps.app.goo.gl` link the "share" button produces carries none of
   * them and is a redirect, so it is followed — server-side, because
   * only the server may make that request and check every hop against
   * the host allowlist.
   *
   * Explicit coordinates still win when supplied: a caller that
   * already knows the pair should not have to build a URL to say so.
   */
  private async requireCoordinates(dto: {
    mapUrl?: string;
    latitude?: number;
    longitude?: number;
  }): Promise<{ latitude: number; longitude: number }> {
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      return { latitude: dto.latitude, longitude: dto.longitude };
    }

    const mapUrl = dto.mapUrl?.trim() ?? "";
    if (mapUrl === "") {
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

    const resolved = await resolveShareLink(mapUrl, this.mapLinkFetcher);
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
   * optional.
   *
   * ONE GUARD FOR BOTH, because the two are not independent: a city is
   * only valid if it sits under the region the branch claims. Checking
   * them separately is how a branch ends up in Tabuk with a Jeddah
   * address.
   *
   * The database enforces the pairing too, with a trigger. This exists
   * so an operator gets a sentence they can act on instead of a
   * constraint violation.
   */
  private async requireSelectablePlace(
    regionId: string,
    cityId: string | null | undefined,
  ): Promise<void> {
    if (regionId === SENTINEL_REGION_ID) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "This region cannot be selected — please choose a valid region",
      );
    }
    const region = await this.prisma.region.findUnique({ where: { id: regionId } });
    if (!region || !region.isActive) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "Invalid or inactive region",
      );
    }

    // NO CITY IS A COMPLETE ANSWER. A branch on a region alone is
    // exactly what this platform now records, so an absent city is
    // accepted rather than defaulted to anything — never the Sentinel,
    // never the region's first city.
    if (cityId === undefined || cityId === null) return;

    if (cityId === SENTINEL_CITY_ID) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "This city cannot be selected — please choose a valid city",
      );
    }
    const city = await this.prisma.city.findUnique({ where: { id: cityId } });
    if (!city || !city.isActive) {
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
