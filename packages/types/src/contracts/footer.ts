/**
 * The site footer, as an operator configures it.
 *
 * WHY THIS EXISTS. The footer used to be five links written into the
 * component, a brand name, and a fixed note. Changing the order,
 * hiding a link, adding a telephone number or a social account all
 * meant a deploy. This makes the whole of it operator-editable —
 * ordering, enabling, contact details, social accounts, copyright, both
 * languages — without adding a table or a column.
 *
 * WHERE IT IS STORED. `branding_settings.header_footer_config`, the
 * JSON column that already exists on the singleton branding row and
 * had no reader. The draft lives in a `system_settings` row alongside
 * the brand theme's draft, so the two content surfaces behave the same
 * way: edit, preview, publish.
 *
 * THE COLUMN USED TO BE UNTOUCHABLE, and for a good reason that is
 * recorded in three places in this repository: it was a free-form JSON
 * blob with no validated shape, and rendering unvalidated JSON into a
 * page is a stored-XSS surface. That objection is answered here rather
 * than waived — this module gives the column a CLOSED shape, and
 * `isFooterConfig` is the only door into it. What made it dangerous
 * was the absence of a contract, not the column.
 *
 * FOUR RULES CARRY THE SAFETY:
 *
 *   1. EVERY STRING IS A TEXT NODE. No HTML, no Markdown, no
 *      `dangerouslySetInnerHTML` — the same rule `site-content.ts`
 *      states for operator-written text, for the same reason.
 *   2. AN INTERNAL LINK IS A KEY, NEVER A URL. An operator chooses
 *      from `FOOTER_PAGES` and the app resolves the route. There is no
 *      field in which a destination can be typed, so there is nothing
 *      to sanitise and no way to point the footer at another site.
 *   3. AN EXTERNAL LINK IS A NETWORK PLUS A HOST FROM THAT NETWORK'S
 *      OWN LIST, over HTTPS. `linkedin.com` and its national
 *      subdomains are LinkedIn; nothing else is, whatever the operator
 *      pastes. A `javascript:` or `data:` URL fails the scheme check
 *      before the host check is even reached.
 *   4. A LINK TO AN UNPUBLISHED POLICY IS NOT RENDERED. Configuration
 *      says an operator WANTS the terms in the footer; whether the
 *      terms exist is a fact about the database, checked at render.
 *      Enabling a link cannot conjure a document.
 */

/**
 * Every internal destination the footer may point at, and the route
 * each one resolves to.
 *
 * A CLOSED LIST, not an allowlist of patterns: adding a destination is
 * a code change that goes through review, which is the property that
 * makes "the footer cannot link off-site" true by construction rather
 * than by validation.
 *
 * `policyCode` marks the two entries that address a published policy
 * document. It is the document's code — the thing that survives a new
 * version being published — and it is what tells the renderer which
 * links to drop when nothing is published under it.
 */
export const FOOTER_PAGES = {
  about: { path: "/about" },
  faq: { path: "/faq" },
  contact: { path: "/contact" },
  // `/opportunities` is deliberately absent even though the route
  // exists: `/products` forwards to it, and it is the address this
  // platform's own vocabulary implies. Two footer entries reaching one
  // page, both reading «المنتجات», is a confusing screen — and the
  // word the other would have to be labelled with is one this platform
  // no longer says to anybody.
  products: { path: "/products" },
  policies: { path: "/policies" },
  terms: { path: "/policies", policyCode: "terms_of_service" },
  privacy: { path: "/policies", policyCode: "privacy_policy" },
} as const satisfies Record<
  string,
  { path: string; policyCode?: "terms_of_service" | "privacy_policy" }
>;

export type FooterPageKey = keyof typeof FOOTER_PAGES;

export const FOOTER_PAGE_KEYS = Object.keys(FOOTER_PAGES) as FooterPageKey[];

export function isFooterPageKey(value: unknown): value is FooterPageKey {
  return typeof value === "string" && value in FOOTER_PAGES;
}

/**
 * The social networks the footer will render, each with the hosts that
 * genuinely belong to it.
 *
 * MATCHED AS A HOST OR A SUBDOMAIN OF ONE — `sa.linkedin.com` is
 * LinkedIn, `linkedin.com.example.net` is not. Substring matching is
 * what gets this wrong, so `isAllowedSocialUrl` compares labels.
 *
 * X carries `twitter.com` too: accounts are still linked by the old
 * name across the web, and refusing it would only teach operators to
 * put the link somewhere it is not checked.
 */
export const FOOTER_SOCIAL_NETWORKS = {
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
  snapchat: ["snapchat.com"],
  facebook: ["facebook.com"],
  whatsapp: ["wa.me", "whatsapp.com"],
} as const satisfies Record<string, readonly string[]>;

export type FooterSocialNetwork = keyof typeof FOOTER_SOCIAL_NETWORKS;

export const FOOTER_SOCIAL_NETWORK_KEYS = Object.keys(
  FOOTER_SOCIAL_NETWORKS,
) as FooterSocialNetwork[];

