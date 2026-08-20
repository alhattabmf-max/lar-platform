import { IsOptional, IsString } from "class-validator";

export class Admin2faVerifyDto {
  @IsString()
  ticket!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  recoveryCode?: string;
}
