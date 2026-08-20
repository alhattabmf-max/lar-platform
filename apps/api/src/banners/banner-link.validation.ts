/**
 * Banner link validation.
 *
 * A banner link is admin-supplied and rendered as an anchor on a public
 * page, so it is a direct injection surface. The defence is a closed
 * grammar rather than a blocklist: exactly two shapes are accepted and
 * everything else is refused, so there is no "scheme we forgot".
 *
 *   1. An internal path — `/opportunities`, `/policies?x=1`
 *   2. An absolute `https://` URL whose HOST is in the admin allowlist
 *
 * Refused, structurally: javascript:, data:, vbscript:, file:, blob:,
 * plain http:, protocol-relative `//host`, anything with whitespace or
 * a backslash, and any https host not on the allowlist.
 *
 * Absolute URLs are parsed with the WHATWG URL parser rather than
 * matched with a regex. That matters: the parser normalises the tricks
 * a regex misses — embedded tabs and newlines inside a scheme
 * (`java\tscript:`), uppercase schemes, and unicode hosts — so the
 * protocol and host checks see what a browser would see.
 */

/**
 * Internal paths must start with a single `/` and contain no whitespace
 * and no backslash. `//host` is excluded here because a browser treats
 * it as protocol-relative — an external navigation wearing the shape of
 * an internal one.
 */
const INTERNAL_PATH = /^\/(?!\/)[^\s\\]*$/;

export type BannerLinkRejection =
  | "EMPTY"
  | "PROTOCOL_RELATIVE"
  | "MALFORMED"
  | "UNSUPPORTED_SCHEME"
  | "HOST_NOT_ALLOWED"
  | "CONTAINS_WHITESPACE";

export type BannerLinkResult =
  | { ok: true; value: string }
  | { ok: false; reason: BannerLinkRejection };

export function validateBannerLink(raw: string, allowedHosts: string[]): BannerLinkResult {
  if (raw.length === 0) return { ok: false, reason: "EMPTY" };

  // Checked before anything else: a control character can change how a
  // parser reads the rest of the string.
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) {
    return { ok: false, reason: "CONTAINS_WHITESPACE" };
  }

  if (raw.startsWith("//")) return { ok: false, reason: "PROTOCOL_RELATIVE" };

  if (raw.startsWith("/")) {
    return INTERNAL_PATH.test(raw)
      ? { ok: true, value: raw }
      : { ok: false, reason: "MALFORMED" };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "UNSUPPORTED_SCHEME" };

  const host = url.host.toLowerCase();
  const allowed = allowedHosts.map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0);
  if (!allowed.includes(host)) return { ok: false, reason: "HOST_NOT_ALLOWED" };

  // Return the parser's normalised form, so what is stored is what a
  // browser will resolve.
  return { ok: true, value: url.toString() };
}
