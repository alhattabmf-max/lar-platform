import { IsString, MinLength } from "class-validator";

export class AddEvidenceDto {
  @IsString()
  @MinLength(1)
  storageObjectKey!: string;
}
