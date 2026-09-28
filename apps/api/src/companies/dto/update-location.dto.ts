import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";

/**
 * A branch, edited.
 *
 * THE POSITION IS A PAIR OF NUMBERS, and it arrives that way because a
 * person now places a pin on a map instead of pasting a link. This DTO
 * used to refuse coordinates on purpose — the reasoning was that no
 * form a company sees carries a number, so accepting one would put the
 * two halves of one decision in two shapes. The form changed, and the
 * refusal would now mean the map could set a position when a branch is
 * created and never move it afterwards.
 *
 * `mapUrl` IS STILL ACCEPTED, and that is not leftovers: the admin
 * console's own branch form still takes a link, integrations may
 * already send one, and refusing it would break a caller for no gain.
 * When both arrive the pair wins, exactly as it does on create.
 *
 * BOTH NUMBERS OR NEITHER — enforced in the service, because "these
 * two travel together" is not something a per-property decorator can
 * say. A lone latitude would otherwise move a branch half-way.
 */
export class UpdateLocationDto {
  @IsOptional()
  @IsUUID()
  regionId?: string;

  /**
   * `null` CLEARS THE CITY, which is a real edit: a branch that named
   * one may stop naming one, and there has to be a way to say so.
   * Omitting the field leaves it untouched, as every other field here
   * does — the two are different instructions and the service treats
   * them differently.
   */
  @IsOptional()
  @IsUUID()
  cityId?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  shortAddress?: string;

  /** A pasted Google Maps link, a share link, or a bare `lat,lng`. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  mapUrl?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  contactPhone?: string;
}
