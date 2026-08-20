import { describe, expect, it } from "vitest";
import {
  BUSINESS_TIME_ZONE,
  daysUntil,
  formatDate,
  formatDateTime,
  localized,
} from "@/lib/localized";

describe("bilingual selection", () => {
  it("takes the Arabic side for ar-SA and the English side for en-SA", () => {
    expect(localized("ar-SA", "مدينة", "City")).toBe("مدينة");
    expect(localized("en-SA", "مدينة", "City")).toBe("City");
  });

  it("passes null through so a caller keeps its own absent branch", () => {
    expect(localized("ar-SA", null, "Carton")).toBeNull();
    expect(localized("en-SA", "كرتون", null)).toBeNull();
  });
});

describe("dates are rendered in the business time zone and calendar", () => {
  const ISO = "2026-09-01T21:30:00.000Z";

  it("pins the time zone to Riyadh, so the server and the browser agree", () => {
    expect(BUSINESS_TIME_ZONE).toBe("Asia/Riyadh");

    // 21:30 UTC on 1 September is 00:30 on the 2nd in Riyadh (UTC+3).
    // Asserting the DAY ROLLS is what proves the zone is applied — a
    // formatter left on UTC would still say the 1st.
    expect(formatDate(ISO, "en-SA")).toBe("September 2, 2026");
    expect(formatDateTime(ISO, "en-SA")).toContain("12:30");

    const utcDay = new Intl.DateTimeFormat("en-SA", {
      day: "numeric",
      timeZone: "UTC",
      calendar: "gregory",
      numberingSystem: "latn",
    }).format(new Date(ISO));
    expect(utcDay).toBe("1");
  });

  it("does not drift with the machine's own time zone", () => {
    // Every environment this renders in — the build box, the server,
    // each visitor's browser — must produce the identical string.
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      const west = formatDate(ISO, "en-SA");
      process.env.TZ = "Pacific/Kiritimati";
      const east = formatDate(ISO, "en-SA");

      expect(west).toBe(east);
      expect(west).toBe("September 2, 2026");
    } finally {
      process.env.TZ = original;
    }
  });

  it("uses the Gregorian calendar in Arabic, matching the stored value", () => {
    // Left to Intl, ar-SA defaults to the Umm al-Qura calendar, which
    // would disagree with every other date the platform shows.
    const formatted = formatDate("2026-09-01T00:00:00.000Z", "ar-SA")!;

    expect(formatted).toContain("2026");
  });

  it("uses Latin digits in Arabic, so a year is not rendered as ٢٠٢٦", () => {
    const formatted = formatDate("2026-09-01T00:00:00.000Z", "ar-SA")!;

    expect(formatted).not.toMatch(/[٠-٩]/);
  });

  it("produces the same output for the same instant on every call", () => {
    expect(formatDate(ISO, "ar-SA")).toBe(formatDate(ISO, "ar-SA"));
  });

  it.each([
    ["an empty string", ""],
    ["not a date", "soon"],
    ["a malformed timestamp", "2026-13-45T99:99:99Z"],
  ])("returns null for %s rather than 'Invalid Date'", (_label, value) => {
    expect(formatDate(value, "en-SA")).toBeNull();
    expect(formatDateTime(value, "en-SA")).toBeNull();
  });
});

describe("days remaining", () => {
  const NOW = new Date("2026-08-20T12:00:00.000Z");

  it("counts whole days ahead", () => {
    expect(daysUntil("2026-08-25T12:00:00.000Z", NOW)).toBe(5);
  });

  it("rounds a partial day up, so 'closes in 1 day' never reads as 0", () => {
    expect(daysUntil("2026-08-21T01:00:00.000Z", NOW)).toBe(1);
  });

  it("returns null once the moment has passed", () => {
    expect(daysUntil("2026-08-19T12:00:00.000Z", NOW)).toBeNull();
  });

  it("returns null exactly at the closing instant", () => {
    expect(daysUntil("2026-08-20T12:00:00.000Z", NOW)).toBeNull();
  });

  it("returns null for an unparseable value", () => {
    expect(daysUntil("whenever", NOW)).toBeNull();
  });
});
