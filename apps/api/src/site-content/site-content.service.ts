import { Injectable } from "@nestjs/common";
import {
  HEADER_NAV_MAX_ITEMS,
  HEADER_NAV_SETTING_KEY,
  SITE_CONTENT_FIELDS,
  SITE_CONTENT_LIMITS,
  SITE_CONTENT_SETTING_KEY,
  isSiteContentText,
  type HeaderNavItem,
  type SiteContent,
  type SiteContentText,
} from "@platform/types";
import { PrismaService } from "../database/prisma.service";

/**
 * Administrator-editable homepage text and header categories.
 *
 * Two rows in `system_settings`, read through the registry that already
 * validates and audits every other setting. There is no content table,
 * no versioning and no migration — this is the narrowest thing that
 * answers "change the wording and the top-bar categories without a
 * deploy".
 *
 * EVERY FAILURE MODE DEGRADES TO THE SHIPPED COPY. A missing setting, a
 * malformed one, a field of the wrong type, a taxonomy node that was
 * deleted — each resolves to null or is dropped, and the consumer falls
 * back to its own message catalogue. A bad edit must never produce an
 * empty homepage, and a retired category must never produce a menu item
 * that 404s.
 *
 * The header stores TAXONOMY NODE IDS, never URLs. An operator cannot
 * type a destination, so there is nothing to allowlist and no way to
 * point the navigation off-site. The names are resolved from the
 * taxonomy at request time, so renaming a category renames the menu item
 * and there is no second copy of a name to drift.
 */
@Injectable()
export class SiteContentService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<SiteContent> {
    const [contentRow, navRow] = await Promise.all([
      this.prisma.systemSetting.findUnique({ where: { key: SITE_CONTENT_SETTING_KEY } }),
      this.prisma.systemSetting.findUnique({ where: { key: HEADER_NAV_SETTING_KEY } }),
    ]);

    const text = this.readText(contentRow?.value);
    const headerNav = await this.readHeaderNav(navRow?.value);

    return {
      heroTitle: text.heroTitle,
      heroDescription: text.heroDescription,
      featuredTitle: text.featuredTitle,
      policiesTitle: text.policiesTitle,
      policiesDescription: text.policiesDescription,
      headerNav,
    };
  }

  /**
   * Reads the text block, field by field.
   *
   * Each field is validated on its own, so one malformed entry costs
   * that field and not the whole block — an operator who breaks the hero
   * title still gets their customised policies section.
   *
   * Over-length values are DROPPED, not truncated. A half-sentence on a
   * homepage is worse than the default sentence, and truncating stored
   * content silently is how a bound becomes invisible.
   */
  private readText(value: unknown): Record<(typeof SITE_CONTENT_FIELDS)[number], SiteContentText> {
    const empty: SiteContentText = { ar: null, en: null };
    const result = Object.fromEntries(
      SITE_CONTENT_FIELDS.map((field) => [field, { ...empty }])
    ) as Record<(typeof SITE_CONTENT_FIELDS)[number], SiteContentText>;

    if (typeof value !== "object" || value === null) return result;
    const source = value as Record<string, unknown>;

    for (const field of SITE_CONTENT_FIELDS) {
      const raw = source[field];
      if (!isSiteContentText(raw)) continue;

      const limit = SITE_CONTENT_LIMITS[field];
      result[field] = {
        ar: typeof raw.ar === "string" && raw.ar.length <= limit ? raw.ar : null,
        en: typeof raw.en === "string" && raw.en.length <= limit ? raw.en : null,
      };
    }

    return result;
  }

  /**
   * Resolves the configured node ids to names, dropping anything unusable.
   *
   * A node that was deleted or deactivated is dropped SILENTLY. The
   * header must not break because a category was retired, and an item
   * that leads nowhere is worse than an item that is gone. The operator
   * sees the same truth on the admin screen, which resolves the same way.
   */
  private async readHeaderNav(value: unknown): Promise<HeaderNavItem[]> {
    if (!Array.isArray(value)) return [];

    const ids = value
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      // De-duplicated: the same category twice in a menu is a mistake, not
      // an intention.
      .filter((id, index, all) => all.indexOf(id) === index)
      .slice(0, HEADER_NAV_MAX_ITEMS);

    if (ids.length === 0) return [];

    const nodes = await this.prisma.taxonomyNode.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, nameAr: true, nameEn: true },
    });

    const byId = new Map(nodes.map((node) => [node.id, node]));

    // Mapped over the CONFIGURED order, not the query's: the operator
    // chose the order and the database has no opinion about it.
    return ids.flatMap((id) => {
      const node = byId.get(id);
      if (!node) return [];
      return [{ taxonomyNodeId: node.id, nameAr: node.nameAr, nameEn: node.nameEn }];
    });
  }
}
