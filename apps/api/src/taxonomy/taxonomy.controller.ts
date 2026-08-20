import { Controller, Get } from "@nestjs/common";
import type { TaxonomyNodeItem } from "@platform/types";
import { TaxonomyService } from "./taxonomy.service";

@Controller("taxonomy")
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  /**
   * Projected onto the shared contract rather than returned as raw
   * rows. `isActive` is dropped because every row here is active by
   * construction, and `createdAt`/`updatedAt` because an anonymous
   * caller has no use for when a category was edited.
   *
   * The result stays FLAT. `parentId` is included so a consumer can
   * rebuild the hierarchy — and note that a node whose parent was
   * deactivated is still returned with a `parentId` pointing outside
   * this list, because products filed under it remain filterable. See
   * TaxonomyNodeItem for what a consumer must do with that.
   */
  @Get("active")
  async listActive(): Promise<TaxonomyNodeItem[]> {
    const rows = await this.taxonomy.listActive();

    return rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      nameAr: row.nameAr,
      nameEn: row.nameEn,
      iconUrl: row.iconUrl,
      sortOrder: row.sortOrder,
    }));
  }
}
