"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type { CityItem } from "@platform/types";

/**
 * THE CITY LIST, READ FRESH — and why it could not be.
 *
 * THE FAULT. `/cities/active` is public reference data, so the page
 * read it through `apiClient.get(..., { revalidate: 300 })`. That is a
 * Next.js data cache entry: for five minutes after the first read,
 * EVERY render of this page — for every company — was served the same
 * list. An administrator switching a city on saw nothing change, and
 * the only thing that ever appeared to help was changing the region
 * and changing it back, because that re-derived the list from props
 * that were already stale.
 *
 * WHY NOT JUST DROP THE CACHE. Because the page is a Server Component:
 * the only way to re-read it is to re-render the page, and re-rendering
 * the page while somebody is halfway through the form throws away
 * everything they typed. The owner's rule is explicit — the list must
 * refresh «دون فقدان مدخلات النموذج».
 *
 * SO IT IS READ IN THE BROWSER. The server still hands down a list for
 * the first paint, so nothing is empty while this runs; this hook then
 * replaces it with a live read and nothing else on the page moves.
 *
 * IT IS ALWAYS `no-store`. That is `apiClient`'s default and it is the
 * point of this module — a cached read here would restore the fault it
 * exists to fix.
 */
/**
 * IT RETURNS A VALUE AND NOTHING ELSE.
 *
 * No `refresh` handle and no `loading` flag: a function on the way out
 * of a "use client" module is the shape that broke three admin screens
 * when one crossed the server boundary, and this repository guards
 * against it by name. There is nothing here that needs one — the read
 * happens on mount, which is the only moment the list matters.
 */
export function useLiveCities(initial: readonly CityItem[] | null): {
  /** Null until the first live read answers — the caller stands in. */
  cities: readonly CityItem[] | null;
} {
  const [cities, setCities] = useState<readonly CityItem[] | null>(initial);

  useEffect(() => {
    let cancelled = false;

    apiClient
      .get<CityItem[]>("/cities/active")
      .then((rows) => {
        if (!cancelled) setCities(rows);
      })
      .catch(() => {
        // A FAILED READ KEEPS THE LIST IT HAS. The alternative is
        // emptying a picker somebody is using because one request
        // failed, which is strictly worse than a list a few minutes
        // old.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { cities };
}
