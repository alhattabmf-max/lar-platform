import {
  DEFAULT_BANNER_IMAGE_SHAPE,
  checkBannerImageShape,
  describeBannerShapeRejection,
  formatAspectRatio,
} from "@platform/types";

/**
 * The banner shape rule, checked where it is DECIDED.
 *
 * The browser runs the same function before uploading, to fail fast
 * with a useful message. This is the check that actually decides: a
 * caller that never opens the admin screen reaches the endpoint just
 * the same, so the browser's answer is a convenience and never a
 * security boundary.
 */

const SHAPE = DEFAULT_BANNER_IMAGE_SHAPE;

describe("the accepted band", () => {
  it("is the agreed policy: 5:1 preferred, 3:1 to 6:1, minimum 1500x300", () => {
    expect(SHAPE.preferredAspectRatio).toBe(5);
    expect(SHAPE.minAspectRatio).toBe(3);
    expect(SHAPE.maxAspectRatio).toBe(6);
    expect(SHAPE.minWidth).toBe(1500);
    expect(SHAPE.minHeight).toBe(300);
  });

  it("puts the preferred ratio inside its own band", () => {
    expect(SHAPE.preferredAspectRatio).toBeGreaterThanOrEqual(
      SHAPE.minAspectRatio,
    );
    expect(SHAPE.preferredAspectRatio).toBeLessThanOrEqual(
      SHAPE.maxAspectRatio,
    );
  });
});

describe("images that are accepted", () => {
  it.each([
    ["the preferred 5:1", 2000, 400],
    ["exactly at the minimum size and ratio", 1500, 300],
    ["the narrow edge of the band, 3:1", 1500, 500],
    ["the wide edge of the band, 6:1", 1800, 300],
    ["a large 5:1", 4000, 800],
  ])("accepts %s", (_why, width, height) => {
    expect(checkBannerImageShape(width, height, SHAPE)).toBeNull();
  });
});

describe("images that are refused", () => {
  it("refuses a PORTRAIT photograph outright", () => {
    // The case the policy exists for: a phone photo dropped into a
    // promotional strip is either squashed or cropped to a sliver.
    const rejection = checkBannerImageShape(1080, 1920, SHAPE);
    expect(rejection).not.toBeNull();
    expect(rejection!.reason).toBe("TOO_SMALL");
  });

  it("refuses a square", () => {
    expect(checkBannerImageShape(2000, 2000, SHAPE)!.reason).toBe("TOO_TALL");
  });

  it("refuses an image below the minimum width", () => {
    const rejection = checkBannerImageShape(1400, 300, SHAPE);
    expect(rejection!.reason).toBe("TOO_SMALL");
  });

  it("refuses an image below the minimum height", () => {
    expect(checkBannerImageShape(1500, 299, SHAPE)!.reason).toBe("TOO_SMALL");
  });

  it("refuses a ratio just outside each edge of the band", () => {
    // 1500x501 is 2.99:1 — narrower than 3:1.
    expect(checkBannerImageShape(1500, 501, SHAPE)!.reason).toBe("TOO_TALL");
    // 1810x300 is 6.03:1 — wider than 6:1.
    expect(checkBannerImageShape(1810, 300, SHAPE)!.reason).toBe("TOO_WIDE");
  });

  it("checks SIZE before ratio, so the first thing wrong is the thing reported", () => {
    // A 300x60 image is both too small and correctly proportioned;
    // telling someone their 5:1 image is the wrong ratio would be a lie.
    const rejection = checkBannerImageShape(300, 60, SHAPE);
    expect(rejection!.reason).toBe("TOO_SMALL");
  });
});

describe("the refusal says what is wrong and what was needed", () => {
  it("names the ACTUAL dimensions and the required minimum", () => {
    const rejection = checkBannerImageShape(800, 600, SHAPE)!;
    const message = describeBannerShapeRejection(rejection, SHAPE);

    // "Invalid image" tells an operator nothing about what to do next.
    expect(message).toContain("800x600");
    expect(message).toContain("1500x300");
  });

  it("names the actual ratio, the accepted range, and the preferred one", () => {
    const rejection = checkBannerImageShape(2000, 1000, SHAPE)!;
    const message = describeBannerShapeRejection(rejection, SHAPE);

    expect(message).toContain("2000x1000");
    expect(message).toContain("2:1");
    expect(message).toContain("3:1");
    expect(message).toContain("6:1");
    expect(message).toContain("5:1");
    expect(message).toContain("too tall");
  });

  it("says too WIDE for an over-wide image", () => {
    const rejection = checkBannerImageShape(3000, 300, SHAPE)!;
    expect(describeBannerShapeRejection(rejection, SHAPE)).toContain(
      "too wide",
    );
  });

  it("formats a ratio readably, without a wall of decimals", () => {
    expect(formatAspectRatio(5)).toBe("5:1");
    expect(formatAspectRatio(2.5)).toBe("2.5:1");
    expect(formatAspectRatio(1000 / 333)).toBe("3:1");
  });
});

describe("the limits live in the policy, not in the code that uses them", () => {
  it("honours a policy that widens the band", () => {
    const permissive = {
      ...SHAPE,
      minAspectRatio: 1,
      maxAspectRatio: 10,
      minWidth: 100,
      minHeight: 50,
    };

    // A square is refused by the default band and accepted by this one:
    // the rule reads the policy rather than carrying its own numbers.
    expect(checkBannerImageShape(500, 500, SHAPE)).not.toBeNull();
    expect(checkBannerImageShape(500, 500, permissive)).toBeNull();
  });

  it("honours a policy that narrows it", () => {
    const strict = { ...SHAPE, minAspectRatio: 4.9, maxAspectRatio: 5.1 };

    expect(checkBannerImageShape(1500, 500, SHAPE)).toBeNull();
    expect(checkBannerImageShape(1500, 500, strict)).not.toBeNull();
  });
});
