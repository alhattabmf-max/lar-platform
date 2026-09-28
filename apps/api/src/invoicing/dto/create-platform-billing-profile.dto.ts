import { Type } from "class-transformer";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { SHORT_ADDRESS_MAX } from "@platform/types";

/**
 * The platform's own billing identity.
 *
 * THE ADDRESS WAS `@IsObject()` AND NOTHING ELSE. That accepted any
 * object at all, `{}` included — and the commission document copies the
 * whole blob onto itself as the seller's address. A tax-adjacent
 * document with an empty seller address was one request away.
 *
 * It is a declared, validated shape now. The storage did not change: the
 * column is still `Json`, and no migration was needed to stop accepting
 * an empty object.
 */
export class PlatformBillingAddressDto {
  /**
   * A CITY ID, never a typed city name.
   *
   * Cities are reference data with their own table and their own admin
   * screen. `CreateLocationDto` and the admin branch DTO both take a
   * `cityId` UUID for exactly this reason, and this is the same address
   * on the same platform.
   */
  @IsUUID()
  cityId!: string;

  /**
   * `cityNameAr` and `cityNameEn` are NOT accepted from the client.
   *
   * The service reads them from the city row and writes them itself.
   * Taking them from the request would let the name on a document
   * disagree with the city it claims to be.
   */

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT_ADDRESS_MAX)
  shortAddress!: string;
}

export class CreatePlatformBillingProfileDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  legalName!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  crNumber!: string;

  @IsBoolean()
  isVatRegistered!: boolean;

  @IsOptional()
  @IsString()
  vatNumber?: string;

  /**
   * `@IsNotEmptyObject` as well as the nested validation: the two answer
   * different questions, and `{}` used to satisfy the old rule exactly.
   */
  @IsObject()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => PlatformBillingAddressDto)
  addressSnapshot!: PlatformBillingAddressDto;
}