export function isFooterSocialNetwork(
  value: unknown,
): value is FooterSocialNetwork {
  return typeof value === "string" && value in FOOTER_SOCIAL_NETWORKS;
}

/**
 * Whether a URL is a real address on that network.
 *
 * PARSED BY HAND, not with `URL`. This package is deliberately free of
 * every dependency including the platform libraries — the guard in
 * `__tests__/no-prisma-dependency.test.mjs` exists to keep it that way
 * — so there is no `URL` to call. Reading the authority out of the
 * string is a few lines, and being explicit about each rejection is
 * worth more here than brevity: this decides what a public page links
 * to.
 *
 * HTTPS ONLY. A footer link is a public endorsement and there is no
 * reason to send a visitor to a network over plaintext. Requiring the
 * scheme is also what refuses `javascript:` and `data:` — they never
 * reach the host check.
 *
 * NO CREDENTIALS. `https://x.com@evil.example/` reads as x.com and goes
 * to evil.example: everything before the `@` is a username. An
 * authority containing `@` is refused rather than parsed.
 *
 * A HOST IS LETTERS, DIGITS, DOTS AND HYPHENS. Anything else — a
 * backslash (which some browsers treat as a separator), whitespace, a
 * control character, an encoded octet, a bracketed IPv6 literal — is
 * refused. No social network is reached at an address like that.
 *
 * MATCHED BY LABEL, NEVER BY SUBSTRING: `sa.linkedin.com` is LinkedIn,
 * `linkedin.com.evil.example` is not.
 */
export function isAllowedSocialUrl(
  network: FooterSocialNetwork,
  url: string,
): boolean {
  const prefix = "https://";
  if (url.slice(0, prefix.length).toLowerCase() !== prefix) return false;

  const rest = url.slice(prefix.length);
  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);

  if (authority.includes("@")) return false;

  // A port is allowed to be present and is not part of the host.
  const host = authority.split(":")[0].toLowerCase().replace(/\.$/, "");
  if (host.length === 0) return false;
  if (!/^[a-z0-9.-]+$/.test(host)) return false;

  return FOOTER_SOCIAL_NETWORKS[network].some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

/**
 * How long each operator-written string may be.
 *
 * Bounded for the reason `site-content.ts` gives: unbounded text is a
 * payload. A label overrides a translated name, so it is short by
 * nature; an address is a few lines; a copyright line is one.
 */
export const FOOTER_LIMITS = {
  label: 60,
  email: 254,
  phone: 32,
  address: 300,
  copyright: 200,
  socialUrl: 300,
} as const;

/** At most this many social accounts. Eight networks exist; one each. */
export const FOOTER_MAX_SOCIAL_LINKS = 8;

/**
 * A footer link, as configured.
 *
 * `labelAr`/`labelEn` OVERRIDE the translated name and are optional —
 * null means "use the shipped wording", which is what an operator
 * wants almost always. An override exists for the case the shipped
 * word is wrong for this business, not as the normal path.
 *
 * `enabled` is separate from absence: a disabled link keeps its
 * position and its label, so switching it back on does not mean
 * rebuilding it.
 */
export interface FooterLink {
  page: FooterPageKey;
  labelAr: string | null;
  labelEn: string | null;
  enabled: boolean;
}

export interface FooterSocialLink {
  network: FooterSocialNetwork;
  url: string;
  enabled: boolean;
}

/**
 * The contact block. Every field optional — a business with no public
 * telephone is a normal business, and an empty string is not an
 * address.
 */
export interface FooterContact {
  email: string | null;
  phone: string | null;
  addressAr: string | null;
  addressEn: string | null;
}

/**
 * The whole footer.
 *
 * ORDER IS THE ARRAY'S ORDER. There is no `order` integer to keep in
 * step with the positions — two records of the same fact drift, and
 * the array already holds it.
 */
export interface FooterConfig {
  links: FooterLink[];
  contact: FooterContact;
  social: FooterSocialLink[];
  copyrightAr: string | null;
  copyrightEn: string | null;
  /** Whether the brand's short description appears under the name. */
  showDescription: boolean;
}

/**
 * What a fresh installation gets: exactly the five links the footer
 * carried when they were written into the component, in the same
 * order, all enabled, with no overrides and nothing else configured.
 *
 * A platform that has never opened the footer screen must look
 * unchanged. That is what makes this safe to ship without anyone
 * having to configure it first.
 */
export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
  links: [
    { page: "about", labelAr: null, labelEn: null, enabled: true },
    { page: "faq", labelAr: null, labelEn: null, enabled: true },
    { page: "contact", labelAr: null, labelEn: null, enabled: true },
    { page: "terms", labelAr: null, labelEn: null, enabled: true },
    { page: "privacy", labelAr: null, labelEn: null, enabled: true },
  ],
  contact: { email: null, phone: null, addressAr: null, addressEn: null },
  social: [],
  copyrightAr: null,
  copyrightEn: null,
  showDescription: true,
};

