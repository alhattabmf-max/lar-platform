import { PlatformBillingProfileService } from "./platform-billing-profile.service";

/**
 * The platform's billing identity, on the read that feeds the form.
 *
 * `addressSnapshot` IS PART OF THE READ. Without it, the screen that
 * writes the next version starts with a blank address, and since the
 * service only ever APPENDS a version — there is no update endpoint —
 * the address would silently disappear from the profile in force the
 * first time anyone corrected a legal name.
 *
 * IT IS ALSO UNVALIDATED. Prisma types a Json column as `JsonValue`: a
 * string, a number and an array are all legal values there. The
 * projection promises an object, so anything else is reported as an
 * empty one rather than handed to a caller that would read keys off it.
 */

describe("PlatformBillingProfileService.getCurrent", () => {
  function serviceReturning(row: unknown) {
    const prisma = {
      platformBillingProfileVersion: {
        findFirst: jest.fn().mockResolvedValue(row),
      },
    };
    return {
      prisma,
      service: new PlatformBillingProfileService(prisma as never),
    };
  }

  const ROW = {
    id: "profile-1",
    version: 3,
    legalName: "منصة فرصة للتجارة",
    crNumber: "1010101010",
    isVatRegistered: true,
    vatNumber: "300012345600003",
    addressSnapshot: {
      cityId: "11111111-1111-4111-8111-111111111111",
      cityNameAr: "الرياض",
      cityNameEn: "Riyadh",
      shortAddress: "RRRD2929",
    },
    createdAt: new Date("2026-08-01T09:00:00.000Z"),
  };

  it("returns null when no version has ever been created", async () => {
    const { service } = serviceReturning(null);

    // A real state on a fresh installation, not an error and not an
    // invented empty profile.
    expect(await service.getCurrent()).toBeNull();
  });

  it("returns the highest version, with its address", async () => {
    const { service, prisma } = serviceReturning(ROW);

    const result = await service.getCurrent();

    expect(result).toEqual({
      id: "profile-1",
      version: 3,
      legalName: "منصة فرصة للتجارة",
      crNumber: "1010101010",
      isVatRegistered: true,
      vatNumber: "300012345600003",
      addressSnapshot: {
        cityId: "11111111-1111-4111-8111-111111111111",
        cityNameAr: "الرياض",
        cityNameEn: "Riyadh",
        shortAddress: "RRRD2929",
      },
      createdAt: "2026-08-01T09:00:00.000Z",
    });
    // The CURRENT profile is the highest-numbered one, not the newest by
    // clock — versions are what documents reference.
    expect(prisma.platformBillingProfileVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { version: "desc" } }),
    );
  });

  it("does not leak who created the version", async () => {
    const { service, prisma } = serviceReturning(ROW);

    await service.getCurrent();

    const select = prisma.platformBillingProfileVersion.findFirst.mock
      .calls[0][0].select as Record<string, boolean>;
    // An audit-log question, not a field to mirror onto every read.
    expect(select).not.toHaveProperty("createdByAdminUserId");
    expect(select.addressSnapshot).toBe(true);
  });

  it.each([
    ["a string", "الرياض"],
    ["a number", 42],
    ["an array", ["الرياض"]],
    ["null", null],
  ])("reads %s address as an empty shape rather than breaking", async (_label, stored) => {
    const { service } = serviceReturning({ ...ROW, addressSnapshot: stored });

    const result = await service.getCurrent();

    // TOLERANT ON READ. Versions written before the address had a
    // declared shape are still in the table and still referenced by
    // documents; the form asks for what is missing rather than the
    // screen failing on a row it cannot render.
    expect(result?.addressSnapshot).toEqual({
      cityId: "",
      cityNameAr: "",
      cityNameEn: "",
      shortAddress: "",
    });
  });
});
