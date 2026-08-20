import {
  checkOverlap,
  deriveBannerState,
  maxConcurrentWindows,
  type BannerWindow,
} from "./banner-window.util";

const NOW = new Date("2026-08-20T12:00:00.000Z");

function at(offsetMinutes: number): Date {
  return new Date(NOW.getTime() + offsetMinutes * 60_000);
}

function w(id: string, startsAt: Date | null, endsAt: Date | null): BannerWindow {
  return { id, startsAt, endsAt };
}

describe("maxConcurrentWindows", () => {
  it("is zero for no windows", () => {
    expect(maxConcurrentWindows([], NOW)).toBe(0);
  });

  describe("open-ended windows", () => {
    it("counts a fully unbounded window", () => {
      expect(maxConcurrentWindows([w("a", null, null)], NOW)).toBe(1);
    });

    it("stacks unbounded windows — they never release their slot", () => {
      expect(
        maxConcurrentWindows([w("a", null, null), w("b", null, null), w("c", null, null)], NOW)
      ).toBe(3);
    });

    it("counts an open-ended window that started in the past", () => {
      expect(maxConcurrentWindows([w("a", at(-600), null)], NOW)).toBe(1);
    });

    it("an unbounded window overlaps every future window", () => {
      expect(
        maxConcurrentWindows([w("a", null, null), w("b", at(100), at(200))], NOW)
      ).toBe(2);
    });
  });

  describe("scheduled windows", () => {
    it("counts a future window", () => {
      expect(maxConcurrentWindows([w("a", at(60), at(120))], NOW)).toBe(1);
    });

    it("sequential future windows never overlap", () => {
      expect(
        maxConcurrentWindows(
          [w("a", at(10), at(20)), w("b", at(30), at(40)), w("c", at(50), at(60))],
          NOW
        )
      ).toBe(1);
    });

    it("finds the peak in the middle of a staircase", () => {
      // a: 0-100, b: 10-110, c: 20-120  → all three overlap at 20
      expect(
        maxConcurrentWindows(
          [w("a", at(0), at(100)), w("b", at(10), at(110)), w("c", at(20), at(120))],
          NOW
        )
      ).toBe(3);
    });

    it("finds the peak even when it occurs long after now", () => {
      expect(
        maxConcurrentWindows(
          [w("a", at(1000), at(2000)), w("b", at(1500), at(2500))],
          NOW
        )
      ).toBe(2);
    });
  });

  describe("expired windows", () => {
    it("ignores a window that already ended — the cap must not ratchet shut", () => {
      expect(maxConcurrentWindows([w("a", at(-100), at(-50))], NOW)).toBe(0);
    });

    it("ignores a window ending EXACTLY at now (exclusive end)", () => {
      expect(maxConcurrentWindows([w("a", at(-100), NOW)], NOW)).toBe(0);
    });

    it("many expired windows consume nothing", () => {
      const expired = Array.from({ length: 50 }, (_, i) => w(`e${i}`, at(-200), at(-100)));
      expect(maxConcurrentWindows([...expired, w("live", null, null)], NOW)).toBe(1);
    });
  });

  describe("touching windows at the same instant", () => {
    it("a window ending at T and one starting at T do NOT overlap", () => {
      expect(
        maxConcurrentWindows([w("a", at(10), at(20)), w("b", at(20), at(30))], NOW)
      ).toBe(1);
    });

    it("a one-millisecond overlap DOES count", () => {
      expect(
        maxConcurrentWindows(
          [w("a", at(10), new Date(at(20).getTime() + 1)), w("b", at(20), at(30))],
          NOW
        )
      ).toBe(2);
    });

    it("windows starting at the same instant overlap", () => {
      expect(
        maxConcurrentWindows([w("a", at(10), at(20)), w("b", at(10), at(20))], NOW)
      ).toBe(2);
    });

    it("a chain of touching windows never exceeds one", () => {
      const chain = Array.from({ length: 10 }, (_, i) => w(`c${i}`, at(i * 10), at((i + 1) * 10)));
      expect(maxConcurrentWindows(chain, NOW)).toBe(1);
    });
  });

  describe("null boundaries", () => {
    it("null start with a future end counts from now", () => {
      expect(maxConcurrentWindows([w("a", null, at(60))], NOW)).toBe(1);
    });

    it("null start with an end at now does not count", () => {
      expect(maxConcurrentWindows([w("a", null, NOW)], NOW)).toBe(0);
    });

    it("null end with a future start counts", () => {
      expect(maxConcurrentWindows([w("a", at(60), null)], NOW)).toBe(1);
    });

    it("clips an in-progress window to now rather than to its real start", () => {
      // Two windows that overlapped in the PAST but not from now onward.
      expect(
        maxConcurrentWindows([w("a", at(-100), at(-10)), w("b", at(-50), null)], NOW)
      ).toBe(1);
    });
  });

  describe("boundary semantics at now", () => {
    it("starts_at exactly at now is live", () => {
      expect(maxConcurrentWindows([w("a", NOW, at(10))], NOW)).toBe(1);
    });

    it("ends_at exactly at now is not live", () => {
      expect(maxConcurrentWindows([w("a", at(-10), NOW)], NOW)).toBe(0);
    });
  });
});

