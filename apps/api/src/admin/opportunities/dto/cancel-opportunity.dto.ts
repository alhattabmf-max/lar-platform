import { IsString, MinLength } from "class-validator";

export class CancelOpportunityDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
