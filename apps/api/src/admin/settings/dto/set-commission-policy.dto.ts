import { IsInt, Max, Min } from "class-validator";

export class SetCommissionPolicyDto {
  @IsInt()
  @Min(0)
  @Max(10000)
  rateBasisPoints!: number;
}
