import { ERROR_CODES } from "@platform/types";
import { CompaniesService } from "./companies.service";
import { BusinessException } from "../common/errors/business-exception";
import { SENTINEL_CITY_ID } from "../geography/sentinel.constants";

/**
 * The company's own first branch.
 *
 * WHY THIS PATH MATTERS NOW. Registration used to create a location
 * itself, from a city and a pair of coordinates typed into the sign-up
 * form. It no longer collects any of that, and it invents no branch to
 * make up for it — so this endpoint is where a company's first branch
 * actually comes from, reached from "complete your profile".
 *
 * WHAT IS ASSERTED HERE. That the link a person pastes is read the same
 * way the admin console reads one, including the shortened share link
 * that carries no coordinates at all; that a link nobody can read is
 * refused with the code the UI already translates; and that the city
 * guard registration used to perform is still performed — by this
 * service, which is where the responsibility moved rather than being
 * dropped.
 */

const CITY_ID = "11111111-1111-1111-1111-111111111111";
const REGION_ID = "22222222-2222-2222-2222-222222222222";

interface Branch {
  latitude: number;
  longitude: number;
  [key: string]: unknown;
}

function serviceWith(options: {
  /** What the share-link fetcher answers, keyed by URL. */
  redirects?: Record<string, string>;
  cityActive?: boolean;
  cityExists?: boolean;
  regionActive?: boolean;
  regionExists?: boolean;
}) {
  const created: Branch[] = [];

  const prisma = {
    region: {
      findUnique: async () =>
        options.regionExists === false
          ? null
          : { id: REGION_ID, isActive: options.regionActive ?? true },
    },
    city: {
      findUnique: async () =>
        options.cityExists === false
          ? null
          : {
              id: CITY_ID,
              isActive: options.cityActive ?? true,
              // Under the region every branch in these tests claims.
              regionId: REGION_ID,
            },
    },
    companyLocation: {
      count: async () => 0,
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Branch }) => {
        created.push(data);
        return { id: "loc-1", ...data };
      },
    },
    // The transaction runs its callback against the same stubs, which
    // is what the real one does with a client.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };

  const audit = { log: async () => undefined };

  const service = new CompaniesService(
    prisma as never,
    audit as never,
    // Nothing under review: these cases are about reading a link,
    // not about the lock, which has its own tests.
    {
        assertNotUnderReview: async () => undefined,
        markChangedSinceApproval: async () => undefined,
      } as never,
  );

  // Injected, so no test opens a socket.
  service.mapLinkFetcher = async (url: string) => {
    const location = options.redirects?.[url];
    return {
      status: location ? 302 : 404,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "location" ? (location ?? null) : null,
      },
    };
  };

  return { service, created };
}

const CTX = {
  userId: "u-1",
  companyId: "c-1",
  requestId: "req-1",
};

const BASE = {
  regionId: REGION_ID,
  cityId: CITY_ID,
  name: "Main branch",
  shortAddress: "RRRD2929",
  contactName: "Sara",
  contactPhone: "0500000000",
};

/**
 * The CODE of a refusal.
 *
 * Read off the envelope rather than off a property, because that is
 * what the client receives: the web app translates by code, so a code
 * that never reaches the body is a message the reader never sees.
 */
async function codeFrom(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BusinessException) {
      return (error.getResponse() as { code: string }).code;
    }
    throw error;
  }
  throw new Error(
    "expected a BusinessException, but the call returned normally",
  );
}

