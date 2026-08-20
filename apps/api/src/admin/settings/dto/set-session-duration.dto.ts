import { IsInt, Max, Min } from "class-validator";

export class SetSessionDurationDto {
  @IsInt()
  @Min(900)
  @Max(2592000)
  seconds!: number;
}
