import { IsString, MinLength } from "class-validator";

export class LoginDto {
  @IsString()
  @MinLength(1)
  crNumber!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