const isBoundedText = (value: unknown, max: number): boolean =>
  value === null ||
  (typeof value === "string" && value.trim().length > 0 && value.length <= max);

/**
 * A plain e-mail check, deliberately not RFC 5322.
 *
 * What matters here is that the string is one address with no spaces
 * and no newline — a newline in a value that later reaches a `mailto:`
 * or a header is the injection this guards. Whether the mailbox exists
 * is not a question a regular expression can answer.
 */
const EMAIL_PATTERN = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

/**
 * A telephone number as people write one: digits, spaces, and the few
 * punctuation marks that appear in international numbers.
 *
 * Not validated as Saudi: the platform's own support number may be
 * anywhere, and rejecting a correct number because of its country code
 * is a worse failure than accepting an oddly formatted one.
 */
const PHONE_PATTERN = /^[+]?[\d\s().-]{6,}$/;

/**
 * The single door into `header_footer_config`.
 *
 * Every branch returns false rather than repairing the value. A
 * malformed footer is a bug in whatever wrote it, and silently
 * correcting it hides that — the caller falls back to
 * `DEFAULT_FOOTER_CONFIG`, so the site keeps its shipped footer rather
 * than losing one.
 */
export function isFooterConfig(value: unknown): value is FooterConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const config = value as Record<string, unknown>;

  if (!Array.isArray(config.links)) return false;
  if (config.links.length > FOOTER_PAGE_KEYS.length) return false;
  const seenPages = new Set<string>();
  for (const raw of config.links) {
    if (typeof raw !== "object" || raw === null) return false;
    const link = raw as Record<string, unknown>;
    if (!isFooterPageKey(link.page)) return false;
    // The same destination twice makes ordering ambiguous and editing
    // destructive — the screen would update whichever came first.
    if (seenPages.has(link.page)) return false;
    seenPages.add(link.page);
    if (typeof link.enabled !== "boolean") return false;
    if (!isBoundedText(link.labelAr, FOOTER_LIMITS.label)) return false;
    if (!isBoundedText(link.labelEn, FOOTER_LIMITS.label)) return false;
  }

  if (
    typeof config.contact !== "object" ||
    config.contact === null ||
    Array.isArray(config.contact)
  ) {
    return false;
  }
  const contact = config.contact as Record<string, unknown>;
  if (!isBoundedText(contact.email, FOOTER_LIMITS.email)) return false;
  if (contact.email !== null && !EMAIL_PATTERN.test(contact.email as string)) {
    return false;
  }
  if (!isBoundedText(contact.phone, FOOTER_LIMITS.phone)) return false;
  if (contact.phone !== null && !PHONE_PATTERN.test(contact.phone as string)) {
    return false;
  }
  if (!isBoundedText(contact.addressAr, FOOTER_LIMITS.address)) return false;
  if (!isBoundedText(contact.addressEn, FOOTER_LIMITS.address)) return false;

  if (!Array.isArray(config.social)) return false;
  if (config.social.length > FOOTER_MAX_SOCIAL_LINKS) return false;
  const seenNetworks = new Set<string>();
  for (const raw of config.social) {
    if (typeof raw !== "object" || raw === null) return false;
    const link = raw as Record<string, unknown>;
    if (!isFooterSocialNetwork(link.network)) return false;
    if (seenNetworks.has(link.network)) return false;
    seenNetworks.add(link.network);
    if (typeof link.enabled !== "boolean") return false;
    if (
      typeof link.url !== "string" ||
      link.url.length > FOOTER_LIMITS.socialUrl
    ) {
      return false;
    }
    if (!isAllowedSocialUrl(link.network, link.url)) return false;
  }

  if (!isBoundedText(config.copyrightAr, FOOTER_LIMITS.copyright)) return false;
  if (!isBoundedText(config.copyrightEn, FOOTER_LIMITS.copyright)) return false;
  if (typeof config.showDescription !== "boolean") return false;

  return true;
}

/**
 * The footer as the public site receives it, with the operator's
 * intentions already resolved against reality.
 *
 * The renderer gets a list it can draw without asking further
 * questions: disabled entries are gone, unpublished policies are gone,
 * each link carries its final path and its label in the requested
 * language. Deciding this once on the server is what keeps the two
 * languages and the two apps from disagreeing.
 */
export interface FooterLinkPublic {
  key: FooterPageKey;
  href: string;
  /** Null means "use this app's own translated name for that page". */
  label: string | null;
}

export interface FooterSocialPublic {
  network: FooterSocialNetwork;
  url: string;
}

export interface FooterPublic {
  links: FooterLinkPublic[];
  social: FooterSocialPublic[];
  email: string | null;
  phone: string | null;
  address: string | null;
  copyright: string | null;
  showDescription: boolean;
}

export const FOOTER_PUBLIC_KEYS = [
  "links",
  "social",
  "email",
  "phone",
  "address",
  "copyright",
  "showDescription",
] as const satisfies readonly (keyof FooterPublic)[];
