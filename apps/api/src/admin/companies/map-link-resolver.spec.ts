import { resolveShareLink, type MapLinkFetcher } from "./map-link-resolver";

/**
 * Following a share link, and refusing to follow anything else.
 *
 * This is the API's only outbound request, so most of what is tested
 * here is what it will NOT fetch. Every case injects a stub: no test in
 * this file opens a socket.
 */

const LONG =
  "https://www.google.com/maps/place/Riyadh/@24.7,46.7,11z/data=!3m1!4b1!4m6!3d24.774265!4d46.738586";

/** A fetcher that answers each URL with a redirect, or with 200. */
function stub(
  routes: Record<string, string | number>,
): MapLinkFetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(url);
    const answer = routes[url];
    if (answer === undefined)
      return { status: 200, headers: { get: () => null } };
    if (typeof answer === "number")
      return { status: answer, headers: { get: () => null } };
    return {
      status: 302,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "location" ? answer : null,
      },
    };
  }) as unknown as MapLinkFetcher & { calls: string[] };
  fetcher.calls = calls;
  return fetcher;
}

describe("resolveShareLink", () => {
  it("follows a share link to the address that carries the place", async () => {
    const fetcher = stub({ "https://maps.app.goo.gl/AbCd123": LONG });

    const result = await resolveShareLink(
      "https://maps.app.goo.gl/AbCd123",
      fetcher,
    );

    // This is the whole point: the operator pasted the link the share
    // button gave them, and the coordinates were found for them.
    expect(result).toBe(LONG);
  });

  it("follows a chain of redirects, checking each host", async () => {
    const fetcher = stub({
      "https://maps.app.goo.gl/AbCd123": "https://goo.gl/maps/XyZ",
      "https://goo.gl/maps/XyZ": LONG,
    });

    expect(
      await resolveShareLink("https://maps.app.goo.gl/AbCd123", fetcher),
    ).toBe(LONG);
  });

  it("resolves a relative Location against the URL it came from", async () => {
    const fetcher = stub({
      "https://maps.app.goo.gl/AbCd123":
        "https://www.google.com/maps?q=24.77,46.73",
    });

    expect(
      await resolveShareLink("https://maps.app.goo.gl/AbCd123", fetcher),
    ).toBe("https://www.google.com/maps?q=24.77,46.73");
  });

  describe("what it refuses to fetch at all", () => {
    it.each([
      ["an internal address", "https://localhost/admin"],
      ["a private range", "https://10.0.0.1/"],
      [
        "the cloud metadata endpoint",
        "https://169.254.169.254/latest/meta-data/",
      ],
      ["some other site", "https://example.com/maps"],
      ["a lookalike host", "https://maps.app.goo.gl.evil.com/x"],
      ["plain http", "http://maps.app.goo.gl/AbCd123"],
      ["a file URL", "file:///etc/passwd"],
      ["nonsense", "the shop next to the mosque"],
    ])("never opens a connection for %s", async (_label, url) => {
      const fetcher = stub({});

      expect(await resolveShareLink(url, fetcher)).toBeNull();
      // NOT ONE REQUEST. A value typed by a person becomes a URL the
      // server fetches, and that is the shape of an SSRF.
      expect(fetcher.calls).toEqual([]);
    });
  });

  describe("what it refuses to follow", () => {
    it("stops when a redirect leaves the allowed hosts", async () => {
      const fetcher = stub({
        "https://maps.app.goo.gl/AbCd123":
          "https://169.254.169.254/latest/meta-data/",
      });

      expect(
        await resolveShareLink("https://maps.app.goo.gl/AbCd123", fetcher),
      ).toBeNull();
      // The first hop was made; the second was refused.
      expect(fetcher.calls).toEqual(["https://maps.app.goo.gl/AbCd123"]);
    });

    it("stops when a redirect drops to http", async () => {
      const fetcher = stub({
        "https://maps.app.goo.gl/AbCd123": "http://www.google.com/maps?q=1,2",
      });

      expect(
        await resolveShareLink("https://maps.app.goo.gl/AbCd123", fetcher),
      ).toBeNull();
    });

    it("gives up rather than chasing a redirect loop", async () => {
      const fetcher = stub({
        "https://maps.app.goo.gl/a": "https://maps.app.goo.gl/b",
        "https://maps.app.goo.gl/b": "https://maps.app.goo.gl/a",
      });

      expect(
        await resolveShareLink("https://maps.app.goo.gl/a", fetcher),
      ).toBeNull();
      expect(fetcher.calls.length).toBeLessThanOrEqual(3);
    });
  });

  describe("when the attempt fails", () => {
    it("returns null when the link does not redirect", async () => {
      const fetcher = stub({ "https://maps.app.goo.gl/AbCd123": 200 });

      expect(
        await resolveShareLink("https://maps.app.goo.gl/AbCd123", fetcher),
      ).toBeNull();
    });

    it("returns null when there is no Location header", async () => {
      const fetcher = (async () => ({
        status: 302,
        headers: { get: () => null },
      })) as unknown as MapLinkFetcher;

      expect(
        await resolveShareLink("https://maps.app.goo.gl/AbCd123", fetcher),
      ).toBeNull();
    });

    it("returns null rather than throwing when the network fails", async () => {
      const fetcher = (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as MapLinkFetcher;

      // A branch form must not surface somebody else's outage as a
      // stack trace.
      await expect(
        resolveShareLink("https://maps.app.goo.gl/AbCd123", fetcher),
      ).resolves.toBeNull();
    });

    it("passes an abort signal, so it cannot hang the form", async () => {
      let sawSignal = false;
      const fetcher = (async (_url: string, init: { signal: AbortSignal }) => {
        sawSignal = init.signal instanceof AbortSignal;
        return { status: 200, headers: { get: () => null } };
      }) as unknown as MapLinkFetcher;

      await resolveShareLink("https://maps.app.goo.gl/AbCd123", fetcher);

      expect(sawSignal).toBe(true);
    });
  });

  it("never reads the response body", async () => {
    let bodyTouched = false;
    const fetcher = (async () => ({
      status: 302,
      headers: { get: () => LONG },
      get text() {
        bodyTouched = true;
        return async () => "";
      },
    })) as unknown as MapLinkFetcher;

    await resolveShareLink("https://maps.app.goo.gl/AbCd123", fetcher);

    // A page that answers with something enormous or hostile costs
    // nothing if it is never read.
    expect(bodyTouched).toBe(false);
  });
});
