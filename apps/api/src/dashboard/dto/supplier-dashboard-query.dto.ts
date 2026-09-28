import { IsIn, IsOptional } from "class-validator";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "@platform/types";

/**
 * The window the supplier's home screen is measured over.
 *
 * THE SAME CLOSED SET the console offers, and the same default. Two
 * screens that both say «آخر 30 يومًا» must mean the same thirty days,
 * and the only way they cannot disagree is to read one vocabulary.
 */
export class SupplierDashboardQueryDto {
  @IsOptional()
  @IsIn(DASHBOARD_PERIODS)
  period?: string;

  resolvedPeriod(): DashboardPeriod {
    return (this.period as DashboardPeriod) ?? "30d";
  }
}
