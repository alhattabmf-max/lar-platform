import { validateBannerLink } from "./banner-link.validation";

const ALLOWED = ["cdn.example.com", "assets.forsa.sa"];

const accept = (raw: string, allowed = ALLOWED) => validateBannerLink(raw, allowed);

describe("internal paths", () => {
  it.each([
    "/",
    "/opportunities",
    "/ar-SA/opportunities",
    "/opportunities?cityId=abc",
    "/opportunities#section",
    "/a/b/c/d",
  ])("accepts %s with no allowlist at all", (path) => {
    const result = accept(path, []);
    expect(result).toEqual({ ok: true, value: path });
  });

  it.each([
    ["protocol-relative", "//evil.example.com/x"],
    ["backslash", "/a\\b"],
    ["space", "/a b"],
    ["tab", "/a\tb"],
    ["newline", "/a\nb"],
  ])("refuses %s", (_label, path) => {
    expect(accept(path).ok).toBe(false);
  });

  it("labels a protocol-relative link specifically", () => {
    expect(accept("//evil.example.com")).toEqual({
      ok: false,
      reason: "PROTOCOL_RELATIVE",
    });
  });
});

describe("absolute https URLs", () => {
  it("accepts an allowlisted host", () => {
    expect(accept("https://cdn.example.com/promo.png")).toEqual({
      ok: true,
      value: "https://cdn.example.com/promo.png",
    });
  });

  it("normalises the stored value to what a browser resolves", () => {
    const result = accept("https://CDN.example.com/a/../b");
    expect(result).toEqual({ ok: true, value: "https://cdn.example.com/b" });
  });

  it("matches the host case-insensitively", () => {
    expect(accept("https://CDN.EXAMPLE.COM/x").ok).toBe(true);
  });

  it("tolerates untrimmed allowlist entries", () => {
    expect(accept("https://cdn.example.com/x", ["  cdn.example.com  "]).ok).toBe(true);
  });

  it("refuses a host that is not on the list", () => {
    expect(accept("https://evil.example.com/x")).toEqual({
      ok: false,
      reason: "HOST_NOT_ALLOWED",
    });
  });

  it("refuses a subdomain of an allowlisted host — the match is exact", () => {
    expect(accept("https://evil.cdn.example.com/x").ok).toBe(false);
  });

  it("refuses a host that merely contains an allowlisted one", () => {
    expect(accept("https://cdn.example.com.evil.test/x").ok).toBe(false);
  });

  it("refuses an allowlisted host on a non-default port", () => {
    // url.host includes the port, so this is a different host.
    expect(accept("https://cdn.example.com:8443/x").ok).toBe(false);
  });

  it("refuses userinfo smuggling", () => {
    expect(accept("https://cdn.example.com@evil.test/x").ok).toBe(false);
  });
});

describe("schemes", () => {
  it.each([
    ["javascript", "javascript:alert(1)"],
    ["javascript uppercase", "JavaScript:alert(1)"],
    ["data", "data:text/html;base64,PHNjcmlwdD4="],
    ["data image", "data:image/svg+xml,<svg onload=alert(1)>"],
    ["vbscript", "vbscript:msgbox(1)"],
    ["file", "file:///etc/passwd"],
    ["blob", "blob:https://cdn.example.com/x"],
    ["ftp", "ftp://cdn.example.com/x"],
    ["plain http", "http://cdn.example.com/x"],
    ["mailto", "mailto:a@b.test"],
    ["tel", "tel:+966500000000"],
  ])("refuses %s", (_label, raw) => {
    expect(accept(raw).ok).toBe(false);
  });

  it("refuses a scheme split by a control character", () => {
    // A regex-based check can be fooled by these; the whitespace guard
    // rejects them before any parsing happens.
    for (const raw of ["java\nscript:alert(1)", "java\tscript:alert(1)", "java\rscript:alert(1)"]) {
      expect(accept(raw).ok).toBe(false);
    }
  });

  it("reports plain http as an unsupported scheme, not a host problem", () => {
    expect(accept("http://cdn.example.com/x")).toEqual({
      ok: false,
      reason: "UNSUPPORTED_SCHEME",
    });
  });
});

describe("malformed input", () => {
  it.each([
    ["empty", ""],
    ["bare host", "cdn.example.com/x"],
    ["relative segment", "../secret"],
    ["single dot", "./x"],
    ["scheme only", "https:"],
    ["random text", "click here"],
    ["null byte", "/a\u0000b"],
  ])("refuses %s", (_label, raw) => {
    expect(accept(raw).ok).toBe(false);
  });

  it("never throws, whatever it is handed", () => {
    for (const raw of ["", "://", "https://", "%%%", "\u0000", "https://[", "/".repeat(5000)]) {
      expect(() => accept(raw)).not.toThrow();
    }
  });
});

describe("an empty allowlist", () => {
  it("blocks every external link while still permitting internal paths", () => {
    expect(accept("https://cdn.example.com/x", []).ok).toBe(false);
    expect(accept("/opportunities", []).ok).toBe(true);
  });
});
