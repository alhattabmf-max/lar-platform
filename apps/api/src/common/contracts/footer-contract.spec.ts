import {
  DEFAULT_FOOTER_CONFIG,
  FOOTER_LIMITS,
  FOOTER_MAX_SOCIAL_LINKS,
  FOOTER_PAGES,
  FOOTER_PAGE_KEYS,
  FOOTER_SOCIAL_NETWORK_KEYS,
  isAllowedSocialUrl,
  isFooterConfig,
  type FooterConfig,
} from "@platform/types";

/**
 * The footer is the one operator-written surface that appears on EVERY
 * public page, signed out, to everyone. `isFooterConfig` is the only
 * door into the column it is stored in, so what this file pins is
 * mostly what the door REFUSES — an accepting test proves a happy path,
 * a refusing test proves the boundary.
 */

const config = (over: Partial<FooterConfig> = {}): unknown => ({
  ...DEFAULT_FOOTER_CONFIG,
  ...over,
});

describe("the footer's internal destinations are a closed list", () => {
  it("resolves every key to a path that starts at the site root", () => {
    for (const key of FOOTER_PAGE_KEYS) {
      expect(FOOTER_PAGES[key].path).toMatch(/^\/[a-z-]+$/);
    }
  });

  it("carries no absolute address anywhere — nothing can point off-site", () => {
    const paths = FOOTER_PAGE_KEYS.map((key) => FOOTER_PAGES[key].path);
    for (const path of paths) {
      expect(path).not.toMatch(/^[a-z]+:/i);
      expect(path).not.toMatch(/^\/\//);
    }
  });

  it("refuses a page key it does not define", () => {
    expect(
      isFooterConfig(
        config({
          links: [
            {
              page: "https://evil.example",
              labelAr: null,
              labelEn: null,
              enabled: true,
            } as never,
          ],
        }),
      ),
    ).toBe(false);
  });

  it("refuses the same destination twice", () => {
    expect(
      isFooterConfig(
        config({
          links: [
            { page: "about", labelAr: null, labelEn: null, enabled: true },
            { page: "about", labelAr: null, labelEn: null, enabled: false },
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe("a social link is a network plus one of that network's own hosts", () => {
  it.each([
    ["x", "https://x.com/forsa"],
    ["x", "https://twitter.com/forsa"],
    ["linkedin", "https://www.linkedin.com/company/forsa"],
    ["linkedin", "https://sa.linkedin.com/company/forsa"],
    ["youtube", "https://youtu.be/abc"],
    ["whatsapp", "https://wa.me/966500000000"],
  ] as const)("accepts %s → %s", (network, url) => {
    expect(isAllowedSocialUrl(network, url)).toBe(true);
  });

  it.each([
    ["plain http", "x", "http://x.com/forsa"],
    ["a script URL", "x", "javascript:alert(1)"],
    ["a data URL", "x", "data:text/html,<script>alert(1)</script>"],
    ["another site entirely", "x", "https://evil.example/forsa"],
    // The classic look-alike: `x.com` reads as the host but is a
    // username, and the browser goes to evil.example.
    ["a credential-smuggled host", "x", "https://x.com@evil.example/"],
    // Substring matching accepts this; label matching does not.
    ["a suffix look-alike", "linkedin", "https://linkedin.com.evil.example/"],
    ["the wrong network's host", "linkedin", "https://instagram.com/forsa"],
    ["not a URL at all", "x", "x.com/forsa"],
    // A backslash is treated as a separator by some browsers, so the
    // real host here is evil.example.
    ["a backslash separator", "x", "https://x.com\\@evil.example/"],
    ["a backslash before the path", "x", "https://evil.example\\x.com"],
    ["whitespace inside the host", "x", "https://x .com/forsa"],
    ["a newline inside the host", "x", "https://x.com\n.evil.example/"],
    ["a percent-encoded host", "x", "https://%78.com/forsa"],
    ["an empty host", "x", "https:///forsa"],
    ["a bare scheme", "x", "https://"],
    ["an empty string", "x", ""],
    ["the scheme repeated", "x", "https://https://x.com"],
  ] as const)("refuses %s", (_label, network, url) => {
    expect(isAllowedSocialUrl(network, url)).toBe(false);
  });

  it("refuses a network it does not know", () => {
    expect(
      isFooterConfig(
        config({
          social: [
            { network: "myspace", url: "https://x.com/f", enabled: true } as never,
          ],
        }),
      ),
    ).toBe(false);
  });

  it("refuses more accounts than there are networks", () => {
    expect(
      isFooterConfig(
        config({
          social: Array.from({ length: FOOTER_MAX_SOCIAL_LINKS + 1 }, () => ({
            network: "x" as const,
            url: "https://x.com/forsa",
            enabled: true,
          })),
        }),
      ),
    ).toBe(false);
  });

  it("refuses the same network twice", () => {
    expect(
      isFooterConfig(
        config({
          social: [
            { network: "x", url: "https://x.com/a", enabled: true },
            { network: "x", url: "https://x.com/b", enabled: true },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("has a host list for every network it names", () => {
    for (const network of FOOTER_SOCIAL_NETWORK_KEYS) {
      expect(isAllowedSocialUrl(network, "https://evil.example/x")).toBe(false);
    }
  });
});

describe("operator text is bounded and shaped", () => {
  it("refuses a label past its limit", () => {
    expect(
      isFooterConfig(
        config({
          links: [
            {
              page: "about",
              labelAr: "ا".repeat(FOOTER_LIMITS.label + 1),
              labelEn: null,
              enabled: true,
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("refuses an empty label — null means «use the shipped wording»", () => {
    expect(
      isFooterConfig(
        config({
          links: [
            { page: "about", labelAr: "   ", labelEn: null, enabled: true },
          ],
        }),
      ),
    ).toBe(false);
  });

  it.each([
    ["no at sign", "forsa.example"],
    ["a space", "hello there@forsa.example"],
    // A newline in a value that later reaches a mail header is the
    // injection this bounds.
    ["a newline", "ops@forsa.example\nBcc: someone@evil.example"],
    ["two addresses", "a@forsa.example,b@forsa.example"],
  ])("refuses an e-mail with %s", (_label, email) => {
    expect(
      isFooterConfig(config({ contact: { ...DEFAULT_FOOTER_CONFIG.contact, email } })),
    ).toBe(false);
  });

  it("accepts an ordinary e-mail", () => {
    expect(
      isFooterConfig(
        config({
          contact: {
            ...DEFAULT_FOOTER_CONFIG.contact,
            email: "support@forsa.example",
          },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ["+966 11 000 0000"],
    ["0112345678"],
    ["+966-11-000-0000"],
    ["(011) 234 5678"],
  ])("accepts the telephone %s", (phone) => {
    expect(
      isFooterConfig(config({ contact: { ...DEFAULT_FOOTER_CONFIG.contact, phone } })),
    ).toBe(true);
  });

  it.each([["call us"], ["12"], ["+966 11 <script>"]])(
    "refuses the telephone %s",
    (phone) => {
      expect(
        isFooterConfig(
          config({ contact: { ...DEFAULT_FOOTER_CONFIG.contact, phone } }),
        ),
      ).toBe(false);
    },
  );

  it("refuses an address past its limit", () => {
    expect(
      isFooterConfig(
        config({
          contact: {
            ...DEFAULT_FOOTER_CONFIG.contact,
            addressAr: "ا".repeat(FOOTER_LIMITS.address + 1),
          },
        }),
      ),
    ).toBe(false);
  });

  it("refuses a copyright line past its limit", () => {
    expect(
      isFooterConfig(
        config({ copyrightAr: "ا".repeat(FOOTER_LIMITS.copyright + 1) }),
      ),
    ).toBe(false);
  });
});

describe("the shape itself", () => {
  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "{}"],
    ["a number", 7],
  ])("refuses %s", (_label, value) => {
    expect(isFooterConfig(value)).toBe(false);
  });

  it("refuses a missing links array", () => {
    const { links: _links, ...rest } = DEFAULT_FOOTER_CONFIG;
    expect(isFooterConfig(rest)).toBe(false);
  });

  it("refuses a missing contact block", () => {
    const { contact: _contact, ...rest } = DEFAULT_FOOTER_CONFIG;
    expect(isFooterConfig(rest)).toBe(false);
  });

  it("refuses `enabled` that is not a boolean", () => {
    expect(
      isFooterConfig(
        config({
          links: [
            {
              page: "about",
              labelAr: null,
              labelEn: null,
              enabled: "yes",
            } as never,
          ],
        }),
      ),
    ).toBe(false);
  });

  it("accepts what a fresh installation ships with", () => {
    expect(isFooterConfig(DEFAULT_FOOTER_CONFIG)).toBe(true);
  });

  /**
   * The footer that shipped hardcoded had exactly these five links in
   * this order. A platform that has never opened the footer screen must
   * look unchanged, so this pins the default against a silent
   * reordering.
   */
  it("ships the five links the hardcoded footer had, in that order", () => {
    expect(DEFAULT_FOOTER_CONFIG.links.map((l) => l.page)).toEqual([
      "about",
      "faq",
      "contact",
      "terms",
      "privacy",
    ]);
    expect(DEFAULT_FOOTER_CONFIG.links.every((l) => l.enabled)).toBe(true);
  });

  it("names a policy code on exactly the two policy destinations", () => {
    const withCode = FOOTER_PAGE_KEYS.filter(
      (key) => "policyCode" in FOOTER_PAGES[key],
    );
    expect(withCode.sort()).toEqual(["privacy", "terms"]);
  });
});
