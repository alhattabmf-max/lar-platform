import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

/**
 * What a supplier may ask of their own catalogue.
 *
 * THE CATALOGUE IS PAGED, and it has to be: it grows with the
 * supplier's business and with nothing else, so it has no natural
 * ceiling. It CARRIED one — the most recent five hundred — and a
 * ceiling is a wrong answer given confidently: a supplier past it
 * simply never saw their oldest products, and the page still drew
 * every row it was given, 6.4 MB of HTML at the limit.
 *
 * SEARCH IS PART OF PAGING, not an extra. A pager alone makes finding
 * one product a matter of guessing which page it is on; the two
 * together are what replace «send everything and let the browser
 * look».
 */
export class ListMyProductsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * Clamped by the service to `MAX_PAGE_SIZE`, whatever arrives here.
   * The bound lives there rather than in a validator so that asking for
   * a thousand is answered with a hundred rather than refused.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  /** A fragment of the product's name, in either language. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /**
   * THE TWO HALVES OF THE CATALOGUE SCREEN.
   *
   * `true` is what the supplier must act on — a draft they never
   * finished, a rejection to correct, a product the platform pulled.
   * `false` is everything else. Absent is the whole catalogue, which is
   * what the product picker on an offer asks for.
   *
   * The screen used to make this split in the browser, over a list it
   * had all of. Under a pager that stops being possible: half a page
   * is not half a catalogue.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  needsAttention?: boolean;

  /**
   * Only what an offer can be published on: APPROVED and not archived.
   *
   * Asked for by the product picker on the listing form, which was
   * filtering the whole catalogue in the browser to find them.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  publishable?: boolean;
}
