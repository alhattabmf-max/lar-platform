import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditActorType } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { SENTINEL_CITY_ID } from "../geography/sentinel.constants";
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

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  // ---------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------

  async listContacts(companyId: string) {
    return this.prisma.companyContact.findMany({
      where: { companyId, isActive: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async createContact(dto: CreateContactDto, ctx: ActorContext) {
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
      before: { name: existing.name, phone: existing.phone, email: existing.email },
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
    });
  }

  async createLocation(dto: CreateLocationDto, ctx: ActorContext) {
    await this.requireSelectableCity(dto.cityId);

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
          cityId: dto.cityId,
          name: dto.name,
          shortAddress: dto.shortAddress,
          latitude: dto.latitude,
          longitude: dto.longitude,
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

    return location;
  }

  async updateLocation(id: string, dto: UpdateLocationDto, ctx: ActorContext) {
    await this.getOwnedLocation(id, ctx.companyId);
    if (dto.cityId) await this.requireSelectableCity(dto.cityId);

    return this.prisma.companyLocation.update({
      where: { id },
      data: {
        cityId: dto.cityId,
        name: dto.name,
        shortAddress: dto.shortAddress,
        latitude: dto.latitude,
        longitude: dto.longitude,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
      },
    });
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
        "Cannot remove the default location — set another location as default first"
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
   * Service-level guard — never trusts the DTO's UUID shape alone.
   * Rejects: an unknown city, an inactive city, and explicitly the
   * Sentinel city (reserved solely for migrating pre-existing rows,
   * never selectable by a live create/update call).
   */
  private async requireSelectableCity(cityId: string): Promise<void> {
    if (cityId === SENTINEL_CITY_ID) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "This city cannot be selected — please choose a valid city"
      );
    }
    const city = await this.prisma.city.findUnique({ where: { id: cityId } });
    if (!city || !city.isActive) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "Invalid or inactive city");
    }
  }
}
