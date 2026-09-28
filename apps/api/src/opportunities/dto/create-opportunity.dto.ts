import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateIf,
} from "class-validator";
import { SALE_MODES, type SaleMode } from "@platform/domain";
import { IsMoneyAmount } from "../../common/validation/is-money-amount.decorator";

export class CreateOpportunityDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  fulfillmentLocationId!: string;

  /**
   * WHICH OF THE TWO SALES PATHS. Optional, defaulting to `GROUP`, so
   * every client that predates the second path keeps working unchanged
   * and every row it creates is what it always was.
   */
  @IsOptional()
  @IsIn(SALE_MODES)
  saleMode?: SaleMode;

  /**
   * THE SAME COLUMN MEANS TWO THINGS, and which one is the sale mode's
   * business: for `GROUP` it is the collective target the offer must
   * reach; for `DIRECT` it is the stock on the shelf.
   *
   * DELIBERATELY NOT RENAMED. Both readings are "how many units this
   * listing is about", every reader of the column already treats it that
   * way, and a rename would touch the freeze trigger, four CHECK
   * constraints, the checkout's availability arithmetic and every view —
   * a large diff that changes no behaviour.
   */
  @IsInt()
  @IsPositive()
  targetQuantity!: number;

  /**
   * Tax-inclusive price per selling unit.
   *
   * `IsMoneyAmount` is shared with `UpdateOpportunityDto` so the two
   * cannot drift: it bounds the value to what `Decimal(12,2)` can hold and
   * refuses anything with more than two decimal places, scientific
   * notation, `NaN` or `Infinity`. Rounding a third decimal away silently
   * would charge on a price the supplier did not enter.
   */
  @IsNumber()
  @IsPositive()
  @IsMoneyAmount()
  unitPriceAmount!: number;

  /**
   * THE WINDOW BELONGS TO A GROUP OFFER ALONE — «لا مدة انتهاء» for a
   * direct sale.
   *
   * Required when the mode is GROUP (or absent, which means GROUP).
   * `ValidateIf` can stop asking for a field; it cannot refuse one that
   * was sent anyway, so the service refuses a window on a DIRECT
   * listing explicitly — a shelf with a deadline nobody set would show
   * a countdown on the buyer's card and be swept up by the lifecycle
   * cron.
   */
  @ValidateIf((dto: CreateOpportunityDto) => dto.saleMode !== "DIRECT")
  @IsDateString()
  startAt?: string;

  @ValidateIf((dto: CreateOpportunityDto) => dto.saleMode !== "DIRECT")
  @IsDateString()
  endAt?: string;

  @IsInt()
  @IsPositive()
  expectedPreparationDays!: number;

  @IsOptional()
  @IsString()
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  descriptionEn?: string;
}
