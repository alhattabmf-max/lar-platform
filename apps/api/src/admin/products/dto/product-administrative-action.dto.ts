import { IsString, MinLength } from "class-validator";

export class ProductAdministrativeActionDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
