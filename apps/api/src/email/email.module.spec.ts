import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createEmailProvider } from "./email.module";
import { EMAIL_PROVIDER } from "./email-provider.interface";

function sourceOf(relativePath: string): string {
  // Comments stripped so a file's explanation of a rule is never read
  // as a violation of it.
  return readFileSync(join(__dirname, "..", "..", relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the API email adapter is thin", () => {
  it("returns the shared provider, reporting mock mode", () => {
    expect(createEmailProvider().mode).toBe("mock");
  });

  it("keeps the DI token a unique symbol", () => {
    expect(typeof EMAIL_PROVIDER).toBe("symbol");
  });

  it("implements no sending behaviour of its own", () => {
    const source = sourceOf("src/email/email.module.ts");

    // The adapter wires; it must not render, retry, or transport.
    expect(source).not.toMatch(/class\s+\w*EmailProvider\b/);
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("nodemailer");
  });

  it("sources the provider from @platform/email, not from a local copy", () => {
    expect(sourceOf("src/email/email.module.ts")).toContain('from "@platform/email"');
  });

  it("no longer ships an API-local provider implementation", () => {
    // Deleted in 8D0.1: apps/worker cannot import from apps/api, so a
    // second implementation here would be one the relay could not use
    // and would silently drift.
    expect(() => sourceOf("src/email/mock-email.provider.ts")).toThrow();
  });
});

describe("the email log surface", () => {
  it("passes the provider's closed record through untouched", () => {
    const source = sourceOf("src/email/email.module.ts");

    // The adapter must not build its own log object — that is where an
    // address or a subject would be reintroduced.
    expect(source).not.toMatch(/\bto\b\s*:/);
    expect(source).not.toMatch(/subject/i);
    expect(source).not.toMatch(/htmlBody|textBody/);
  });
});

describe("the boot validator runs in BOTH processes", () => {
  it.each([
    ["the API", "src/bootstrap/configure-app.ts"],
    ["the worker", "../worker/src/main.ts"],
  ])("%s bootstrap calls assertEmailDeliveryConfigured", (_label, path) => {
    // A3: living in configureApp alone would leave the worker — the
    // process that runs the relay — starting happily against a mock
    // provider in production.
    expect(sourceOf(path)).toContain("assertEmailDeliveryConfigured(");
  });

  it("the worker validates before it connects to anything", () => {
    const source = sourceOf("../worker/src/main.ts");

    const validateAt = source.indexOf("assertEmailDeliveryConfigured(");
    const prismaAt = source.indexOf("new PrismaClient(");
    const redisAt = source.indexOf("createBullMqRedisConnection(");

    expect(validateAt).toBeGreaterThan(-1);
    expect(validateAt).toBeLessThan(prismaAt);
    expect(validateAt).toBeLessThan(redisAt);
  });
});
