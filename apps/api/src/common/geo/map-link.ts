/**
 * Reading a Google Maps link, wherever in the product it was pasted.
 *
 * WHY THIS IS SHARED. Both functions below were written for the admin
 * console, where an operator adds a branch for a company. The company
 * now adds its own first branch from "complete your profile", and that
 * path needs exactly the same answer: the same shapes accepted, the
 * same share links followed, the same host allowlist, the same
 * refusal. A second copy under a different roof would be free to
 * diverge, and the divergence would show up as one screen accepting a
 * link the other rejected.
 *
 * The admin modules re-export from here, so nothing that already
 * imported them had to change.
 */

/**
 * Turning a SHARE link into the place it points at.
 *
 * WHY THIS EXISTS. The link a person gets from the "share" button in
 * Google Maps — `https://maps.app.goo.gl/xxxx` — carries no coordinates
 * at all. It is a redirect: the coordinates live in the address it
 * forwards to. Asking an operator to open the place, wait for the long
 * URL to appear in the address bar and copy THAT instead is asking them
 * to do by hand what one request does in a few hundred milliseconds.
 *
 * THIS IS THE API'S ONLY OUTBOUND REQUEST. Nothing else in this service
 * calls out to the internet, so the rules are strict and stated here
 * rather than assumed:
 *
 *   - THE HOST MUST BE ON THE LIST, before the request and again after
 *     every redirect. A value typed by a person becomes a URL the
 *     server fetches, which is the shape of an SSRF: without this, an
 *     operator could point it at an internal address and read what came
 *     back through the error message.
 *   - REDIRECTS ARE FOLLOWED BY HAND, one at a time, at most three.
 *     `redirect: "follow"` would check the first host and none of the
 *     others, which is the same hole with extra steps.
 *   - ONLY THE `Location` HEADER IS READ. The body is never fetched,
 *     never parsed, and never reaches a log — so a page that answers
 *     with something enormous or hostile costs nothing.
 *   - IT GIVES UP QUICKLY. A branch form must not hang on somebody
 *     else's outage.
 */

/** The hosts a share link may live on, and forward to. */
const ALLOWED_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "www.google.com",
  "google.com",
  "maps.google.com.sa",
  "www.google.com.sa",
]);

/** Long enough for a redirect, short enough not to hold a form. */
const TIMEOUT_MS = 4000;

/** Google uses one hop today; three is room without being a chase. */
const MAX_HOPS = 3;

export interface MapLinkFetcher {
  (
    url: string,
    init: { redirect: "manual"; signal: AbortSignal },
  ): Promise<{
    status: number;
    headers: { get(name: string): string | null };
  }>;
}

function hostAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // HTTPS ONLY. A redirect to `http://` or, worse, to `file:` or
  // `gopher:` is not a map link.
  if (url.protocol !== "https:") return false;
  return ALLOWED_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Follows a share link to the address that carries the coordinates.
 *
 * Returns the final URL, or null when the link is not one this may
 * follow, when it does not redirect, or when the attempt fails for any
 * reason at all — the caller treats every one of those the same way,
 * because to an operator they are the same event: "that link did not
 * work".
 *
 * `fetcher` is injected so the tests never touch the network.
 */
export async function resolveShareLink(
  raw: string,
  fetcher: MapLinkFetcher = globalThis.fetch as unknown as MapLinkFetcher,
): Promise<string | null> {
  let current = raw.trim();
  if (!hostAllowed(current)) return null;

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let location: string | null;
    try {
      const response = await fetcher(current, {
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status < 300 || response.status >= 400) return null;
      location = response.headers.get("location");
    } catch {
      // A timeout, a DNS failure, a refused connection: all the same
      // answer, and none of them worth a stack trace in a log.
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (!location) return null;

    // A relative `Location` is resolved against the URL it came from,
    // which is how a redirect is defined — and then checked again.
    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      return null;
    }

    // CHECKED ON EVERY HOP. A first host on the list that forwards to
    // one that is not is exactly what this guards against.
    if (!hostAllowed(next)) return null;

    current = next;

    // The destination is reached when it stops being a short link.
    if (!/goo\.gl$/i.test(new URL(current).hostname)) return current;
  }

  return null;
}

/**
 * Coordinates, taken from a link a person pasted.
 *
 * WHY PARSE RATHER THAN STORE THE LINK. The platform already records
 * latitude and longitude for every branch, and a second column holding
 * somebody's shortened URL would be a second answer to the same
 * question — one that stops working when the shortener does, and that
 * no other part of the product can compute a distance from. So the link
 * is read once, at the moment it is pasted, and what is kept is the
 * pair of numbers everything else already uses.
 *
 * The three shapes Google actually produces are handled: `?q=lat,lng`,
 * `/@lat,lng,zoom`, and `!3dlat!4dlng` from a place URL.
 *
 * A SHORT `maps.app.goo.gl` LINK CARRIES NONE OF THEM — it is the one
 * the "share" button gives you, and it is a redirect. This function
 * cannot see through it, so the caller follows the redirect first and
 * hands the destination back here.
 */
export function coordinatesFromMapUrl(
  raw: string,
): { latitude: number; longitude: number } | null {
  const url = raw.trim();
  if (url === "") return null;

  // ORDER MATTERS. `!3d…!4d…` is the PLACE itself; `@lat,lng` is only
  // where the map happened to be centred when the link was copied, and
  // on a place URL the two differ by however far the reader had panned.
  // Reading the centre would drop a branch pin some streets away from
  // the branch.
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    // A bare "lat,lng" pasted without the surrounding URL.
    /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(url);
    if (!match) continue;

    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    // Off the globe is not a place. Refusing here is better than
    // storing a number that renders a pin in the ocean.
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) continue;
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
      continue;

    return { latitude, longitude };
  }

  return null;
}
