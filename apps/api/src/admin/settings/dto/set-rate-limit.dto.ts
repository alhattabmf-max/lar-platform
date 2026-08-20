import { IsInt, Max, Min } from "class-validator";

export class SetRateLimitDto {
  @IsInt()
  @Min(1)
  @Max(20)
  limit!: number;

  @IsInt()
  @Min(10)
  @Max(300)
  ttlSeconds!: number;
}
