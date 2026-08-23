import { Controller, Get } from "@nestjs/common";
import type { SalesUnitItem } from "@platform/types";
import { SalesUnitsService } from "./sales-units.service";

@Controller("sales-units")
export class SalesUnitsController {
  constructor(private readonly salesUnits: SalesUnitsService) {}

  /**
   * Projected onto the shared contract rather than returned as raw rows,
   * which is what this used to do — `isActive`, `createdAt` and
   * `updatedAt` included.
   *
   * Nothing there was sensitive: this is admin-managed reference data
   * every catalogue screen needs. What was wrong is that a raw row WAS
   * the contract, so a consumer could come to depend on a column and the
   * endpoint could change shape without anyone noticing.
   *
   * `isActive` is dropped because every row here is active by
   * construction, and the timestamps because a picker has no use for when
   * an administrator last renamed a unit. `sortOrder` stays: the endpoint
   * orders by it, and a consumer that re-sorts or merges lists needs it to
   * keep the order an administrator chose.
   */
  @Get("active")
  async listActive(): Promise<SalesUnitItem[]> {
    return this.salesUnits.listActiveProjected();
  }
}
