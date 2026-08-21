import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMAIL_ERROR_CLASSES,
  EmailAbortedError,
  EmailDeliveryError,
  classifyEmailFailure,
  isRetryable,
  isTerminal,
} from "./errors";

/** A message crafted to look like leaked content, used to prove it is never read. */
const LEAKY = "SMTP 550 for buyer@example.com subject=Your invoice params={amount:1200}";

describe("the closed error class set", () => {
  it("contains exactly the agreed classes", () => {
    expect([...EMAIL_ERROR_CLASSES].sort()).toEqual(
      [
        "PROVIDER_TIMEOUT",
        "PROVIDER_RATE_LIMITED",
        "PROVIDER_5XX",
        "PROVIDER_REJECTED_RECIPIENT",
        "TEMPLATE_RENDER_FAILED",
        "RECIPIENT_NOT_FOUND",
        "RECIPIENT_INACTIVE",
        "PAYLOAD_INVALID",
        "ATTEMPTS_EXHAUSTED",
        "UNKNOWN",
      ].sort()
    );
  });

  it("carries ATTEMPTS_EXHAUSTED, the class for a row that ran out of budget", () => {
    expect(EMAIL_ERROR_CLASSES).toContain("ATTEMPTS_EXHAUSTED");
  });

  it.each(["PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMITED", "PROVIDER_5XX", "UNKNOWN"] as const)(
    "treats %s as retryable",
    (cls) => {
      expect(isRetryable(cls)).toBe(true);
      expect(isTerminal(cls)).toBe(false);
    }
  );

  it.each([
    "PROVIDER_REJECTED_RECIPIENT",
    "TEMPLATE_RENDER_FAILED",
    "RECIPIENT_NOT_FOUND",
    "RECIPIENT_INACTIVE",
    "PAYLOAD_INVALID",
    "ATTEMPTS_EXHAUSTED",
  ] as const)("treats %s as terminal", (cls) => {
    expect(isTerminal(cls)).toBe(true);
    expect(isRetryable(cls)).toBe(false);
  });

  it("never treats ATTEMPTS_EXHAUSTED as retryable — that would be a loop", () => {
    expect(isRetryable("ATTEMPTS_EXHAUSTED")).toBe(false);
  });

  it("classifies every class as exactly one of retryable or terminal", () => {
    for (const cls of EMAIL_ERROR_CLASSES) {
      expect(isRetryable(cls)).toBe(!isTerminal(cls));
    }
  });
});

describe("classification never reads the exception message", () => {
  it("is a source-level guarantee, not a convention", () => {
    // Comments are stripped first so this file's own explanation of the
    // rule cannot be mistaken for a violation of it.
    const source = readFileSync(join(__dirname, "errors.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(source).not.toMatch(/\.message\b/);
    expect(source).not.toMatch(/\bmessage\s*:/);
  });

  it("ignores a message that looks exactly like a real provider rejection", () => {
    const error = Object.assign(new Error(LEAKY), { statusCode: 500 });

    // Classified from the STATUS CODE. Had the message been consulted,
    // "550" would have suggested a recipient rejection.
    expect(classifyEmailFailure(error)).toBe("PROVIDER_5XX");
  });

  it("returns UNKNOWN for an error carrying only a message", () => {
    expect(classifyEmailFailure(new Error(LEAKY))).toBe("UNKNOWN");
  });

  it("puts no provider text into EmailDeliveryError's own message", () => {
    const error = new EmailDeliveryError("PROVIDER_RATE_LIMITED", { cause: new Error(LEAKY) });

    expect(error.message).toBe("PROVIDER_RATE_LIMITED");
    expect(String(error)).not.toContain("buyer@example.com");
  });
});

describe("classification by type and status code", () => {
  it("honours an error that already declares its class", () => {
    expect(classifyEmailFailure(new EmailDeliveryError("RECIPIENT_INACTIVE"))).toBe(
      "RECIPIENT_INACTIVE"
    );
  });

  it("maps our own abort to a timeout", () => {
    expect(classifyEmailFailure(new EmailAbortedError())).toBe("PROVIDER_TIMEOUT");
  });

  it.each(["AbortError", "TimeoutError"])("maps a %s to PROVIDER_TIMEOUT", (name) => {
    expect(classifyEmailFailure(Object.assign(new Error("x"), { name }))).toBe("PROVIDER_TIMEOUT");
  });

  it.each([
    [408, "PROVIDER_TIMEOUT"],
    [504, "PROVIDER_TIMEOUT"],
    [429, "PROVIDER_RATE_LIMITED"],
    [500, "PROVIDER_5XX"],
    [503, "PROVIDER_5XX"],
    [400, "PROVIDER_REJECTED_RECIPIENT"],
    [422, "PROVIDER_REJECTED_RECIPIENT"],
  ])("maps status %s to %s", (status, expected) => {
    expect(classifyEmailFailure({ statusCode: status })).toBe(expected);
  });

  it.each(["statusCode", "status", "httpStatus"])("reads the status from %s", (field) => {
    expect(classifyEmailFailure({ [field]: 429 })).toBe("PROVIDER_RATE_LIMITED");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "boom"],
    ["a number", 500],
    ["an empty object", {}],
    ["a non-numeric status", { statusCode: "500" }],
  ])("falls back to UNKNOWN for %s", (_label, thrown) => {
    expect(classifyEmailFailure(thrown)).toBe("UNKNOWN");
  });

  it("only ever returns a member of the closed set", () => {
    const inputs: unknown[] = [null, {}, new Error("x"), { statusCode: 418 }, { status: 999 }];
    for (const input of inputs) {
      expect(EMAIL_ERROR_CLASSES).toContain(classifyEmailFailure(input));
    }
  });
});
