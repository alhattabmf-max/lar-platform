import { IsString, MinLength } from "class-validator";

export class PauseOpportunityDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
