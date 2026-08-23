import { IsString, MinLength, MaxLength } from "class-validator";

/**
 * Reference-data names are bounded at both ends.
 *
 * They had a minimum but no maximum, so a single request could store an
 * unbounded string in a row that every product, every address and every
 * menu renders. A ceiling here is not about typing effort — it is about
 * what a table retained indefinitely is allowed to hold.
 */
const REFERENCE_NAME_MAX = 120;

export class CreateRegionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(REFERENCE_NAME_MAX)
  nameAr!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(REFERENCE_NAME_MAX)
  nameEn!: string;
}
