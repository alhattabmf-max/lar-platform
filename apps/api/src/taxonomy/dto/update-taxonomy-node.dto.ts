import { Type } from "class-transformer";
import { IsOptional, IsString, IsUrl, MinLength, MaxLength, IsInt, Min, Max } from "class-validator";

/**
 * Reference-data names are bounded at both ends.
 *
 * They had a minimum but no maximum, so a single request could store an
 * unbounded string in a row that every product, every address and every
 * menu renders. A ceiling here is not about typing effort — it is about
 * what a table retained indefinitely is allowed to hold.
 */
const REFERENCE_NAME_MAX = 120;

export class UpdateTaxonomyNodeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(REFERENCE_NAME_MAX)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(REFERENCE_NAME_MAX)
  nameEn?: string;

  @IsOptional()
  @IsUrl()
  iconUrl?: string;

  /**
   * WHERE IT STANDS IN THE STRIP — «في قائمة إضافة التصنيف أعطني خيار
   * أني أقدر أرتّب التصنيفات في الأشرطة… يعني أحطّ تصنيف قبل تصنيف أو
   * بعد تصنيف، اعمل عليها رقم».
   *
   * THE COLUMN WAS ALWAYS THERE. `taxonomy_nodes.sort_order` has
   * existed since the table did, the tree is READ back
   * `ORDER BY sort_order, created_at, id`, and every list on the
   * platform already obeys it — but no route ever let an operator
   * write it, so the order was creation order for good. Nothing about
   * the database changes here; a field that existed becomes reachable.
   *
   * SMALL NUMBER FIRST, and duplicates are allowed on purpose: two
   * categories sharing a rank fall back to creation order rather than
   * being refused, so an operator numbering a strip does not have to
   * renumber the whole tree to insert one row in the middle.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}
