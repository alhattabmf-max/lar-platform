import { Injectable } from "@nestjs/common";
import { ERROR_CODES } from "@platform/types";
import { BannerLinkAllowlistService } from "../settings/banner-link-allowlist.service";
import { BusinessException } from "../common/errors/business-exception";
import { validateBannerLink, type BannerLinkRejection } from "./banner-link.validation";

const MESSAGE_BY_REASON: Record<BannerLinkRejection, string> = {
  EMPTY: "Link cannot be empty — omit it entirely instead",
  PROTOCOL_RELATIVE:
    "Protocol-relative links (//host) are not allowed — use an internal path or a full https:// URL",
  MALFORMED: "Link is not a valid internal path or absolute URL",
  UNSUPPORTED_SCHEME: "Only https:// links and internal paths starting with / are allowed",
  HOST_NOT_ALLOWED: "That host is not in the banner link allowlist",
  CONTAINS_WHITESPACE: "Link cannot contain whitespace or control characters",
};

/**
 * Applies the link grammar with the CURRENT allowlist.
 *
 * Kept apart from the pure validator so the grammar stays testable
 * without any settings plumbing, and apart from BannerService so the
 * service never has to know where the allowlist lives.
 *
 * Normalisation happens here too: what is stored is the parser's
 * canonical form, so the stored value is exactly what a browser will
 * resolve rather than whatever the admin happened to type.
 */
@Injectable()
export class BannerLinkService {
  constructor(private readonly allowlist: BannerLinkAllowlistService) {}

  async normalise(raw: string | null): Promise<string | null> {
    if (raw === null) return null;

    const allowedHosts = await this.allowlist.getAllowedHosts();
    const result = validateBannerLink(raw, allowedHosts);

    if (!result.ok) {
      throw new BusinessException(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        MESSAGE_BY_REASON[result.reason]
      );
    }

    return result.value;
  }
}
