import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * A branch, as the console sends one.
 *
 * THE LOCATION ARRIVES AS A LINK, not as two numbers. An operator has a
 * Google Maps page open, not a coordinate pair — asking for latitude
 * and longitude would mean asking them to read numbers out of a URL by
 * hand, which is a step that invents its own typos. The service parses
 * the link once and stores what the platform already uses.
 */
export class CreateBranchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /**
   * THE REGION IS THE BRANCH'S LOCATION, and it is required.
   */
  @IsUUID()
  regionId!: string;

  /**
   * THE CITY IS OPTIONAL. A branch on a region alone is complete. When
   * given it must be an active city under the same region, and never
   * the Sentinel — all three checked in the service.
   */
  @IsOptional()
  @IsUUID()
  cityId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  shortAddress!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  contactName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  contactPhone!: string;

  /** Required here: a branch cannot be stored without a position. */
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  mapUrl!: string;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsUUID() regionId?: string;
  /** `null` clears the city; omitting the field leaves it. */
  @IsOptional() @IsUUID() cityId?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) shortAddress?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) contactName?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(40) contactPhone?: string;
  /** Optional here: fixing a telephone should not demand a re-paste. */
  @IsOptional() @IsString() @MaxLength(2000) mapUrl?: string;
}