describe("creating a company's own branch", () => {
  it("reads a link that carries the numbers, with no outbound request", async () => {
    const { service, created } = serviceWith({});

    await service.createLocation(
      {
        ...BASE,
        mapUrl: "https://www.google.com/maps?q=24.7136,46.6753",
      } as never,
      CTX,
    );

    expect(created[0].latitude).toBe(24.7136);
    expect(created[0].longitude).toBe(46.6753);
  });

  it("prefers the PLACE pin over where the map happened to be centred", async () => {
    // On a place URL the `@` pair is the view and `!3d!4d` is the
    // place; they differ by however far the reader had panned, and
    // reading the view drops the pin some streets away.
    const { service, created } = serviceWith({});

    await service.createLocation(
      {
        ...BASE,
        mapUrl:
          "https://www.google.com/maps/place/X/@24.0000,46.0000,17z/data=!4m5!3m4!8m2!3d24.7136!4d46.6753",
      } as never,
      CTX,
    );

    expect(created[0].latitude).toBe(24.7136);
  });

  it("FOLLOWS the shortened share link, which carries no coordinates", async () => {
    // This is the link the "share" button produces, and a person has no
    // reason to know it differs from the one in the address bar.
    const short = "https://maps.app.goo.gl/abc123";
    const long = "https://www.google.com/maps/place/X/data=!3d24.5!4d46.5";
    const { service, created } = serviceWith({ redirects: { [short]: long } });

    await service.createLocation({ ...BASE, mapUrl: short } as never, CTX);

    expect(created[0].latitude).toBe(24.5);
    expect(created[0].longitude).toBe(46.5);
  });

  it("refuses a link that leads nowhere, under the code the UI translates", async () => {
    const { service, created } = serviceWith({});

    const code = await codeFrom(
      service.createLocation(
        { ...BASE, mapUrl: "https://maps.app.goo.gl/dead" } as never,
        CTX,
      ),
    );

    // The UI translates by CODE, so a helpful message under a generic
    // code never reaches the reader.
    expect(code).toBe(ERROR_CODES.BRANCH_LOCATION_UNREADABLE);
    expect(created).toHaveLength(0);
  });

  it("refuses a redirect that leaves the allowlisted hosts", async () => {
    // Following a URL somebody typed is an SSRF unless every hop is
    // checked, not just the first.
    const short = "https://maps.app.goo.gl/abc123";
    const { service } = serviceWith({
      redirects: { [short]: "https://internal.example.com/admin" },
    });

    const code = await codeFrom(
      service.createLocation({ ...BASE, mapUrl: short } as never, CTX),
    );

    expect(code).toBe(ERROR_CODES.BRANCH_LOCATION_UNREADABLE);
  });

  it("refuses a branch with no position at all", async () => {
    const { service } = serviceWith({});

    const code = await codeFrom(
      service.createLocation({ ...BASE } as never, CTX),
    );

    expect(code).toBe(ERROR_CODES.BRANCH_LOCATION_UNREADABLE);
  });

  it("still accepts an explicit pair from a caller that already has one", async () => {
    const { service, created } = serviceWith({});

    await service.createLocation(
      { ...BASE, latitude: 21.4225, longitude: 39.8262 } as never,
      CTX,
    );

    expect(created[0].latitude).toBe(21.4225);
  });

  // ------------------------------------------------- the city guard

  /**
   * REGISTRATION USED TO MAKE THIS CHECK. It validated the city, and
   * refused the sentinel, before creating the branch it no longer
   * creates. The responsibility moved here rather than being dropped —
   * these three cases are what proves it.
   */
  it("refuses the sentinel city, which is reserved for migrated rows", async () => {
    const { service } = serviceWith({});

    const code = await codeFrom(
      service.createLocation(
        { ...BASE, cityId: SENTINEL_CITY_ID, mapUrl: "24.7,46.6" } as never,
        CTX,
      ),
    );

    expect(code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("refuses an inactive city", async () => {
    const { service } = serviceWith({ cityActive: false });

    const code = await codeFrom(
      service.createLocation({ ...BASE, mapUrl: "24.7,46.6" } as never, CTX),
    );

    expect(code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("refuses an unknown city", async () => {
    const { service } = serviceWith({ cityExists: false });

    const code = await codeFrom(
      service.createLocation({ ...BASE, mapUrl: "24.7,46.6" } as never, CTX),
    );

    expect(code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  /**
   * THE REGION IS WHERE A BRANCH IS; the city refines it.
   *
   * The company's own form used to demand a city, which is why
   * switching every city off left a supplier unable to add a branch at
   * all. A branch on a region alone is now a complete branch — and the
   * city, when given, still has to be active and under that region.
   */
  it("accepts a branch on a region alone, with no city", async () => {
    const { service, created } = serviceWith({});

    await service.createLocation(
      { ...BASE, cityId: undefined, mapUrl: "24.7,46.6" } as never,
      CTX,
    );

    expect(created).toHaveLength(1);
    expect(created[0].regionId).toBe(REGION_ID);
    // Null, never the Sentinel and never the region's first city.
    expect(created[0].cityId).toBeNull();
  });

  it("refuses an inactive region", async () => {
    const { service } = serviceWith({ regionActive: false });

    const code = await codeFrom(
      service.createLocation({ ...BASE, mapUrl: "24.7,46.6" } as never, CTX),
    );

    expect(code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("refuses an unknown region", async () => {
    const { service } = serviceWith({ regionExists: false });

    const code = await codeFrom(
      service.createLocation({ ...BASE, mapUrl: "24.7,46.6" } as never, CTX),
    );

    expect(code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("refuses the Sentinel region", async () => {
    const { service } = serviceWith({});

    const code = await codeFrom(
      service.createLocation(
        {
          ...BASE,
          regionId: "00000000-0000-0000-0000-000000000000",
          mapUrl: "24.7,46.6",
        } as never,
        CTX,
      ),
    );

    expect(code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  /**
   * Both halves individually valid, the pair wrong. A branch in one
   * region carrying another region's city would price a delivery
   * against one place and display another.
   */
  it("refuses a city that is not in the selected region", async () => {
    const { service, created } = serviceWith({});

    const code = await codeFrom(
      service.createLocation(
        {
          ...BASE,
          regionId: "33333333-3333-3333-3333-333333333333",
          mapUrl: "24.7,46.6",
        } as never,
        CTX,
      ),
    );

    expect(code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(created).toHaveLength(0);
  });

  it("checks the city BEFORE spending a request on the link", async () => {
    // A bad city and a share link together should cost no outbound
    // call at all.
    let calls = 0;
    const { service } = serviceWith({ cityExists: false });
    service.mapLinkFetcher = async () => {
      calls += 1;
      return { status: 404, headers: { get: () => null } };
    };

    await codeFrom(
      service.createLocation(
        { ...BASE, mapUrl: "https://maps.app.goo.gl/abc" } as never,
        CTX,
      ),
    );

    expect(calls).toBe(0);
  });

  it("makes the first branch the default whatever the caller asked for", async () => {
    const { service, created } = serviceWith({});

    await service.createLocation(
      { ...BASE, mapUrl: "24.7,46.6", isDefault: false } as never,
      CTX,
    );

    expect(created[0].isDefault).toBe(true);
  });
});
