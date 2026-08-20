import { Injectable } from "@nestjs/common";
import { EMPTY_BRANDING_PUBLIC, type BrandingPublic } from "@platform/types";
import { PrismaService } from "../database/prisma.service";
import { BrandThemeService } from "./brand-theme.service";

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly theme: BrandThemeService
  ) {}

  async getPublic(): Promise<BrandingPublic> {
    // The ACTIVE theme only — never the draft, never validation detail.
    // BrandThemeService.getActive() is fail-safe, so a missing or
    // corrupt theme row degrades to the defaults rather than failing
    // the whole branding read.
    const themeColors = await this.theme.getActive();

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
    if (!row) return { ...EMPTY_BRANDING_PUBLIC, theme: { colors: themeColors } };

    return {
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      shortDescriptionAr: row.shortDescriptionAr,
      shortDescriptionEn: row.shortDescriptionEn,
      logoMainUrl: row.logoMainUrl,
      logoSmallUrl: row.logoSmallUrl,
      faviconUrl: row.faviconUrl,
      theme: { colors: themeColors },
    };
  }
}
