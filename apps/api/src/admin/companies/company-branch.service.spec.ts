import {
  coordinatesFromMapUrl,
  CompanyBranchService,
} from "./company-branch.service";
import { BusinessException } from "../../common/errors/business-exception";

/**
 * Branches, and the link an operator pastes to place one.
 *
 * WHY A LINK RATHER THAN TWO NUMBERS. An operator has a Google Maps
 * page open, not a coordinate pair; asking them to read numbers out of
 * a URL by hand is a step that invents its own typos. The link is read
 * once, and what is stored is the latitude and longitude the rest of
 * the platform already uses — so nothing here needs a new column.
 */

describe("coordinatesFromMapUrl", () => {
  it.each([
    ["a q= link", "https://www.google.com/maps?q=24.774265,46.738586"],
    [
      "a q= link with a space",
      "https://www.google.com/maps?q=24.774265, 46.738586",
    ],
    ["an @ link", "https://www.google.com/maps/@24.774265,46.738586,17z"],
    [
      "a place link",
      "https://www.google.com/maps/place/Riyadh/@24.7,46.7,11z/data=!3m1!4b1!4m6!3d24.774265!4d46.738586",
    ],
    ["a bare pair", "24.774265,46.738586"],
  ])("reads %s", (_label, url) => {
    expect(coordinatesFromMapUrl(url)).toEqual({
      latitude: 24.774265,
      longitude: 46.738586,
    });
  });

  it("reads a negative pair", () => {
    expect(
      coordinatesFromMapUrl(
        "https://www.google.com/maps?q=-33.865143,-151.209900",
      ),
    ).toEqual({
      latitude: -33.865143,
      longitude: -151.2099,
    });
  });

  it.each([
    ["an empty string", ""],
    [
      "a shortened link, which carries no coordinates",
      "https://maps.app.goo.gl/abc123",
    ],
    ["a search link", "https://www.google.com/maps/search/riyadh"],
    ["a sentence", "the shop next to the mosque"],
  ])("refuses %s", (_label, url) => {
    expect(coordinatesFromMapUrl(url)).toBeNull();
  });

  it.each([
    ["a latitude past the pole", "https://www.google.com/maps?q=91.5,46.7"],
    [
      "a longitude past the meridian",
      "https://www.google.com/maps?q=24.7,181.2",
    ],
  ])("refuses %s rather than storing a pin in the void", (_label, url) => {
    expect(coordinatesFromMapUrl(url)).toBeNull();
  });
});