describe("checkOverlap", () => {
  const proposed = w("new", null, null);

  it("accepts a peak exactly equal to the limit", () => {
    const others = [w("a", null, null), w("b", null, null)];
    const result = checkOverlap({ others, proposed, now: NOW, maxConcurrent: 3 });

    expect(result.peak).toBe(3);
    expect(result.allowed).toBe(true);
  });

  it("refuses a peak of limit + 1", () => {
    const others = [w("a", null, null), w("b", null, null), w("c", null, null)];
    const result = checkOverlap({ others, proposed, now: NOW, maxConcurrent: 3 });

    expect(result.peak).toBe(4);
    expect(result.allowed).toBe(false);
  });

  it("allows activation when existing banners are all expired", () => {
    const others = Array.from({ length: 10 }, (_, i) => w(`e${i}`, at(-200), at(-100)));
    const result = checkOverlap({ others, proposed, now: NOW, maxConcurrent: 1 });

    expect(result.peak).toBe(1);
    expect(result.allowed).toBe(true);
  });

  it("allows a window scheduled into a gap between existing ones", () => {
    const others = [w("a", at(0), at(10)), w("b", at(20), at(30))];
    const result = checkOverlap({
      others,
      proposed: w("new", at(10), at(20)),
      now: NOW,
      maxConcurrent: 1,
    });

    expect(result.allowed).toBe(true);
  });

  it("refuses a window that straddles two existing ones", () => {
    const others = [w("a", at(0), at(10)), w("b", at(20), at(30))];
    const result = checkOverlap({
      others,
      proposed: w("new", at(5), at(25)),
      now: NOW,
      maxConcurrent: 1,
    });

    expect(result.allowed).toBe(false);
    expect(result.peak).toBe(2);
  });

  it("evaluates the PROPOSED window, not the stored one (editing an active banner)", () => {
    const others = [w("a", at(0), at(10))];

    const conflicting = checkOverlap({
      others,
      proposed: w("edited", at(5), at(15)),
      now: NOW,
      maxConcurrent: 1,
    });
    const moved = checkOverlap({
      others,
      proposed: w("edited", at(10), at(20)),
      now: NOW,
      maxConcurrent: 1,
    });

    expect(conflicting.allowed).toBe(false);
    expect(moved.allowed).toBe(true);
  });

  it("a limit of zero refuses everything", () => {
    expect(checkOverlap({ others: [], proposed, now: NOW, maxConcurrent: 0 }).allowed).toBe(false);
  });
});

describe("deriveBannerState", () => {
  it.each([
    ["inactive is DRAFT regardless of window", false, null, null, "DRAFT"],
    ["inactive with a live window is still DRAFT", false, at(-10), at(10), "DRAFT"],
    ["active unbounded is LIVE", true, null, null, "LIVE"],
    ["active with open window is LIVE", true, at(-10), at(10), "LIVE"],
    ["active starting in the future is SCHEDULED", true, at(10), at(20), "SCHEDULED"],
    ["active already ended is EXPIRED", true, at(-20), at(-10), "EXPIRED"],
    ["starts_at exactly now is LIVE", true, NOW, at(10), "LIVE"],
    ["ends_at exactly now is EXPIRED", true, at(-10), NOW, "EXPIRED"],
    ["expired takes precedence over a future start", true, at(10), at(-10), "EXPIRED"],
  ])("%s", (_label, isActive, startsAt, endsAt, expected) => {
    expect(deriveBannerState({ isActive, startsAt, endsAt }, NOW)).toBe(expected);
  });

  it("agrees with the overlap analysis about what is live now", () => {
    const cases: BannerWindow[] = [
      w("a", null, null),
      w("b", at(-10), at(10)),
      w("c", at(10), at(20)),
      w("d", at(-20), at(-10)),
    ];

    const liveNow = cases.filter(
      (c) => deriveBannerState({ isActive: true, ...c }, NOW) === "LIVE"
    );

    expect(liveNow.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
