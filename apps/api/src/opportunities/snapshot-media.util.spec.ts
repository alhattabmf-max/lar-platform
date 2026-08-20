import { hasSnapshotImage, parseSnapshotMedia, selectMainMedia } from "./snapshot-media.util";

function entry(objectKey: string, isMain = false, sortOrder = 0) {
  return { objectKey, thumbnailObjectKey: `${objectKey}-thumb`, isMain, sortOrder };
}

describe("parseSnapshotMedia — malformed input never throws", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "media"],
    ["a number", 42],
    ["an array", []],
    ["an empty object", {}],
    ["media as null", { media: null }],
    ["media as a string", { media: "none" }],
    ["media as an object", { media: { objectKey: "k" } }],
  ])("returns an empty list for %s", (_label, snapshot) => {
    expect(() => parseSnapshotMedia(snapshot)).not.toThrow();
    expect(parseSnapshotMedia(snapshot)).toEqual([]);
  });

  it("drops entries missing a key rather than rejecting the whole snapshot", () => {
    const media = [
      { objectKey: "a", thumbnailObjectKey: "a-thumb", isMain: true, sortOrder: 0 },
      { objectKey: "b" },
      { thumbnailObjectKey: "c-thumb" },
      { objectKey: "", thumbnailObjectKey: "d-thumb" },
      null,
      "not-an-entry",
    ];

    expect(parseSnapshotMedia({ media }).map((m) => m.objectKey)).toEqual(["a"]);
  });

  it("defaults a missing isMain to false and a missing sortOrder to zero", () => {
    const parsed = parseSnapshotMedia({
      media: [{ objectKey: "a", thumbnailObjectKey: "a-thumb" }],
    });

    expect(parsed[0]).toEqual({
      objectKey: "a",
      thumbnailObjectKey: "a-thumb",
      isMain: false,
      sortOrder: 0,
    });
  });

  it("treats a non-boolean isMain as not main", () => {
    const parsed = parseSnapshotMedia({
      media: [{ objectKey: "a", thumbnailObjectKey: "a-thumb", isMain: "yes" }],
    });

    expect(parsed[0].isMain).toBe(false);
  });
});

describe("legacy snapshots", () => {
  it("a pre-7A snapshot with no media key yields no image", () => {
    // The shape isLegacySnapshotShape() detects: salesUnitId, no names,
    // and no media array at all.
    const legacy = { salesUnitId: "11111111-1111-1111-1111-111111111111", nameAr: "ع", nameEn: "e" };

    expect(selectMainMedia(legacy)).toBeNull();
    expect(hasSnapshotImage(legacy)).toBe(false);
  });

  it("a snapshot with an empty media array yields no image", () => {
    expect(selectMainMedia({ media: [] })).toBeNull();
    expect(hasSnapshotImage({ media: [] })).toBe(false);
  });
});

describe("selectMainMedia — deterministic order", () => {
  it("prefers isMain over every other consideration", () => {
    const media = [
      entry("z", false, 0),
      entry("a", true, 99),
      entry("b", false, 1),
    ];

    expect(selectMainMedia({ media })!.objectKey).toBe("a");
  });

  it("falls back to the lowest sortOrder when nothing is main", () => {
    const media = [entry("z", false, 5), entry("a", false, 2), entry("m", false, 9)];

    expect(selectMainMedia({ media })!.objectKey).toBe("a");
  });

  it("breaks a sortOrder tie by objectKey, so the choice is stable", () => {
    const media = [entry("m", false, 3), entry("a", false, 3), entry("z", false, 3)];

    expect(selectMainMedia({ media })!.objectKey).toBe("a");
  });

  it("returns the same entry no matter the input order", () => {
    const media = [entry("m", false, 3), entry("a", false, 3), entry("z", false, 3)];
    const permutations = [
      [media[0], media[1], media[2]],
      [media[2], media[1], media[0]],
      [media[1], media[2], media[0]],
      [media[2], media[0], media[1]],
    ];

    const chosen = permutations.map((m) => selectMainMedia({ media: m })!.objectKey);
    expect(new Set(chosen).size).toBe(1);
    expect(chosen[0]).toBe("a");
  });

  it("picks deterministically even with two entries flagged main", () => {
    // setMain clears the others in a transaction, so this should not
    // occur — but a frozen snapshot is immutable history and could
    // predate that guarantee.
    const media = [entry("z", true, 1), entry("a", true, 1)];

    expect(selectMainMedia({ media })!.objectKey).toBe("a");
  });

  it("does not mutate the input array", () => {
    const media = [entry("z", false, 5), entry("a", false, 2)];
    const before = media.map((m) => m.objectKey);

    selectMainMedia({ media });

    expect(media.map((m) => m.objectKey)).toEqual(before);
  });

  it("carries the matching thumbnail key for the chosen entry", () => {
    const media = [entry("z", false, 5), entry("a", true, 9)];

    const chosen = selectMainMedia({ media })!;
    expect(chosen.objectKey).toBe("a");
    expect(chosen.thumbnailObjectKey).toBe("a-thumb");
  });
});
