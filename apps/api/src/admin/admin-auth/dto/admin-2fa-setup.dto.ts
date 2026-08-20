import { IsString } from "class-validator";

export class Admin2faSetupDto {
  @IsString()
  ticket!: string;
}
