/**
 * Sales unit reference data.
 *
 * `GET /sales-units/active` returned RAW Prisma rows until 8E.5a —
 * `isActive`, `createdAt` and `updatedAt` included. Nothing there is
 * sensitive: it is admin-managed reference data every catalogue screen
 * needs. What was wrong is that a raw row was the contract, so a consumer
 * could come to depend on a column, and the endpoint could change shape
 * without anyone noticing.
 *
 * `isActive` is dropped because every row the endpoint returns is active
 * by construction, and the timestamps because a picker has no use for
 * when an admin last edited a unit's name.
 *
 * `sortOrder` IS kept: the endpoint orders by it, and a consumer that
 * re-sorts client-side — or merges two lists — needs it to preserve the
 * order an administrator chose.
 */
export interface SalesUnitItem {
  id: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
}

export const SALES_UNIT_ITEM_KEYS = [
  "id",
  "nameAr",
  "nameEn",
  "sortOrder",
] as const satisfies readonly (keyof SalesUnitItem)[];
