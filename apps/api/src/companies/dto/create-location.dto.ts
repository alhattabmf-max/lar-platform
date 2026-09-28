import { IsBoolean, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

/**
 * A branch, as the company itself submits it.
 *
 * THE POSITION MAY ARRIVE TWO WAYS, and exactly one of them has to.
 * `mapUrl` is what a person actually has — the link Google gave them,
 * including the shortened `maps.app.goo.gl` form, which the service
 * follows and reads. `latitude`/`longitude` stay accepted because
 * callers that already compute them should not be forced to build a
 * URL to say so.
 *
 * Both are optional HERE and the requirement is enforced in the
 * service, because "one of these two" is not something a per-property
 * decorator can state; the service refuses with
 * `BRANCH_LOCATION_UNREADABLE`, which is the code the UI already
 * translates into a sentence about the link.
 */
export class CreateLocationDto {
  /**
   * THE REGION IS THE BRANCH'S LOCATION, and it is required. It is
   * what the platform ships from, prices against, filters by, and
   * checks before a listing may go live.
   */
  @IsUUID()
  regionId!: string;

  /**
   * THE CITY IS OPTIONAL. A branch recorded on a region alone is a
   * complete branch — this field used to be required, which is why
   * switching every city off left nobody able to add one.
   *
   * When supplied it must be an ACTIVE city UNDER THE SAME REGION, and
   * never the Sentinel. The service enforces all three, because none
   * of them is a fact a decorator can see.
   */
  @IsOptional()
  @IsUUID()
  cityId?: string | null;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  shortAddress!: string;

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

  @IsString()
  @MinLength(1)
  contactName!: string;

  @IsString()
  @MinLength(1)
  contactPhone!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
