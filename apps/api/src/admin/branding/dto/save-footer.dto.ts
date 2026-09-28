import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import {
  FOOTER_LIMITS,
  FOOTER_MAX_SOCIAL_LINKS,
  FOOTER_PAGE_KEYS,
  FOOTER_SOCIAL_NETWORK_KEYS,
  type FooterPageKey,
  type FooterSocialNetwork,
} from "@platform/types";

/**
 * The footer draft, as it arrives from the console.
 *
 * TWO LAYERS, ON PURPOSE. This DTO rejects the obvious at the edge —
 * wrong types, unknown page keys, over-long text, too many entries — so
 * a mistyped body fails with a field-level message an operator can act
 * on. The SERVICE then runs `isFooterConfig`, which is the real
 * boundary: it enforces what a DTO cannot express, including that a
 * social URL is HTTPS on that network's own host and that no
 * destination appears twice.
 *
 * Neither layer trusts the other, and the service's check is the one
 * that also runs on publish — where the value being validated came out
 * of the database rather than off the wire.
 */

class FooterLinkDto {
  @IsIn(FOOTER_PAGE_KEYS)
  page!: FooterPageKey;

  @IsOptional()
  @IsString()
  @MaxLength(FOOTER_LIMITS.label)
  labelAr!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(FOOTER_LIMITS.label)
  labelEn!: string | null;

  @IsBoolean()
  enabled!: boolean;
}

class FooterSocialDto {
  @IsIn(FOOTER_SOCIAL_NETWORK_KEYS)
  network!: FooterSocialNetwork;

  // Shape is checked by `isAllowedSocialUrl` in the service. Bounding
  // the length here keeps an oversized body from reaching it at all.
  @IsString()
  @MaxLength(FOOTER_LIMITS.socialUrl)
  url!: string;

  @IsBoolean()
  enabled!: boolean;
}

class FooterContactDto {
  @IsOptional()
  @IsString()
  @MaxLength(FOOTER_LIMITS.email)
  email!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(FOOTER_LIMITS.phone)
  phone!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(FOOTER_LIMITS.address)
  addressAr!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(FOOTER_LIMITS.address)
  addressEn!: string | null;
}

export class SaveFooterDto {
  @IsArray()
  @ArrayMaxSize(FOOTER_PAGE_KEYS.length)
  @ValidateNested({ each: true })
  @Type(() => FooterLinkDto)
  links!: FooterLinkDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => FooterContactDto)
  contact!: FooterContactDto;

  @IsArray()
  @ArrayMaxSize(FOOTER_MAX_SOCIAL_LINKS)
  @ValidateNested({ each: true })
  @Type(() => FooterSocialDto)
  social!: FooterSocialDto[];

  @IsOptional()
  @IsString()
  @MaxLength(FOOTER_LIMITS.copyright)
  copyrightAr!: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(FOOTER_LIMITS.copyright)
  copyrightEn!: string | null;

  @IsBoolean()
  showDescription!: boolean;
}

/**
 * The validated DTO as the exact object that will be stored.
 *
 * WHY THIS IS NOT A SPREAD. An omitted optional field arrives as
 * `undefined`, and the stored shape says a label that is not set is
 * `null`. Left alone, `{ labelAr: undefined }` would be refused by
 * `isFooterConfig` — a body that is perfectly correct rejected on a
 * distinction the operator never made. Every optional is mapped to an
 * explicit null here, once, at the edge.
 *
 * It also strips anything class-transformer left on the instance and
 * anything the client sent that no field claims, so what reaches the
 * validator is a plain object with exactly the known keys — the
 * property that makes "the stored value has a closed shape" true rather
 * than hoped for.
 */
export function footerConfigFromDto(dto: SaveFooterDto): unknown {
  const orNull = (value: string | null | undefined): string | null =>
    value === undefined ? null : value;

  return {
    links: dto.links.map((link) => ({
      page: link.page,
      labelAr: orNull(link.labelAr),
      labelEn: orNull(link.labelEn),
      enabled: link.enabled,
    })),
    contact: {
      email: orNull(dto.contact.email),
      phone: orNull(dto.contact.phone),
      addressAr: orNull(dto.contact.addressAr),
      addressEn: orNull(dto.contact.addressEn),
    },
    social: dto.social.map((entry) => ({
      network: entry.network,
      url: entry.url,
      enabled: entry.enabled,
    })),
    copyrightAr: orNull(dto.copyrightAr),
    copyrightEn: orNull(dto.copyrightEn),
    showDescription: dto.showDescription,
  };
}
