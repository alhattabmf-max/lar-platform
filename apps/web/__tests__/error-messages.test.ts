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

  it("exposes only the five named fields", () => {
    // A FIFTH JOINED THEM, under the same rule as the others: it is
    // named, it is EMPTY unless a specific reader recognised the
    // payload, and its vocabulary is closed. Nothing general from
    // `details` reaches the UI, which is what this test exists to keep
    // true — the count is the point, not the number.
    const mapped = toUserFacingError(apiError(ERROR_CODES.FORBIDDEN));

    expect(Object.keys(mapped).sort()).toEqual([
      "blockedReason",
      "invalidFields",
      "kind",
      "messageKey",
      "requestId",
    ]);
    // And both stay empty for a failure that named nothing.
    expect(mapped.blockedReason).toBeNull();
    expect(mapped.invalidFields).toEqual([]);
  });

  /**
   * THE FIFTH IS THE ONE THAT CARRIES FIELD NAMES, so it is the one a
   * server string could ride into the UI on. It cannot: what crosses
   * is a NAME that matched a closed list, and the screen renders its
   * own label for it.
   */
  it("carries the names through, and the sentence never with them", () => {
    // `readInvalidFields` is what turns a payload into names, and its
    // own rules are pinned in `packages/types`. What is pinned HERE is
    // that this mapper passes the NAMES on and adds nothing else.
    const error = new ApiError({
      kind: "validation",
      status: 400,
      code: ERROR_CODES.VALIDATION_FAILED as never,
      requestId: "req-1",
      message: "accountHolderName must be longer than or equal to 1 characters",
      invalidFields: ["accountHolderName"] as never,
    });

    const mapped = toUserFacingError(error);

    expect(mapped.invalidFields).toEqual(["accountHolderName"]);
    expect(JSON.stringify(mapped)).not.toContain("longer than or equal");
  });

  it("carries an empty list when the reader recognised nothing", () => {
    const error = new ApiError({
      kind: "validation",
      status: 400,
      code: ERROR_CODES.VALIDATION_FAILED as never,
      requestId: "req-1",
      message: "internalLedgerRef must be a UUID",
    });

    const mapped = toUserFacingError(error);

    expect(mapped.invalidFields).toEqual([]);
    expect(JSON.stringify(mapped)).not.toContain("internalLedgerRef");
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
