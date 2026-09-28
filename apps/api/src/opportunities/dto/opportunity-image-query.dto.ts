import { Type } from "class-transformer";
import { IsInt, IsOptional, Min } from "class-validator";
import { ImageVariantQueryDto } from "../../banners/dto/image-variant.dto";

/**
 * THE OPPORTUNITY IMAGE ROUTE'S QUERY: a variant, and which photograph.
 *
 * IT EXTENDS THE SHARED VARIANT DTO rather than restating it, so
 * `main`/`thumb` cannot come to mean one thing here and another on the
 * banner routes — the reason that DTO is shared in the first place.
 *
 * AND `index` IS DECLARED, NOT READ AROUND. This application runs
 * `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`, so a
 * query parameter no DTO names is a 400 before the handler is reached.
 * A first attempt read `index` off a cast inside the controller; every
 * indexed request answered 400 and nothing in the code said why. The
 * pipe was right and the cast was the bug.
 *
 * A BAD INDEX IS A 400, never a quiet fall back to the main image —
 * the same rule `variant` follows and for the same reason. Serving a
 * different photograph than the one asked for hides a client bug and
 * makes a typo indistinguishable from a working request.
 *
 * OMITTED MEANS THE MAIN ONE, which is what every caller written before
 * the gallery existed asks for.
 */
export class OpportunityImageQueryDto extends ImageVariantQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: "index must be a whole number" })
  @Min(0, { message: "index must be zero or greater" })
  index?: number;
}
