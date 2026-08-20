import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { SetBannerScheduleDto, UpdateBannerDto } from "./banner.dto";

/**
 * These assert the CLOSED-ness of the update DTO.
 *
 * The global ValidationPipe runs with `forbidNonWhitelisted: true`
 * (configure-app.ts), so a property that is not declared is a 400 —
 * not a silently ignored field. That distinction is what stops a
 * caller from believing it changed something it did not.
 */
function check(cls: new () => object, raw: unknown) {
  const instance = plainToInstance(cls, raw);
  return validateSync(instance, { whitelist: true, forbidNonWhitelisted: true });
}

const TITLE_AR = "عنوان";

describe("UpdateBannerDto", () => {
  it("accepts the content fields it owns", () => {
    const errors = check(UpdateBannerDto, {
      titleAr: TITLE_AR,
      titleEn: "Title",
      bodyAr: null,
      bodyEn: "Body",
      linkUrl: "/opportunities",
      sortOrder: 3,
    });

    expect(errors).toHaveLength(0);
  });

  it("REJECTS startsAt — scheduling belongs to the schedule endpoint", () => {
    const errors = check(UpdateBannerDto, {
      titleAr: TITLE_AR,
      startsAt: "2026-08-20T00:00:00.000Z",
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("startsAt");
  });

  it("REJECTS endsAt", () => {
    const errors = check(UpdateBannerDto, {
      titleAr: TITLE_AR,
      endsAt: "2026-08-20T00:00:00.000Z",
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("endsAt");
  });

  it("REJECTS placement — it is immutable after creation", () => {
    const errors = check(UpdateBannerDto, {
      titleAr: TITLE_AR,
      placement: "PUBLIC_OPPORTUNITIES",
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe("placement");
  });

  it("REJECTS isActive — activation belongs to the toggle endpoint", () => {
    const errors = check(UpdateBannerDto, { titleAr: TITLE_AR, isActive: true });

    expect(errors.length).toBeGreaterThan(0);
  });

  it("REJECTS any image column", () => {
    for (const field of ["imageObjectKey", "imageThumbnailKey", "imageETag", "imageContentType"]) {
      const errors = check(UpdateBannerDto, { titleAr: TITLE_AR, [field]: "x" });
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects an over-long title and a negative sort order", () => {
    expect(check(UpdateBannerDto, { titleAr: "x".repeat(121) }).length).toBeGreaterThan(0);
    expect(check(UpdateBannerDto, { sortOrder: -1 }).length).toBeGreaterThan(0);
  });

  it("accepts an empty patch — every field is optional", () => {
    expect(check(UpdateBannerDto, {})).toHaveLength(0);
  });
});

describe("SetBannerScheduleDto", () => {
  it("is the ONLY place a window is accepted", () => {
    const errors = check(SetBannerScheduleDto, {
      startsAt: "2026-08-20T00:00:00.000Z",
      endsAt: "2026-08-21T00:00:00.000Z",
    });

    expect(errors).toHaveLength(0);
  });

  it("accepts nulls, which clear the bounds", () => {
    expect(check(SetBannerScheduleDto, { startsAt: null, endsAt: null })).toHaveLength(0);
  });

  it("rejects a non-date value", () => {
    expect(check(SetBannerScheduleDto, { startsAt: "soon" }).length).toBeGreaterThan(0);
  });

  it("rejects content fields — it owns scheduling only", () => {
    expect(check(SetBannerScheduleDto, { titleAr: TITLE_AR }).length).toBeGreaterThan(0);
  });
});
