import { IsInt, Max, Min } from "class-validator";

export class SetPayoutHoldDaysDto {
  @IsInt()
  @Min(1)
  @Max(30)
  days!: number;
}
