import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@platform/types";
import { ApiError, networkError } from "@/lib/errors";
import {
  isPolicyReacceptanceRequired,
  isRegistrationConflict,
  toUserFacingError,
} from "@/lib/error-messages";

function apiError(code: string, kind: ApiError["kind"] = "conflict", requestId = "req-1") {
  return new ApiError({
    kind,
    status: 409,
    code: code as never,
    requestId,
    message: "developer-facing text that must never be rendered",
  });
}

describe("known codes map to a specific key", () => {
  it.each(Object.values(ERROR_CODES))("maps %s", (code) => {
    const mapped = toUserFacingError(apiError(code));

    expect(mapped.messageKey).toBe(`errors.codes.${code}`);
  });
});

describe("unknown failures collapse to the generic message", () => {
  it.each([
    ["a plain Error", new Error("ENOENT: /home/app/secret.key")],
    ["a string", "boom"],
    ["null", null],
    ["undefined", undefined],
    ["an object", { message: "internal" }],
  ])("%s becomes errors.unknown", (_label, thrown) => {
    const mapped = toUserFacingError(thrown);

    expect(mapped.messageKey).toBe("errors.unknown");
    expect(mapped.kind).toBe("unknown");
    expect(mapped.requestId).toBeNull();
  });

  it("an unrecognised server code keeps the requestId but not the code", () => {
    const mapped = toUserFacingError(apiError("SOME_FUTURE_CODE", "conflict", "req-9"));

    expect(mapped.messageKey).toBe("errors.unknown");
    expect(mapped.requestId).toBe("req-9");
  });

  it("a network failure has its own key and no requestId", () => {
    const mapped = toUserFacingError(networkError(new TypeError("Failed to fetch")));

    expect(mapped.messageKey).toBe("errors.network");
    expect(mapped.requestId).toBeNull();
  });
});

describe("nothing internal ever reaches the UI", () => {
  it("never surfaces the developer-facing message", () => {
    const mapped = toUserFacingError(apiError(ERROR_CODES.CONFLICT));

    expect(JSON.stringify(mapped)).not.toContain("developer-facing");
  });

  it("never surfaces a stack or a file path", () => {
    const mapped = toUserFacingError(new Error("at /srv/app/dist/main.js:42"));

    expect(JSON.stringify(mapped)).not.toContain("/srv/app");
    expect(JSON.stringify(mapped)).not.toContain("main.js");
  });

  it("exposes only three fields", () => {
    const mapped = toUserFacingError(apiError(ERROR_CODES.FORBIDDEN));

    expect(Object.keys(mapped).sort()).toEqual(["kind", "messageKey", "requestId"]);
  });
});

describe("registration conflict detection", () => {
  it("recognises the neutral conflict code", () => {
    expect(isRegistrationConflict(apiError(ERROR_CODES.REGISTRATION_CONFLICT))).toBe(true);
  });

  it("does not fire for other conflicts", () => {
    expect(isRegistrationConflict(apiError(ERROR_CODES.CONFLICT))).toBe(false);
    expect(isRegistrationConflict(apiError(ERROR_CODES.VALIDATION_FAILED))).toBe(false);
    expect(isRegistrationConflict(new Error("x"))).toBe(false);
  });

  it("keeps policy re-acceptance separate — it is actionable, not an oracle", () => {
    const policy = apiError(ERROR_CODES.POLICY_REACCEPTANCE_REQUIRED);

    expect(isPolicyReacceptanceRequired(policy)).toBe(true);
    expect(isRegistrationConflict(policy)).toBe(false);
  });

  it("has no per-field conflict code to detect", () => {
    // The catalogue no longer carries CR/email-specific codes, so the
    // UI cannot branch on them even by mistake.
    expect(Object.values(ERROR_CODES)).not.toContain("CR_ALREADY_REGISTERED");
    expect(Object.values(ERROR_CODES)).not.toContain("EMAIL_ALREADY_REGISTERED");
  });
});
