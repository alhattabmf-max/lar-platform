import { Injectable } from "@nestjs/common";
import { EMPTY_BRANDING_PUBLIC, type BrandingPublic } from "@platform/types";
import { PrismaService } from "../database/prisma.service";

/**
 * Public read of BrandingSettings — the only path by which branding data
 * leaves the system without a session.
 *
 * Two independent layers keep the boundary tight:
 *
 *   1. The Prisma `select` below names the seven public columns
 *      explicitly, so `invoiceLogoUrl`, `emailLogoUrl`,
 *      `headerFooterConfig`, `updatedBy`, `createdAt` and `updatedAt` are
 *      never even read from the database.
 *   2. The return type is the shared `BrandingPublic` contract, so a
 *      column added to the model later cannot reach the response without
 *      someone also editing packages/types.
 *
 * A column is therefore public only when BOTH the select and the shared
 * contract say so, which is what makes this reviewable in a diff.
 */
@Injectable()
export class BrandingService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublic(): Promise<BrandingPublic> {
    const row = await this.prisma.brandingSettings.findUnique({
      where: { singletonKey: "default" },
      select: {
        nameAr: true,
        nameEn: true,
        shortDescriptionAr: true,
        shortDescriptionEn: true,
        logoMainUrl: true,
        logoSmallUrl: true,
        faviconUrl: true,
      },
    });

    // No branding configured yet is a normal state, not an error: the
    // web app renders a translated placeholder rather than any
    // hardcoded brand string.
    if (!row) return { ...EMPTY_BRANDING_PUBLIC };

    return {
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      shortDescriptionAr: row.shortDescriptionAr,
      shortDescriptionEn: row.shortDescriptionEn,
      logoMainUrl: row.logoMainUrl,
      logoSmallUrl: row.logoSmallUrl,
      faviconUrl: row.faviconUrl,
    };
  }
}
