/**
 * Fixed id of the inactive "Unknown" city/region seeded by the
 * add_regions_and_cities migration, used solely to satisfy the NOT
 * NULL constraint on company_locations rows that existed before
 * cities were introduced. Never selectable at registration or in any
 * location create/update call — enforced in CitiesService/wherever a
 * cityId is accepted from a request body, not just via is_active
 * filtering on read paths.
 */
export const SENTINEL_CITY_ID = "00000000-0000-0000-0000-000000000000";
export const SENTINEL_REGION_ID = "00000000-0000-0000-0000-000000000000";
