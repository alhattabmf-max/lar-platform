/**
 * The browser's ONE opinion about a pasted map link.
 *
 * WHY IT IS A MODULE OF ITS OWN. Two forms now take a Google Maps
 * link — the console's branch form and the company's own "complete
 * your profile" — and the reason each gives for refusing one has to be
 * the same reason, or a link accepted on one screen is rejected on the
 * other for no reason a person could discover. It is a plain module
 * with no "use client" directive, so a Server Component may import it
 * too without turning it into a client reference.
 *
 * IT IS NOT THE AUTHORITY. The server reads the link — it is the only
 * side that may follow a share link's redirect, and the only side that
 * checks every hop against the host allowlist. This exists so that a
 * value that could never be a place under any reading is answered
 * where it was typed, instead of after a round trip.
 */

/**
 * Whether a pasted value is worth sending at all.
 *
 * IT ACCEPTS A SHARE LINK. `maps.app.goo.gl/xxxx` — the one the
 * "share" button gives you — carries no coordinates, and this used to
 * refuse it in the form. That was the wrong place to draw the line: an
 * operator has no reason to know that link differs from the one in the
 * address bar, and telling them to go and fetch a different one is
 * asking them to do by hand what the server now does for them. The API
 * follows the redirect and reads the destination.
 *
 * So this only catches what could never be a place under any reading —
 * a sentence, a blank, some other site — and leaves everything that
 * looks like a Google Maps address to the server, which is the
 * authority on whether it resolves.
 */
export function looksLikeAPlace(raw: string): boolean {
  const value = raw.trim();
  if (value === "") return false;

  // A Google Maps host of any shape, short or long.
  if (/^https:\/\/([a-z0-9-]+\.)*(google\.[a-z.]+|goo\.gl)\//i.test(value))
    return true;

  return hasCoordinates(value);
}

/** Coordinates written into the value itself, in any of Google's shapes. */
export function hasCoordinates(raw: string): boolean {
  const url = raw.trim();
  if (url === "") return false;

  return [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/,
  ].some((pattern) => {
    const match = pattern.exec(url);
    if (!match) return false;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    return (
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180
    );
  });
}