describe("CompanyBranchService", () => {
  const CTX = { actorId: "admin-1", requestId: "req-1" };

  let prisma: {
    company: { findUnique: jest.Mock };
    region: { findUnique: jest.Mock };
    city: { findUnique: jest.Mock };
    companyLocation: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let audit: { log: jest.Mock };
  let service: CompanyBranchService;

  beforeEach(() => {
    prisma = {
      company: { findUnique: jest.fn().mockResolvedValue({ id: "company-1" }) },
      region: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "region-1", isActive: true }),
      },
      city: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "city-1", isActive: true, regionId: "region-1" }),
      },
      companyLocation: {
        create: jest
          .fn()
          .mockResolvedValue({ id: "branch-1", name: "فرع الرياض" }),
        findFirst: jest.fn().mockResolvedValue({
          id: "branch-1",
          name: "فرع الرياض",
          shortAddress: "RRRD2929",
          contactName: "سالم",
          contactPhone: "0500000000",
          regionId: "region-1",
          cityId: "city-1",
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new CompanyBranchService(prisma as never, audit as never);
  });

  const INPUT = {
    name: "فرع الرياض",
    regionId: "region-1",
    cityId: "city-1",
    shortAddress: "RRRD2929",
    contactName: "سالم",
    contactPhone: "0500000000",
    mapUrl: "https://www.google.com/maps?q=24.774265,46.738586",
  };

  describe("adding one", () => {
    it("stores the coordinates the link carried", async () => {
      await service.create("company-1", INPUT, CTX);

      expect(prisma.companyLocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: "company-1",
            latitude: 24.774265,
            longitude: 46.738586,
          }),
        }),
      );
    });

    it("FOLLOWS a share link and stores what it points at", async () => {
      // The link the "share" button gives you carries no coordinates.
      // An operator has no reason to know it differs from the one in
      // the address bar, so the server follows it for them.
      service.fetcher = (async () => ({
        status: 302,
        headers: {
          get: () => "https://www.google.com/maps?q=21.485811,39.192505",
        },
      })) as never;

      await service.create(
        "company-1",
        { ...INPUT, mapUrl: "https://maps.app.goo.gl/AbCd123" },
        CTX,
      );

      expect(prisma.companyLocation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            latitude: 21.485811,
            longitude: 39.192505,
          }),
        }),
      );
    });

    it("makes NO request when the link already carries the numbers", async () => {
      let called = false;
      service.fetcher = (async () => {
        called = true;
        return { status: 200, headers: { get: () => null } };
      }) as never;

      await service.create("company-1", INPUT, CTX);

      // The straightforward case costs nothing.
      expect(called).toBe(false);
    });

    it("refuses a link that leads nowhere readable", async () => {
      service.fetcher = (async () => ({
        status: 200,
        headers: { get: () => null },
      })) as never;

      await expect(
        service.create(
          "company-1",
          { ...INPUT, mapUrl: "https://maps.app.goo.gl/x" },
          CTX,
        ),
      ).rejects.toThrow(/could not be read as a place/i);

      expect(prisma.companyLocation.create).not.toHaveBeenCalled();
    });

    it("requires a link at all", async () => {
      await expect(
        service.create("company-1", { ...INPUT, mapUrl: "" }, CTX),
      ).rejects.toBeInstanceOf(BusinessException);
    });

    it("refuses a company that is not there", async () => {
      prisma.company.findUnique.mockResolvedValue(null);

      await expect(service.create("company-1", INPUT, CTX)).rejects.toThrow(
        /not found/i,
      );
    });

    it("refuses a city the platform does not know", async () => {
      prisma.city.findUnique.mockResolvedValue(null);

      await expect(service.create("company-1", INPUT, CTX)).rejects.toThrow(
        /Unknown city/,
      );
    });

    /**
     * THE REGION IS THE BRANCH'S LOCATION and the city refines it.
     * These pin the half that is new: a branch on a region alone is
     * complete, a region that is switched off cannot take one, and a
     * city has to sit under the region the branch claims.
     */
    it("adds a branch on a region alone, with no city", async () => {
      await service.create("company-1", { ...INPUT, cityId: undefined }, CTX);

      const data = prisma.companyLocation.create.mock.calls[0][0].data;
      expect(data.regionId).toBe("region-1");
      // Null, never the Sentinel and never the region's first city.
      expect(data.cityId).toBeNull();
      // It does not even ask about a city it was not given.
      expect(prisma.city.findUnique).not.toHaveBeenCalled();
    });

    it("treats an explicit null city the same as no city", async () => {
      await service.create("company-1", { ...INPUT, cityId: null }, CTX);

      expect(prisma.companyLocation.create.mock.calls[0][0].data.cityId).toBeNull();
      expect(prisma.city.findUnique).not.toHaveBeenCalled();
    });

    it("refuses a region the platform does not know", async () => {
      prisma.region.findUnique.mockResolvedValue(null);

      await expect(service.create("company-1", INPUT, CTX)).rejects.toThrow(
        /Unknown region/,
      );
    });

    it("refuses a region the platform has switched off", async () => {
      prisma.region.findUnique.mockResolvedValue({
        id: "region-1",
        isActive: false,
      });

      await expect(service.create("company-1", INPUT, CTX)).rejects.toThrow(
        /inactive region/i,
      );
    });

    it("refuses the Sentinel region", async () => {
      await expect(
        service.create(
          "company-1",
          { ...INPUT, regionId: "00000000-0000-0000-0000-000000000000" },
          CTX,
        ),
      ).rejects.toThrow(/cannot be selected/i);
      expect(prisma.region.findUnique).not.toHaveBeenCalled();
    });

    /**
     * The case a per-field check cannot catch: both halves are
     * individually valid and the pair is wrong. A branch in Tabuk with
     * a Jeddah address would price a delivery against one place and
     * display another.
     */
    it("refuses a city that is not in the selected region", async () => {
      prisma.city.findUnique.mockResolvedValue({
        id: "city-9",
        isActive: true,
        regionId: "region-other",
      });

      await expect(service.create("company-1", INPUT, CTX)).rejects.toThrow(
        /not in the selected region/i,
      );
      expect(prisma.companyLocation.create).not.toHaveBeenCalled();
    });

    /**
     * These three pin a gap this console had while the self-serve
     * branch form did not: it checked that a city ROW EXISTED and
     * nothing more, so a console call could put a live branch in a city
     * the platform had switched off — or in the Sentinel placeholder,
     * whose name is «غير محدد». Both were accepted with a 201 against
     * the running platform before this guard.
     */
    it("refuses the Sentinel city, whose name is a placeholder", async () => {
      await expect(
        service.create(
          "company-1",
          { ...INPUT, cityId: "00000000-0000-0000-0000-000000000000" },
          CTX,
        ),
      ).rejects.toThrow(/cannot be selected/i);
    });

    it("refuses a city the platform has switched off", async () => {
      prisma.city.findUnique.mockResolvedValue({
        id: "city-1",
        isActive: false,
      });

      await expect(service.create("company-1", INPUT, CTX)).rejects.toThrow(
        /inactive city/i,
      );
    });

    it("does not reach the database for the Sentinel — the id alone settles it", async () => {
      await expect(
        service.create(
          "company-1",
          { ...INPUT, cityId: "00000000-0000-0000-0000-000000000000" },
          CTX,
        ),
      ).rejects.toBeInstanceOf(BusinessException);

      expect(prisma.city.findUnique).not.toHaveBeenCalled();
    });

    it("records the addition", async () => {
      await service.create("company-1", INPUT, CTX);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "COMPANY_BRANCH_ADDED",
          companyId: "company-1",
          actorId: "admin-1",
        }),
        prisma,
      );
    });

    it("asks for NO second factor", async () => {
      // An address and a telephone number are a correction, not a
      // change of identity. A code here would be a code everywhere.
      await service.create("company-1", INPUT, CTX);

      const [entry] = audit.log.mock.calls[0];
      expect(JSON.stringify(entry)).not.toContain("totp");
    });
  });

  describe("editing one", () => {
    it("is scoped to the company, not just to the branch id", async () => {
      await service.update("company-1", "branch-1", { name: "فرع جدة" }, CTX);

      // A branch id from one company must not be editable from
      // another's page.
      expect(prisma.companyLocation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "branch-1", companyId: "company-1" },
        }),
      );
    });

    it("leaves the position alone when no link was sent", async () => {
      await service.update(
        "company-1",
        "branch-1",
        { contactPhone: "0555555555" },
        CTX,
      );

      const data = prisma.companyLocation.update.mock.calls[0][0].data;
      // Fixing a telephone must not demand re-pasting a map link that
      // is already right.
      expect(data.latitude).toBeUndefined();
      expect(data.longitude).toBeUndefined();
      expect(data.contactPhone).toBe("0555555555");
    });

    it("moves the position when one WAS sent", async () => {
      await service.update(
        "company-1",
        "branch-1",
        { mapUrl: "https://www.google.com/maps?q=21.485811,39.192505" },
        CTX,
      );

      const data = prisma.companyLocation.update.mock.calls[0][0].data;
      expect(data.latitude).toBe(21.485811);
      expect(data.longitude).toBe(39.192505);
    });

    it("refuses a move into a city the platform has switched off", async () => {
      prisma.city.findUnique.mockResolvedValue({
        id: "city-2",
        isActive: false,
        regionId: "region-1",
      });

      await expect(
        service.update("company-1", "branch-1", { cityId: "city-2" }, CTX),
      ).rejects.toThrow(/inactive city/i);
    });

    /**
     * THE CASE THAT MAKES THE PAIR RULE NECESSARY.
     *
     * Moving a branch to another region while saying nothing about its
     * city leaves the old city under the new region. Validating only
     * the field that arrived would let it through, and the database's
     * trigger would then refuse the write with a message about a
     * constraint rather than a sentence naming the problem.
     */
    it("refuses a move to another region that would strand the current city", async () => {
      prisma.region.findUnique.mockResolvedValue({
        id: "region-2",
        isActive: true,
      });
      prisma.city.findUnique.mockResolvedValue({
        id: "city-1",
        isActive: true,
        regionId: "region-1",
      });

      await expect(
        service.update("company-1", "branch-1", { regionId: "region-2" }, CTX),
      ).rejects.toThrow(/not in the selected region/i);
      expect(prisma.companyLocation.update).not.toHaveBeenCalled();
    });

    it("allows the same move when the city is cleared in the same edit", async () => {
      prisma.region.findUnique.mockResolvedValue({
        id: "region-2",
        isActive: true,
      });

      await service.update(
        "company-1",
        "branch-1",
        { regionId: "region-2", cityId: null },
        CTX,
      );

      const data = prisma.companyLocation.update.mock.calls[0][0].data;
      expect(data.regionId).toBe("region-2");
      expect(data.cityId).toBeNull();
    });

    it("clears a city on its own, leaving the branch on its region", async () => {
      await service.update("company-1", "branch-1", { cityId: null }, CTX);

      const data = prisma.companyLocation.update.mock.calls[0][0].data;
      expect(data.cityId).toBeNull();
      expect(data.regionId).toBe("region-1");
    });

    /**
     * The guard runs only when the city CHANGES. A city switched off
     * after a branch was opened there must not lock the operator out of
     * correcting the telephone number — or the address, or the name.
     */
    it("still edits a branch whose own city was switched off", async () => {
      prisma.city.findUnique.mockResolvedValue({
        id: "city-1",
        isActive: false,
      });

      await service.update(
        "company-1",
        "branch-1",
        { contactPhone: "0555555555" },
        CTX,
      );

      expect(prisma.city.findUnique).not.toHaveBeenCalled();
      expect(prisma.companyLocation.update).toHaveBeenCalled();
    });

    it("records what moved, before and after", async () => {
      await service.update("company-1", "branch-1", { name: "فرع جدة" }, CTX);

      const [entry] = audit.log.mock.calls[0];
      expect(entry.action).toBe("COMPANY_BRANCH_UPDATED");
      expect(entry.before.name).toBe("فرع الرياض");
      expect(entry.after.name).toBe("فرع جدة");
    });

    it("refuses an empty patch rather than writing an entry for nothing", async () => {
      await expect(
        service.update("company-1", "branch-1", {}, CTX),
      ).rejects.toBeInstanceOf(BusinessException);
      expect(audit.log).not.toHaveBeenCalled();
    });

    it("refuses a branch that belongs to someone else", async () => {
      prisma.companyLocation.findFirst.mockResolvedValue(null);

      await expect(
        service.update("company-1", "branch-9", { name: "x" }, CTX),
      ).rejects.toThrow(/not found/i);
    });
  });

  it("offers no way to delete a branch", () => {
    // A branch that has taken deliveries is referenced by orders and
    // allocations; removing it would orphan them.
    expect(
      (service as unknown as Record<string, unknown>).delete,
    ).toBeUndefined();
    expect(
      (service as unknown as Record<string, unknown>).remove,
    ).toBeUndefined();
  });
});
