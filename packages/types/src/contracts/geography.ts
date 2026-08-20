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
