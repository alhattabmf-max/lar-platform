import { IsString, Length } from "class-validator";

export class Admin2faSetupConfirmDto {
  @IsString()
  ticket!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
