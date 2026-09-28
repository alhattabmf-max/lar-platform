/**
 * Public geography contract.
 *
 * Cities carry their region inline because every consumer that shows a
 * city also wants to group or qualify it by region, and a second lookup
 * to resolve `regionId` would be pure round-trip cost.
 *
 * There are deliberately NO coordinates here. City centroids are not a
 * stored value on this model, and inventing one to stand in for a real
 * company location is forbidden repo-wide.
 */
export interface CityRegionRef {
  id: string;
  nameAr: string;
  nameEn: string;
}

export interface CityItem {
  id: string;
  nameAr: string;
  nameEn: string;
  region: CityRegionRef;
}

export const CITY_ITEM_KEYS = [
  "id",
  "nameAr",
  "nameEn",
  "region",
] as const satisfies readonly (keyof CityItem)[];

/**
 * An active region, as every public surface receives one.
 *
 * THE PLATFORM'S OPERATIONAL UNIT. A branch is recorded against a
 * region, a listing ships from one, the marketplace filters by one.
 * `CityItem` above is the refinement beneath it — an optional narrowing
 * of a place, not the place itself.
 *
 * The shape is `CityRegionRef` exactly, and it says so rather than
 * restating three fields: a region named one way inside a city and
 * another way in the picker would be the same region reading as two.
 */
export type RegionItem = CityRegionRef;

export const REGION_ITEM_KEYS = [
  "id",
  "nameAr",
  "nameEn",
] as const satisfies readonly (keyof RegionItem)[];
